import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
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
  vi.restoreAllMocks();
  vi.resetAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("runPythonComparison", () => {
  it("does not publish HTML while a cross-device copy is still in progress", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-comparison-copy-"));
    roots.push(root);
    const run = path.join(root, "run");
    const cache = path.join(root, "cache");
    fs.mkdirSync(run);
    const proc = fakeProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
    const originalRename = fsp.rename.bind(fsp);
    const originalCopy = fsp.copyFile.bind(fsp);
    let release!: () => void;
    let copying!: () => void;
    const copyStarted = new Promise<void>((resolve) => { copying = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(fsp, "rename").mockImplementation(async (src, dst) => {
      if (String(src) === path.join(run, "comparison_dashboard.html")) {
        throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      }
      return originalRename(src, dst);
    });
    vi.spyOn(fsp, "copyFile").mockImplementation(async (src, dst, mode) => {
      if (String(src) === path.join(run, "comparison_dashboard.html")) {
        fs.writeFileSync(dst, "partial");
        copying();
        await blocked;
      }
      return originalCopy(src, dst, mode);
    });

    const generating = runPythonComparison([run], cache);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    writeComparisonOutputs(run);
    proc.emit("close", 0);
    await copyStarted;
    const htmlPath = path.join(cache, "comparison_dashboard.html");
    const publishedEarly = fs.existsSync(htmlPath);
    release();
    await generating;
    expect(publishedEarly).toBe(false);
    expect(fs.readFileSync(htmlPath, "utf8")).toBe("<html>comparison</html>");
    expect(fs.existsSync(path.join(cache, "comparison_scorecard.csv"))).toBe(true);
  });

  it("fails generation without publishing HTML when the scorecard is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-comparison-missing-scorecard-"));
    roots.push(root);
    const run = path.join(root, "run");
    const cache = path.join(root, "cache");
    fs.mkdirSync(run);
    const proc = fakeProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
    const generating = runPythonComparison([run], cache);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    fs.writeFileSync(path.join(run, "comparison_dashboard.html"), "<html>comparison</html>");
    proc.emit("close", 0);
    await expect(generating).rejects.toThrow("comparison_scorecard.csv");
    expect(fs.existsSync(path.join(cache, "comparison_dashboard.html"))).toBe(false);
  });

  it("publishes the dashboard only after its scorecard has been moved", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-comparison-publish-"));
    roots.push(root);
    const run = path.join(root, "run");
    const cache = path.join(root, "cache");
    fs.mkdirSync(run);
    const proc = fakeProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
    const originalRename = fsp.rename.bind(fsp);
    let release!: () => void;
    let movingCsv!: () => void;
    const csvStarted = new Promise<void>((resolve) => { movingCsv = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(fsp, "rename").mockImplementation(async (src, dst) => {
      if (String(src).endsWith("comparison_scorecard.csv")) { movingCsv(); await blocked; }
      return originalRename(src, dst);
    });
    const generating = runPythonComparison([run], cache);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    writeComparisonOutputs(run);
    proc.emit("close", 0);
    await csvStarted;
    const publishedEarly = fs.existsSync(path.join(cache, "comparison_dashboard.html"));
    release();
    await generating;
    expect(publishedEarly).toBe(false);
    expect(fs.existsSync(path.join(cache, "comparison_scorecard.csv"))).toBe(true);
  });

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
