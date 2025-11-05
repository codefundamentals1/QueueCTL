// src/db.js
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { isoNow, nowMs } from "./utils.js";

// Ensure DB folder exists
const DB_PATH = process.env.DB_PATH || "./db/queue.db";
const ensureDir = (p) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};
ensureDir(DB_PATH);

// Initialize database
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Create tables if missing
const schema = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','processing','completed','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  backoff_base INTEGER NOT NULL DEFAULT 2,
  run_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  locked_by TEXT,
  last_error TEXT,
  last_exit_code INTEGER,
  output TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_state_runat ON jobs(state, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_locked_by ON jobs(locked_by);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  pid INTEGER,
  started_at TEXT NOT NULL,
  last_heartbeat TEXT NOT NULL
);
`;

schema
  .trim()
  .split(";")
  .filter(Boolean)
  .forEach((sql) => db.prepare(sql).run());

// ----------------------
// CONFIG HELPERS
// ----------------------
export const cfgGet = (key, def = null) => {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : def;
};

export const cfgSet = (key, value) => {
  db.prepare(
    "INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, JSON.stringify(value));
};

// ----------------------
// JOB HELPERS
// ----------------------
export function insertJob({ id, command, max_retries, backoff_base }) {
  const now = isoNow();
  db.prepare(
    `INSERT INTO jobs(id, command, state, attempts, max_retries, backoff_base, run_at, created_at, updated_at)
     VALUES(@id, @command, 'pending', 0, @max_retries, @backoff_base, @run_at, @created_at, @updated_at)`
  ).run({
    id,
    command,
    max_retries,
    backoff_base,
    run_at: nowMs(),
    created_at: now,
    updated_at: now,
  });
}

// Atomically claim the next pending job for a worker
export const claimNext = (workerId) => {
  // console.log("checking for the next job")
  const tx = db.transaction(() => {
    const job = db
      .prepare(
        `
      SELECT * FROM jobs
      WHERE state='pending' AND run_at <= ?
      ORDER BY run_at ASC LIMIT 1
    `
      )
      .get(nowMs());

    if (!job) {
      // console.log("Job not found");
      return null;
    }

    db.prepare(
      `
      UPDATE jobs
      SET state='processing', locked_by=?, updated_at=?
      WHERE id=?
    `
    ).run(workerId, isoNow(), job.id);
    console.log("handling by worker: ", workerId)
    return job;
  });

  return tx();
};

// Complete a job
export function completeJob(id, output, exitCode) {
  db.prepare(
    `UPDATE jobs
     SET state='completed', output=?, last_exit_code=?, locked_by=NULL, updated_at=?
     WHERE id=?`
  ).run(output ?? null, exitCode ?? 0, isoNow(), id);
}

// Retry or move to DLQ
export function scheduleRetry(job, errorMessage) {
  const attempts = job.attempts + 1;
  const delayMs = Math.pow(job.backoff_base, attempts) * 1000;
  const runAt = nowMs() + delayMs;
  const now = isoNow();

  if (attempts <= job.max_retries) {
    db.prepare(
      `UPDATE jobs
       SET state='pending', attempts=?, run_at=?, last_error=?, locked_by=NULL, updated_at=?
       WHERE id=?`
    ).run(attempts, runAt, errorMessage, now, job.id);
  } else {
    db.prepare(
      `UPDATE jobs
      SET state='dead', attempts=?, last_error=?, locked_by=NULL, updated_at=?
      WHERE id=?`
    ).run(attempts, errorMessage, now, job.id);
    console.log(`maximum attempt ${job.max_retries} reached for job ${job.id} pushed to dead_queue..`)
  }
}

// ----------------------
// WORKER HELPERS
// ----------------------
export function heartbeatUpsert(id, pid) {
  const now = isoNow();
  db.prepare(
    `INSERT INTO workers(id, pid, started_at, last_heartbeat)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_heartbeat=excluded.last_heartbeat, pid=excluded.pid`
  ).run(id, pid, now, now);
}

export const workerRemove = (id) =>
  db.prepare("DELETE FROM workers WHERE id=?").run(id);

// ----------------------
// LISTING HELPERS
// ----------------------
export const listCounts = () => {
  const states = ["pending", "processing", "completed", "failed", "dead"];
  const counts = Object.fromEntries(
    states.map((s) => [
      s,
      db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE state=?").get(s).c,
    ])
  );
  counts.total = db.prepare("SELECT COUNT(*) AS c FROM jobs").get().c;
  counts.workers = db.prepare("SELECT COUNT(*) AS c FROM workers").get().c;
  return counts;
};

export const listJobsByState = (state, limit = 50) =>
  db
    .prepare(
      "SELECT * FROM jobs WHERE state=? ORDER BY updated_at DESC LIMIT ?"
    )
    .all(state, limit);

export const getJob = (id) =>
  db.prepare("SELECT * FROM jobs WHERE id=?").get(id);

export const dlqList = (limit = 50) =>
  db
    .prepare(
      "SELECT * FROM jobs WHERE state='dead' ORDER BY updated_at DESC LIMIT ?"
    )
    .all(limit);

export const dlqRetry = (id) => {
  const job = getJob(id);
  if (!job || job.state !== "dead") throw new Error("Job not in DLQ");
  db.prepare(
    `UPDATE jobs
     SET state='pending', attempts=0, locked_by=NULL, last_error=NULL, run_at=?, updated_at=?
     WHERE id=?`
  ).run(nowMs(), isoNow(), id);
};
