import { parentPort, workerData } from "node:worker_threads";
import { runOnce, type Job } from "./simulate.ts";

/** Runs a slice of seeds for one job and streams each result back. */
const { job, runs } = workerData as { job: Job; runs: { run: number; seed: number }[] };
for (const { run, seed } of runs) {
  parentPort!.postMessage(await runOnce(job, run, seed));
}
