import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (directory containing `api/`). */
export function repoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

/** Resolved `outputs/` directory (env override or repo-relative). */
export function outputsRoot(): string {
  const override = process.env.PROGBOX_OUTPUTS_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(repoRoot(), "outputs");
}

export function vendorCppDir(): string {
  return path.join(repoRoot(), "api", "vendor", "progbox_cpp");
}

/** Engine binary build id from the vendored `VERSION` file (NOT the progression-script version). */
export function readCppVersion(): string {
  const versionFile = path.join(vendorCppDir(), "VERSION");
  try {
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, "utf8").trim();
    }
  } catch {
    /* ignore */
  }
  return "unknown";
}
