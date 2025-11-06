// src/db.js
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { isoNow, nowMs } from "./utils.js";
import fsy from "fs";
import pathfs from "path";



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
    console.log(`job started ${job.id} is handling by worker:  ${workerId}`)
    return job;
  });

  return tx();
};

// Complete a job
export function completeJob(id, output, exitCode) {
  console.log("job completed mesg from db " , id)
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
//recover stucked jobs

export function recoverStuckJobs(maxAgeMs = 15000, maxJobRuntimeMs = 60000) {
  const now = Date.now();
  const cutoff = new Date(now - maxAgeMs).toISOString(); // stale worker heartbeat
  const jobRuntimeCutoff = new Date(now - maxJobRuntimeMs).toISOString(); // long job runtime threshold
  let totalUpdated = 0;

  console.log("🔍 Checking for long-running or orphaned jobs...");

  // 1️⃣ Find all jobs still processing and older than runtime threshold
  const longRunningJobs = db
    .prepare(
      `SELECT * FROM jobs 
       WHERE state='processing' 
       AND updated_at < ?`
    )
    .all(jobRuntimeCutoff);

  if (longRunningJobs.length === 0) {
    console.log("✅ No long-running jobs detected.");
    return 0;
  }

  console.log(`⚠️ Found ${longRunningJobs.length} jobs running > ${maxJobRuntimeMs / 1000}s.`);

  // 2️⃣ Fetch current worker heartbeats
  const allWorkers = db.prepare(`SELECT id, last_heartbeat FROM workers`).all();

  // 3️⃣ Identify jobs whose worker is dead/stale
  const deadJobs = [];
  const nowISO = new Date().toISOString();

  for (const job of longRunningJobs) {
    const worker = allWorkers.find((w) => w.id === job.locked_by);
    if (!worker || worker.last_heartbeat < cutoff) {
      // worker missing or stale → job is orphaned
      deadJobs.push(job);
    }
  }

  if (deadJobs.length === 0) {
    console.log("🟢 All long jobs belong to active workers.");
    return 0;
  }

  console.log(`❌ ${deadJobs.length} job(s) are orphaned (worker dead or stale).`);

  // 4️⃣ Write them to a JSON log file for audit
  const logDir = "./logs";
  if (!fsy.existsSync(logDir)) fsy.mkdirSync(logDir, { recursive: true });
  const logPathfs = pathfs.join(logDir, `failed_jobs_${Date.now()}.json`);
  fsy.writeFileSync(logPathfs, JSON.stringify(deadJobs, null, 2));
  console.log(`📝 Saved failed job details to ${logPathfs}`);

  // 5️⃣ Mark those jobs as failed
  const ids = deadJobs.map((j) => `'${j.id}'`).join(",");
  const res = db
    .prepare(
      `UPDATE jobs 
       SET state='failed',
           locked_by=NULL,
           updated_at=?,
           last_error='Job timed out (>60s) or worker stale'
       WHERE id IN (${ids})`
    )
    .run(nowISO);

  totalUpdated += res.changes;

  // 6️⃣ Optionally clean up dead workers
  const removed = db.prepare(`DELETE FROM workers WHERE last_heartbeat < ?`).run(cutoff);
  if (removed.changes > 0) {
    console.log(`🧹 Removed ${removed.changes} stale worker record(s).`);
  }

  console.log(`✅ Marked ${totalUpdated} stuck job(s) as failed.`);
  return totalUpdated;
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

export const listJobsByState = (state, limit = 1000) =>
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
  // if (!job || job.state !== "dead") throw new Error("Job not in DLQ");
  db.prepare(
    `UPDATE jobs
     SET state='pending', attempts=0, locked_by=NULL, last_error=NULL, run_at=?, updated_at=?
     WHERE id=?`
  ).run(nowMs(), isoNow(), id);
};



export const workersCleanup = (opts)=>{
    const maxAge = Number(opts.maxAge);   
     const cutoff = new Date(Date.now() - maxAge).toISOString();
    const removed = db.prepare(`DELETE FROM workers WHERE last_heartbeat < ?`).run(cutoff);
    return removed;
}

export function listAllWorkers() {
  const workers = db.prepare("SELECT * FROM workers").all();
  console.log("👷 Active workers:", workers.length);
  workers.forEach(w => console.log(`- ${w.id} (pid: ${w.pid})`));
  return workers;
}
export function killAllWorkers() {
  const all = db.prepare("SELECT id, pid FROM workers").all();
  
  if (all.length === 0) {
    console.log("🟢 No workers found in database.");
    return 0;
  }

  console.log(`⚠️ Found ${all.length} worker(s). Attempting to remove...`);

  // Optional: Try to kill actual OS processes if still alive
  for (const w of all) {
    if (w.pid) {
      try {
        process.kill(w.pid, "SIGTERM");
        console.log(`💀 Terminated worker PID ${w.pid}`);
      } catch (err) {
        console.warn(`⚠️ Could not kill PID ${w.pid} (already stopped?)`);
      }
    }
  }

  // Remove from DB
  const result = db.prepare("DELETE FROM workers").run();
  console.log(`🧹 Removed ${result.changes} worker record(s) from DB.`);

  return result.changes;
}
