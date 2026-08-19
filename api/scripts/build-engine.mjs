import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = resolve(apiRoot, "vendor", "progbox_cpp");
const buildDir = resolve(engineRoot, "build");

function normalizePath(p) {
  let normalized = resolve(p).replace(/\\/g, "/");
  if (process.platform === "win32") {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function detectCachedSourceMismatch() {
  const cacheFile = join(buildDir, "CMakeCache.txt");
  if (!existsSync(cacheFile)) {
    return false;
  }
  try {
    const content = readFileSync(cacheFile, "utf8");
    const match = content.match(/^CMAKE_HOME_DIRECTORY(?::[A-Z_]+)?=(.+)$/m);
    if (!match) {
      return false;
    }
    const cached = normalizePath(match[1].trim());
    const current = normalizePath(engineRoot);
    return cached !== current;
  } catch {
    return false;
  }
}

function ensureCMakeOnPath() {
  const result = spawnSync("cmake", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(
      "cmake was not found on PATH. Install CMake.\n" +
      "  WSL/Ubuntu: sudo apt update && sudo apt install -y cmake build-essential\n" +
      "  Windows: install CMake and Visual Studio Build Tools (Desktop development with C++), then reopen the terminal.",
    );
    process.exit(1);
  }
}

function run(command, args, cwd, captureStderr = false) {
  const stdio = captureStderr
    ? ["inherit", "inherit", "pipe"]
    : "inherit";

  const result = spawnSync(command, args, {
    cwd,
    stdio,
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  const stderrStr = captureStderr && result.stderr ? result.stderr.toString() : "";

  return { status: result.status ?? 1, stderr: stderrStr };
}

function configureAndBuild(captureStderr = false) {
  const configureResult = run("cmake", ["..", "-DCMAKE_BUILD_TYPE=Release"], buildDir, captureStderr);
  if (configureResult.status !== 0) {
    return configureResult;
  }
  // Without --parallel, CMake's Makefile generator compiles serially and the
  // extra CI cores go unused. availableParallelism respects CPU affinity, so it
  // reports the cores we can actually use rather than the host's total.
  const jobs = Math.max(1, availableParallelism());
  return run("cmake", ["--build", ".", "--config", "Release", "--parallel", String(jobs)], buildDir, captureStderr);
}

function isCacheMismatchError(stderr) {
  return (
    stderr.includes("is different than the directory") ||
    stderr.includes("does not match the source")
  );
}

ensureCMakeOnPath();

mkdirSync(buildDir, { recursive: true });

if (detectCachedSourceMismatch()) {
  console.error("CMake cache mismatch detected — clearing build directory...");
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
}

let result = configureAndBuild(false);

if (result.status !== 0) {
  const isMismatch = isCacheMismatchError(result.stderr);
  if (isMismatch) {
    console.error("CMake cache/source mismatch — retrying with clean build...");
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });
    result = configureAndBuild(true);
  }
}

if (result.status !== 0) {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exit(result.status);
}
