import { readCppVersion } from "../paths.js";

/**
 * Engine binary build identifier (from the vendored `VERSION` file, e.g. the
 * CMake project version). This is the BUILD of the C++ engine — deliberately
 * distinct from the per-run progression-script version (`v3.2.1`/`v4.1`/`v4.3`), which is
 * chosen at run time and reported by the engine's own metadata.json. Public ids
 * map to compact engine CLI ids via `engineScriptId` (`v3.2.1`→`v321`, `v4.1`→`v41`,
 * `v4.3`→`v43`).
 */
export function engineBuildVersion(): string {
  return readCppVersion();
}
