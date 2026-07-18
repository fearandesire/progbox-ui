import { readCppVersion } from "../paths.js";

/**
 * Engine binary build identifier (from the vendored `VERSION` file, e.g. the
 * CMake project version). This is the BUILD of the C++ engine — deliberately
 * distinct from the per-run progression-script version (`v41`/`v43`), which is
 * chosen at run time and reported by the engine's own metadata.json.
 */
export function engineBuildVersion(): string {
  return readCppVersion();
}
