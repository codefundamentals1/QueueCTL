// src/worker.js
import { nanoid, sleep } from "./utils.js";
import {
  claimNext,
  completeJob,
  scheduleRetry,
  heartbeatUpsert,
  workerRemove,
  db,
} from "./db.js";
import { runCommand } from "./executor.js";

export async function startWorker({ heartbeatMs = 2000 }) {
  const id = `w_${nanoid()}`;
  const pid = process.pid;
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    // Remove worker record; current job (if any) remains locked until loop ends
    workerRemove(id);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    heartbeatUpsert(id, pid);

    const job = claimNext(id);
    if (!job) {
      await sleep(250);
      continue;
    }

    const { ok, exitCode, output } = await runCommand(job.command);
    if (ok) {
      completeJob(job.id, output, exitCode);
      console.log("job completed : ",job.id)
      console.log("output is: ",output || "<no output>");
    } else {
      // update last_exit_code for visibility prior to reschedule
      job.last_exit_code = exitCode;
      scheduleRetry(job, `exit ${exitCode}`);
    }
  }
}
