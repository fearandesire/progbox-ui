import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeNetInput } from "../../api/src/services/netInput.ts";
import { analyze } from "./analyze.ts";
import { boundaryFrom, readExport } from "./league.ts";
import { runMany } from "./pool.ts";
import { writeJson } from "./report.ts";
import { packPlayers } from "./simulate.ts";

/**
 * Runs the original NET JavaScript through NET Lab and the hand-ported C++ engine on the same
 * export, then compares each player's mean ΔOVR. The two use different random streams, so the
 * check is statistical: per-player z-scores of the difference in means.
 */
const LAB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = path.resolve(LAB_DIR, "..");
const PAIRS = [
  { version: "v3.2.1", engine: "v321", script: "net-3.2.1" },
  { version: "v4.3", engine: "v43", script: "net-4.3.0" },
] as const;

type Agg = { n: number; sum: number; sum2: number; name: string };
const meanOf = (a: Agg) => a.sum / a.n;
const varOf = (a: Agg) => (a.n > 1 ? (a.sum2 - (a.sum * a.sum) / a.n) / (a.n - 1) : 0);

function readCppOutputs(file: string): Map<number, Agg> {
  const [header, ...lines] = fs.readFileSync(file, "utf8").trim().split("\n");
  const cols = header!.split(",");
  const pidCol = cols.indexOf("PlayerID");
  const deltaCol = cols.indexOf("Delta");
  const nameCol = cols.indexOf("Name");
  const out = new Map<number, Agg>();
  for (const line of lines) {
    const f = line.split(",");
    const pid = Number(f[pidCol]);
    const d = Number(f[deltaCol]);
    const a = out.get(pid) ?? { n: 0, sum: 0, sum2: 0, name: f[nameCol]! };
    a.n++;
    a.sum += d;
    a.sum2 += d * d;
    out.set(pid, a);
  }
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      export: { type: "string", default: "data/export.json" },
      runs: { type: "string", default: "500" },
      seed: { type: "string", default: "69" },
      binary: { type: "string", default: "api/vendor/progbox_cpp/build/progbox" },
      out: { type: "string", default: "outputs/lab/crosscheck" },
    },
  });
  const runs = Number(values.runs);
  const seed = Number(values.seed);
  const exportPath = path.resolve(REPO_DIR, values.export!);
  const binary = path.resolve(REPO_DIR, values.binary!);
  const file = readExport(exportPath);
  const boundary = boundaryFrom(file);
  const teams = Object.fromEntries(
    (file.data.teams ?? []).map((t: { tid: number; abbrev: string }) => [String(t.tid), t.abbrev]),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netlab-crosscheck-"));
  const teaminfo = path.join(tmp, "teaminfo.json");
  fs.writeFileSync(teaminfo, JSON.stringify(teams));
  const report: Record<string, unknown> = { export_sha256: file.sha256, runs, seed };
  const failed: string[] = [];

  for (const pair of PAIRS) {
    process.stderr.write(`\n== ${pair.version}\n`);
    const normalized = normalizeNetInput(file.data, teams, [], pair.version);
    const normPath = path.join(tmp, `export-${pair.engine}.json`);
    fs.writeFileSync(normPath, JSON.stringify(normalized.data));
    const outDir = path.join(tmp, `cpp-${pair.engine}`);
    fs.mkdirSync(outDir);
    execFileSync(binary, [normPath, teaminfo, outDir, "-v", pair.engine, "-r", String(runs), "-s", String(seed), "-y", String(normalized.contract.entering_season), "--no-analysis"], { cwd: tmp, stdio: ["ignore", "ignore", "inherit"] });
    const runDir = path.join(outDir, fs.readdirSync(outDir)[0]!);
    const cpp = readCppOutputs(path.join(runDir, "raw", "outputs.csv"));

    const { players, ...meta } = boundary;
    const script = { name: pair.script, source: fs.readFileSync(path.join(LAB_DIR, "scripts", `${pair.script}.js`), "utf8") };
    const pre = { name: "worker-console", source: fs.readFileSync(path.join(LAB_DIR, "scripts", "worker-console.js"), "utf8") };
    const results = await runMany({ meta, playersBuf: packPlayers(players), pre, script }, { runs, seed });
    const js = analyze(boundary, results);
    const jsBy = new Map(js.players.map((p) => [p.pid, p]));

    const onlyCpp = [...cpp.keys()].filter((pid) => !jsBy.has(pid));
    const onlyJs = [...jsBy.keys()].filter((pid) => !cpp.has(pid));
    const zs: { pid: number; name: string; js: number; cpp: number; z: number }[] = [];
    let cppSum = 0;
    let cppN = 0;
    for (const [pid, c] of cpp) {
      cppSum += c.sum;
      cppN += c.n;
      const j = jsBy.get(pid);
      if (!j) continue;
      const se = Math.sqrt((j.sdDelta ** 2) / j.runs + varOf(c) / c.n) || 1e-9;
      zs.push({ pid, name: c.name, js: j.meanDelta, cpp: meanOf(c), z: (j.meanDelta - meanOf(c)) / se });
    }
    zs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const absDiff = zs.map((z) => Math.abs(z.js - z.cpp));
    const summary = {
      targets: { cpp: cpp.size, js: jsBy.size, matched: zs.length, only_cpp: onlyCpp.slice(0, 20), only_js: onlyJs.slice(0, 20) },
      league_mean_delta: { cpp: cppSum / cppN, js: js.kpis.meanDelta },
      mean_abs_player_diff: absDiff.reduce((a, b) => a + b, 0) / (absDiff.length || 1),
      share_abs_z_over_3: zs.filter((z) => Math.abs(z.z) > 3).length / (zs.length || 1),
      share_abs_z_over_4: zs.filter((z) => Math.abs(z.z) > 4).length / (zs.length || 1),
      worst: zs.slice(0, 10),
      js_errors: js.errors.slice(0, 5),
    };
    // Gate: identical target sets, league means within 0.1 OVR, no per-player gap beyond 4 SE.
    const pass = !onlyCpp.length && !onlyJs.length && !js.errors.length
      && Math.abs(summary.league_mean_delta.cpp - summary.league_mean_delta.js) < 0.1
      && summary.share_abs_z_over_4 === 0;
    if (!pass) failed.push(pair.version);
    report[pair.version] = { pass, ...summary };
    process.stderr.write(`${JSON.stringify({ ...summary, worst: summary.worst.slice(0, 3) }, null, 1)}\n`);
  }
  const out = path.resolve(REPO_DIR, values.out!, new Date().toISOString().replace(/\D/g, "").slice(0, 14), "crosscheck.json");
  writeJson(out, report);
  process.stdout.write(`${failed.length ? `CROSSCHECK FAIL (${failed.join(", ")})` : "CROSSCHECK PASS"}: ${out}\n`);
  if (failed.length) process.exitCode = 1;
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
