import os from "node:os";
import { Worker } from "node:worker_threads";
import { runSeed } from "./rng.ts";
import { runOnce, type Job, type RunResult } from "./simulate.ts";

/** Run `runs` independent offseasons across worker threads. Results come back ordered by run. */
export async function runMany(
  job: Job,
  { runs, seed, workers, onProgress }: { runs: number; seed: number; workers?: number; onProgress?: (done: number) => void },
): Promise<RunResult[]> {
  const plan = Array.from({ length: runs }, (_, run) => ({ run, seed: runSeed(seed, run) }));
  const count = Math.max(1, Math.min(workers || Math.max(1, os.availableParallelism() - 1), runs));
  const results: RunResult[] = [];
  let done = 0;
  const collect = (r: RunResult) => {
    results.push(r);
    onProgress?.(++done);
  };

  if (count === 1) {
    for (const { run, seed: s } of plan) collect(await runOnce(job, run, s));
  } else {
    const slices = Array.from({ length: count }, (_, w) => plan.filter((_, i) => i % count === w));
    await Promise.all(
      slices.map(
        (slice) =>
          new Promise<void>((resolve, reject) => {
            const worker = new Worker(new URL("./worker.ts", import.meta.url), {
              workerData: { job, runs: slice },
            });
            worker.on("message", collect);
            worker.on("error", reject);
            worker.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
          }),
      ),
    );
  }
  return results.sort((a, b) => a.run - b.run);
}
