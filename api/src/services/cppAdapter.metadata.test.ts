import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCppSimulation } from "./cppAdapter.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./analysisPython.js", () => ({ runAnalysis: vi.fn(async () => "python") }));

type Mode = "valid" | "missing" | "no-ack" | "wrong-contract" | "wrong-year" | "wrong-count" | "wrong-version";
let directory: string;
let binary: string;
let mode: Mode;
let replaceBinary: boolean;
const beforeBytes = "original executable identity";

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-metadata-test-"));
  binary = path.join(directory, "engine");
  fs.writeFileSync(binary, beforeBytes);
  fs.writeFileSync(path.join(directory, "teams.json"), JSON.stringify({ "0": "BOS" }));
  fs.writeFileSync(path.join(directory, "export.json"), JSON.stringify({
    gameAttributes: { season: 2024, phase: 1 },
    players: [{ pid: 7, tid: 0, born: { year: 1990 }, draft: { year: 2010 },
      firstName: "Metadata", lastName: "Fixture", ratings: [{ season: 2024, spd: 50 }],
      stats: [{ season: 2024, per: 15, gp: 82, min: 1968 }] }],
  }));
  vi.stubEnv("PROGBOX_CPP_BINARY", binary);
  mode = "valid";
  replaceBinary = false;
  vi.mocked(spawn).mockImplementation((_command, args) => {
    const values = args as string[];
    const data = JSON.parse(fs.readFileSync(values[0]!, "utf8"));
    const output = path.join(values[2]!, "fixture-run");
    fs.mkdirSync(path.join(output, "raw"), { recursive: true });
    fs.writeFileSync(path.join(output, "raw", "outputs.csv"), "Player,OVR\nFixture,50\n");
    const metadata: Record<string, any> = {
      input_contract: data._progbox_contract,
      simulation: { year: Number(values[values.indexOf("-y") + 1]) },
      progression: { id: values[values.indexOf("-v") + 1] },
      player_count: 1,
    };
    if (mode === "no-ack") delete metadata.input_contract;
    if (mode === "wrong-contract") metadata.input_contract = { ...metadata.input_contract, pool_count: 900 };
    if (mode === "wrong-year") metadata.simulation.year--;
    if (mode === "wrong-count") metadata.player_count++;
    if (mode === "wrong-version") metadata.progression.id = "v321";
    if (mode !== "missing") fs.writeFileSync(path.join(output, "metadata.json"), JSON.stringify(metadata));
    if (replaceBinary) fs.writeFileSync(binary, "replacement installed while old process runs");
    const proc = Object.assign(new EventEmitter(), {
      stdout: Readable.from([]), stderr: Readable.from([]), exitCode: 0,
    });
    queueMicrotask(() => proc.emit("close", 0));
    return proc as unknown as ReturnType<typeof spawn>;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

const run = (version = "v4.3") => runCppSimulation({
  exportPath: path.join(directory, "export.json"),
  teaminfoPath: path.join(directory, "teams.json"),
  canonicalRunDir: path.join(directory, "run"),
  teams: [], seed: 42, runs: 1, n_workers: 1, version,
});

describe("engine metadata acknowledgement", () => {
  it.each<Mode>(["missing", "no-ack", "wrong-contract", "wrong-year", "wrong-count", "wrong-version"])(
    "rejects %s metadata before saving normalized NET artifacts", async (invalid) => {
      mode = invalid;
      await expect(run()).rejects.toThrow(/metadata|contract|year|count|progression/i);
      expect(fs.existsSync(path.join(directory, "run", "raw"))).toBe(false);
      expect(fs.existsSync(path.join(directory, "run", "engine_metadata.json"))).toBe(false);
    },
  );
  it("records the binary hash captured before launching the process", async () => {
    replaceBinary = true;
    await expect(run()).resolves.toMatchObject({ playerCount: 1 });
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "run", "engine_metadata.json"), "utf8"));
    expect(metadata.binary_sha256).toBe(createHash("sha256").update(beforeBytes).digest("hex"));
    expect(metadata.input_contract).toMatchObject({ id: "net-boundary-v1", target_count: 1 });
  });
  it.each<Mode>(["missing", "no-ack"])("retains legacy behavior for %s metadata", async (legacyMode) => {
    mode = legacyMode;
    await expect(run("v4.1")).resolves.toMatchObject({ playerCount: 1 });
  });
});
