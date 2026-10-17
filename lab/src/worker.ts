import { parentPort, workerData } from "node:worker_threads";
import { runReplicate, type DeepJob } from "./deep.ts";
import { collectEvery } from "./gc.ts";
import { runOnce, type Job } from "./simulate.ts";

/** Runs a slice of seeds for one job and streams each result back. */
const { job, runs, deep } = workerData as { job: Job | DeepJob; runs: { run: number; seed: number }[]; deep: boolean };
for (const { run, seed } of runs) {
  parentPort!.postMessage(deep ? await runReplicate(job as DeepJob, run, seed) : await runOnce(job, run, seed));
  collectEvery(deep ? 1 : 10);
}
