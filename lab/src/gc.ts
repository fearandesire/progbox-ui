import v8 from "node:v8";
import vm from "node:vm";

/**
 * Each offseason runs the script in a fresh vm context. V8 frees old contexts only on
 * full GCs it is slow to schedule, so a 1000-run job grew to ~16 MB per run. A forced
 * full GC every few units keeps a worker flat at ~500 MB.
 */
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

let units = 0;
export function collectEvery(n: number): void {
  if (++units % n === 0) gc();
}
