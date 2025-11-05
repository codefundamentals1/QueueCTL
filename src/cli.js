#!/usr/bin/env node
// src/cli.js
import "dotenv/config";
import { Command } from "commander";
import {
  insertJob,
  listCounts,
  listJobsByState,
  dlqList,
  dlqRetry,
  getJob,
} from "./db.js";
import { startWorker } from "./worker.js";
import { nanoid } from "./utils.js";
import { getConfig, setConfig } from "./config.js";

const program = new Command();

program
  .name("queuectl")
  .description("CLI background job queue with retries, DLQ, and persistence")
  .version("1.0.0");

//
// ENQUEUE
//
program
  .command("enqueue")
  .description("Enqueue a new job (JSON string or plain command)")
  .argument("<jsonOrCommand>")
  .option("--id <id>", "Job id (optional)")
  .option("--max-retries <n>", "Max retries")
  .option("--backoff-base <n>", "Backoff base seconds")
  .action((jsonOrCommand, opts) => {
    let job;
    try {
      job = JSON.parse(jsonOrCommand);
      if (!job.command) throw new Error("JSON must include command");
    } catch {
      job = { command: jsonOrCommand };
    }

    const cfg = getConfig();
    const id = opts.id || job.id || nanoid();
    const max_retries = Number(
      opts.maxRetries ?? job.max_retries ?? cfg.max_retries
    );
    const backoff_base = Number(
      opts.backoffBase ?? job.backoff_base ?? cfg.backoff_base
    );

    insertJob({ id, command: job.command, max_retries, backoff_base });
    console.log(`✅ Enqueued job: ${id}`);
  });

//
// WORKER START
//
program
  .command("worker start")
  .description("Start one or more workers")
  .option("--count <n>", "Number of workers", "1")
  .action(async (opts) => {
    const count = Number(opts.count || 1);
    console.log(`🚀 Starting ${count} worker(s)...`);
    const promises = [];
    for (let i = 0; i < count; i++) promises.push(startWorker({}));
    await Promise.all(promises); // runs indefinitely
  });

//
// STATUS
//
program
  .command("status")
  .description("Show job counts and active workers")
  .action(() => {
    console.log(JSON.stringify(listCounts(), null, 2));
  });

//
// LIST
//
program
  .command("list")
  .description("List jobs by state")
  .option(
    "--state <state>",
    "pending|processing|completed|failed|dead",
    "pending"
  )
  .option("--limit <n>", "Max jobs", "20")
  .action((opts) => {
    const rows = listJobsByState(opts.state, Number(opts.limit));
    console.log(JSON.stringify(rows, null, 2));
  });

//
// DLQ COMMAND GROUP (fixed version)
//
const dlq = program.command("dlq").description("Dead Letter Queue operations");

dlq
  .command("list")
  .description("List dead jobs in the DLQ")
  .option("--limit <n>", "Max jobs", "50")
  .action((opts) => {
    console.log(JSON.stringify(dlqList(Number(opts.limit)), null, 2));
  });

dlq
  .command("retry")
  .description("Retry a specific DLQ job by ID")
  .argument("<id>")
  .action((id) => {
    dlqRetry(id);
    console.log(`♻️ Retried job from DLQ: ${id}`);
  });

//
// CONFIG GETfug
//
const config = program.command("config").description("config operations");

config
  .command("get")
  .description("View current configuration")
  .action(() => {
    console.log(JSON.stringify(getConfig(), null, 2));
  });

//
// CONFIG SET
//
config
  .command("set")
  .description("Set configuration key (max-retries | backoff-base)")
  .argument("<key>")
  .argument("<value>")
  .action((key, value) => {
    const norm = key.replace(/-/g, "_");
    const cfg = setConfig(norm, value);
    console.log(JSON.stringify(cfg, null, 2));
  });

//
// INSPECT
//
program
  .command("inspect")
  .description("Inspect a single job by ID")
  .argument("<id>")
  .action((id) => {
    const job = getJob(id);
    if (!job) {
      console.error("❌ Job not found");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(job, null, 2));
  });

await program.parseAsync(process.argv);
