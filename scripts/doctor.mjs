import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}
function fail(msg) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
}

let exit = 0;

const py = spawnSync("python", ["--version"], { encoding: "utf8" });
if (py.status === 0) ok(`python: ${py.stdout.trim()}`);
else {
  fail("python not found");
  exit = 1;
}

const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
if (pnpm.status === 0) ok(`pnpm: ${pnpm.stdout.trim()}`);
else {
  fail("pnpm not found");
  exit = 1;
}

if (existsSync(join(root, "web", "node_modules"))) ok("web/node_modules present");
else {
  fail("run: pnpm install (from repo root)");
  exit = 1;
}

if (existsSync(join(root, ".tooling", "repo.yaml"))) ok(".tooling/repo.yaml present");
else fail(".tooling/repo.yaml missing (optional)");

process.exit(exit);
