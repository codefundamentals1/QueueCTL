import { startWorker } from "./worker.js";

console.log(`👷 Worker process started with PID ${process.pid}`);
startWorker({});
