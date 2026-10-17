import vm from "node:vm";

export type ScriptRun = { console: string[]; error?: { name: string; message: string } };

/**
 * Run a Worker Console script exactly as BBGM does: the whole file becomes the
 * body of an async function, with `bbgm` and a seeded `Math` in scope.
 * node:vm isolates globals but is not a security boundary; the runner process
 * is what gets sandboxed.
 */
export async function runScript(
  source: string,
  { bbgm, math, filename, timeoutMs = 20_000 }: { bbgm: unknown; math: Math; filename: string; timeoutMs?: number },
): Promise<ScriptRun> {
  const lines: string[] = [];
  const write = (...args: unknown[]) =>
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  const consoleShim = { log: write, info: write, warn: write, error: write, debug: write, table: write };
  const context = vm.createContext({ bbgm, Math: math, console: consoleShim, structuredClone });
  let timer: NodeJS.Timeout | undefined;
  try {
    const promise = vm.runInContext(`(async () => {\n${source}\n})()`, context, {
      filename,
      timeout: timeoutMs,
    }) as Promise<unknown>;
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`script did not finish within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { console: lines };
  } catch (err) {
    const e = err as Error;
    return { console: lines, error: { name: e?.name ?? "Error", message: e?.message ?? String(err) } };
  } finally {
    clearTimeout(timer);
  }
}
