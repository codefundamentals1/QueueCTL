// src/supervisor.js
import { recoverStuckJobs } from "./db.js";
import { sleep } from "./utils.js";


console.log("Supervisor started. Monitoring workers...");
console.log("\n")
async function loop() {
  while (true) {
    console.log("checking for stucked jobs ")
    const recovered = recoverStuckJobs(5000, 60000); // 60s stale heartbeat
    if (recovered > 0) {
      console.log(` Marked ${recovered} jobs as failed (dead workers).`);
      console.log("\n")
    }
    else console.log("No stucked jobs found all ok! \n")
    await sleep(10000); // run every 10s
  }
}





loop();
