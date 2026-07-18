import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { runPythonComparison } from "./analysisPython.js";

type FakeProcess = EventEmitter & { stderr: EventEmitter };

function fakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stderr = new EventEmitter();
  return proc;
}

function writeComparisonOutputs(runDir: string): void {
  fs.writeFileSync(path.join(runDir, "comparison_dashboard.html"), "<html>comparison</html>");
  fs.writeFileSync(path.join(runDir, "comparison_scorecard.csv"), "metric,value\nscore,1\n");
}

const roots: string[] = [];

afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("runPythonComparison", () => {
  it("serializes generation and reuses an existing cache", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-comparison-lock-"));
    roots.push(root);
    const runA = path.join(root, "run-a");
    const runB = path.join(root, "run-b");
    const runC = path.join(root, "run-c");
    const cacheAB = path.join(root, "cache-ab");
    const cacheAC = path.join(root, "cache-ac");
    for (const dir of [runA, runB, runC]) fs.mkdirSync(dir);

    const firstProcess = fakeProcess();
    const secondProcess = fakeProcess();
    const spawnMock = vi.mocked(spawn);
    spawnMock
      .mockReturnValueOnce(firstProcess as unknown as ReturnType<typeof spawn>)
      .mockReturnValueOnce(secondProcess as unknown as ReturnType<typeof spawn>);

    const first = runPythonComparison([runA, runB], cacheAB);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));

    const second = runPythonComparison([runA, runC], cacheAC);
    await Promise.resolve();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    writeComparisonOutputs(runA);
    firstProcess.emit("close", 0);
    await first;
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));

    writeComparisonOutputs(runA);
    secondProcess.emit("close", 0);
    await second;

    expect(fs.existsSync(path.join(cacheAB, "comparison_dashboard.html"))).toBe(true);
    expect(fs.existsSync(path.join(cacheAC, "comparison_dashboard.html"))).toBe(true);

    await runPythonComparison([runA, runB], cacheAB);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
