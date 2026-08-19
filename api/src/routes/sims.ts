import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { availableParallelism } from "node:os";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { isValidBuildId } from "../buildId.js";
import { outputsRoot } from "../paths.js";
import * as engineAdapter from "../services/engineAdapter.js";
import { PROGRESS, runSimulationJob } from "../services/runner.js";
import * as storage from "../services/storage.js";
import {
  generateTeaminfo,
  validateTeaminfo,
  InvalidTeaminfoError,
} from "../services/teaminfo.js";
import {
  analysisDashboardPath,
  analysisXlsxPath,
  ArtifactNotFoundError,
  chartPath,
  comparisonCacheDir,
  comparisonDashboardPath,
  godprogsRecords,
  InvalidChartNameError,
  listChartFilenames,
  playerAllRuns,
  playerSummaries,
  rawOutputsCsvPath,
} from "../services/simArtifacts.js";
import { runPythonComparison } from "../services/analysisPython.js";
import {
  MarkersNotFoundError,
  getAnalysisData,
  getComparisonData,
  getComparisonScorecard,
} from "../services/analysisExtract.js";
import type { SimProgressPayload } from "../types.js";

export interface SimsRouteOptions {
  scheduleBackground: (task: () => void | Promise<void>) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\+00:00$/, "Z");
}

function formatBuildId(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function newBuildId(): string {
  return formatBuildId(new Date());
}

/** Parse a second-precision CalVer build id back into a UTC Date. */
function buildIdToDate(build: string): Date {
  return new Date(
    Date.UTC(
      Number(build.slice(0, 4)),
      Number(build.slice(4, 6)) - 1,
      Number(build.slice(6, 8)),
      Number(build.slice(8, 10)),
      Number(build.slice(10, 12)),
      Number(build.slice(12, 14)),
    ),
  );
}

/** Nudge a build id forward by one second, keeping it a valid CalVer id. */
function bumpBuildId(build: string): string {
  const d = buildIdToDate(build);
  d.setUTCSeconds(d.getUTCSeconds() + 1);
  return formatBuildId(d);
}

/**
 * Reserve a unique run directory with an exclusive mkdir (no recursive create).
 * Retries by bumping the CalVer id when the candidate already exists — prevents
 * two concurrent POSTs from sharing the same second-precision build dir.
 */
async function allocateBuildDir(startFrom?: string): Promise<{ build: string; out: string }> {
  await fsp.mkdir(outputsRoot(), { recursive: true });
  let candidate = startFrom ?? newBuildId();
  for (let attempt = 0; attempt < 32; attempt++) {
    const out = path.join(outputsRoot(), candidate);
    try {
      await fsp.mkdir(out);
      return { build: candidate, out };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      candidate = bumpBuildId(candidate);
    }
  }
  throw new Error("Could not allocate a unique build id");
}

async function removeRunDirs(...dirs: readonly string[]): Promise<void> {
  await Promise.all(
    dirs.map((dir) => fsp.rm(dir, { recursive: true, force: true }).catch(() => {})),
  );
}

function defaultNWorkers(requested: number | null | undefined): number {
  if (requested != null) return requested;
  // Requires Node.js >= 18.14.0 for os.availableParallelism
  const cpu =
    typeof availableParallelism === "function" ? availableParallelism() : 4;
  return Math.max(cpu - 1, 1);
}

/** Progression-script versions the engine can run. Default is the adopted v4.3. */
export const PROGRESSION_VERSIONS = ["v41", "v43"] as const;
export type ProgressionVersion = (typeof PROGRESSION_VERSIONS)[number];

/** Human display label for a progression version id. */
function versionLabel(version: string): string {
  return version === "v43" ? "v4.3" : version === "v41" ? "v4.1" : version;
}

const SimCreateBodySchema = z.object({
  teams: z.array(z.string()).default([]),
  seed: z.number().int().default(69),
  runs: z.number().int().positive().default(500),
  n_workers: z.number().int().positive().nullable().optional(),
  version: z.enum(PROGRESSION_VERSIONS).default("v43"),
  compare: z.boolean().default(true),
});

/** The progression version that isn't the selected one (binary enum today). */
function otherVersion(version: ProgressionVersion): ProgressionVersion {
  return PROGRESSION_VERSIONS.find((v) => v !== version) ?? version;
}

type SimCreateBody = z.infer<typeof SimCreateBodySchema>;

function parseSimCreateBody(json: string): SimCreateBody {
  const data = JSON.parse(json);
  return SimCreateBodySchema.parse(data);
}

function badRequest(reply: FastifyReply, status: number, detail: string) {
  return reply.status(status).send({ detail });
}

async function rejectAndCleanup(
  reply: FastifyReply,
  dirs: readonly string[],
  status: number,
  detail: string,
) {
  await removeRunDirs(...dirs);
  return badRequest(reply, status, detail);
}

async function validateBuildIdHandler(
  request: { params: unknown },
  reply: FastifyReply,
) {
  const { build } = request.params as { build: string };
  if (!isValidBuildId(build)) {
    return badRequest(reply, 422, "Invalid build id");
  }
  if (storage.getRun(build) == null) {
    return reply.status(404).send({ detail: "Run not found" });
  }
}

export async function registerSimsRoutes(
  fastify: FastifyInstance,
  opts: SimsRouteOptions,
): Promise<void> {
  fastify.get("/api/sims", async (_request, reply) => {
    return reply.send(storage.listRuns());
  });

  fastify.post("/api/sims", async (request, reply) => {
    let exportPath: string | null = null;
    let teaminfoPath: string | null = null;
    let configStr = "";

    const { build, out } = await allocateBuildDir();
    const allocatedDirs: string[] = [out];

    const tempFiles: string[] = [];
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname === "export") {
            const tempPath = path.join(out, ".export.tmp");
            tempFiles.push(tempPath);
            await pipeline(part.file, fs.createWriteStream(tempPath));
            const finalPath = path.join(out, "export.json");
            await fsp.rename(tempPath, finalPath);
            exportPath = finalPath;
            tempFiles.splice(tempFiles.indexOf(tempPath), 1);
          } else if (part.fieldname === "teaminfo") {
            const tempPath = path.join(out, ".teaminfo.tmp");
            tempFiles.push(tempPath);
            await pipeline(part.file, fs.createWriteStream(tempPath));
            const finalPath = path.join(out, "teaminfo.json");
            await fsp.rename(tempPath, finalPath);
            teaminfoPath = finalPath;
            tempFiles.splice(tempFiles.indexOf(tempPath), 1);
          }
        } else if (part.fieldname === "config") {
          configStr = String(part.value ?? "");
        }
      }

      if (!exportPath) {
        return rejectAndCleanup(reply, allocatedDirs, 422, "export file is empty");
      }

      const exportStat = await fsp.stat(exportPath);
      if (exportStat.size === 0) {
        return rejectAndCleanup(reply, allocatedDirs, 422, "export file is empty");
      }

      let body: SimCreateBody;
      try {
        body = parseSimCreateBody(configStr);
      } catch (e) {
        return rejectAndCleanup(
          reply,
          allocatedDirs,
          422,
          `config is not valid JSON: ${String(e)}`,
        );
      }

      const n_workers = defaultNWorkers(body.n_workers);
      if (n_workers < 1) {
        return rejectAndCleanup(reply, allocatedDirs, 422, "n_workers must be >= 1");
      }

      let exportData: Record<string, unknown>;
      try {
        const exportBuf = await fsp.readFile(exportPath, "utf8");
        exportData = JSON.parse(exportBuf) as Record<string, unknown>;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return rejectAndCleanup(reply, allocatedDirs, 422, `export is not valid JSON: ${msg}`);
      }

      let teaminfoSource: "generated" | "user";
      let teaminfoMap: Record<string, string>;

      if (teaminfoPath != null) {
        const teaminfoStat = await fsp.stat(teaminfoPath);
        if (teaminfoStat.size === 0) {
          return rejectAndCleanup(reply, allocatedDirs, 422, "teaminfo file is empty");
        }
        try {
          const teaminfoBuf = await fsp.readFile(teaminfoPath, "utf8");
          const rawTeaminfo = JSON.parse(teaminfoBuf);
          teaminfoMap = validateTeaminfo(rawTeaminfo);
        } catch (e) {
          if (e instanceof InvalidTeaminfoError) {
            return rejectAndCleanup(reply, allocatedDirs, 400, e.message);
          }
          if (e instanceof SyntaxError) {
            return rejectAndCleanup(
              reply,
              allocatedDirs,
              400,
              `teaminfo.json is not valid JSON: ${e.message}`,
            );
          }
          throw e;
        }
        teaminfoSource = "user";
      } else {
        teaminfoMap = generateTeaminfo(exportData);
        teaminfoSource = "generated";
      }

      if (!teaminfoPath) {
        teaminfoPath = path.join(out, "teaminfo.json");
      }
      await fsp.writeFile(
        teaminfoPath,
        JSON.stringify(teaminfoMap, null, 2),
        "utf8",
      );

      const exportMeta = exportData.meta as Record<string, unknown> | undefined;
      const exportTitle = typeof exportMeta?.title === "string" ? exportMeta.title : null;

      interface PairFields {
        pair_id: string;
        pair_role: "primary" | "baseline";
        paired_with: string;
      }

      function buildMeta(
        runBuild: string,
        version: ProgressionVersion,
        pair: PairFields | null,
      ): Record<string, unknown> {
        return {
          build: runBuild,
          // Requested version recorded now; runner patches script_version + progression
          // from the engine's own metadata post-run (executed truth).
          requested_version: version,
          script_version: versionLabel(version),
          engine_build: engineAdapter.engineBuildVersion(),
          teams: body.teams,
          seed: body.seed,
          runs: body.runs,
          n_workers,
          export_file: `outputs/${runBuild}/export.json`,
          export_title: exportTitle,
          teaminfo_file: `outputs/${runBuild}/teaminfo.json`,
          teaminfo_source: teaminfoSource,
          status: "running",
          started_at: utcNowIso(),
          completed_at: null,
          player_count: null,
          analysis_engine: null,
          error: null,
          ...(pair ?? {}),
        };
      }

      function scheduleRun(
        runBuild: string,
        runExportPath: string,
        runTeaminfoPath: string,
        version: ProgressionVersion,
      ) {
        opts.scheduleBackground(() =>
          runSimulationJob(
            runBuild,
            runExportPath,
            runTeaminfoPath,
            body.teams,
            body.seed,
            body.runs,
            n_workers,
            version,
          ),
        );
      }

      if (body.compare) {
        // Auto-comparison: a second run with the OTHER version, same inputs, its own
        // run dir. The selected version is primary; the other is the baseline.
        const baselineVersion = otherVersion(body.version);
        // Start from the next second so we never reuse the primary id; exclusive mkdir
        // then retries further if that slot is already taken by another request.
        const { build: baselineBuild, out: baselineOut } = await allocateBuildDir(
          bumpBuildId(build),
        );
        allocatedDirs.push(baselineOut);
        const pairId = build;

        const baselineExportPath = path.join(baselineOut, "export.json");
        const baselineTeaminfoPath = path.join(baselineOut, "teaminfo.json");
        await fsp.copyFile(exportPath, baselineExportPath);
        await fsp.copyFile(teaminfoPath, baselineTeaminfoPath);

        const primaryMeta = buildMeta(build, body.version, {
          pair_id: pairId,
          pair_role: "primary",
          paired_with: baselineBuild,
        });
        const baselineMeta = buildMeta(baselineBuild, baselineVersion, {
          pair_id: pairId,
          pair_role: "baseline",
          paired_with: build,
        });
        try {
          await fsp.writeFile(
            path.join(out, "metadata.json"),
            JSON.stringify(primaryMeta, null, 2),
            "utf8",
          );
          await fsp.writeFile(
            path.join(baselineOut, "metadata.json"),
            JSON.stringify(baselineMeta, null, 2),
            "utf8",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return rejectAndCleanup(
            reply,
            allocatedDirs,
            500,
            `Failed to write run metadata: ${msg}`,
          );
        }

        // Primary first so callers/tests see the selected version as the first job.
        scheduleRun(build, exportPath, teaminfoPath, body.version);
        scheduleRun(baselineBuild, baselineExportPath, baselineTeaminfoPath, baselineVersion);

        return reply.send({ build, compare_build: baselineBuild, pair_id: pairId });
      }

      const meta = buildMeta(build, body.version, null);
      try {
        await fsp.writeFile(path.join(out, "metadata.json"), JSON.stringify(meta, null, 2), "utf8");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return rejectAndCleanup(
          reply,
          allocatedDirs,
          500,
          `Failed to write run metadata: ${msg}`,
        );
      }

      scheduleRun(build, exportPath, teaminfoPath, body.version);

      return reply.send({ build });
    } catch (err) {
      await removeRunDirs(...allocatedDirs);
      // Clean up temp files on error
      for (const tmpFile of tempFiles) {
        await fsp.rm(tmpFile, { force: true }).catch(() => {});
      }
      throw err;
    } finally {
      // Clean up any remaining temp files
      for (const tmpFile of tempFiles) {
        await fsp.rm(tmpFile, { force: true }).catch(() => {});
      }
    }
  });

  fastify.get("/api/sims/:build/progress", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params as { build: string };

    async function* eventStream(): AsyncGenerator<string> {
      while (true) {
        const run = storage.getRun(build);
        const st = PROGRESS.get(build);
        if (st) {
          const payload: SimProgressPayload = {
            phase: st.phase,
            pct: st.pct,
            message: st.message,
            done: st.done,
          };
          yield `data: ${JSON.stringify(payload)}\n\n`;
          if (st.done) break;
          await delay(350);
          continue;
        }
        if (run == null) {
          yield `data: ${JSON.stringify({
            phase: "error",
            pct: 0,
            message: "Run not found",
            done: true,
          })}\n\n`;
          break;
        }
        if (run.status === "complete") {
          yield `data: ${JSON.stringify({
            phase: "complete",
            pct: 100,
            message: "Complete",
            done: true,
          })}\n\n`;
          break;
        }
        if (run.status === "failed") {
          yield `data: ${JSON.stringify({
            phase: "failed",
            pct: 0,
            message: run.error ?? "Failed",
            done: true,
          })}\n\n`;
          break;
        }
        yield `data: ${JSON.stringify({
          phase: "running",
          pct: 0,
          message: "Starting…",
          done: false,
        })}\n\n`;
        await delay(350);
      }
    }

    return reply
      .header("Content-Type", "text/event-stream")
      .header("Cache-Control", "no-cache")
      .header("Connection", "keep-alive")
      .header("X-Accel-Buffering", "no")
      .send(Readable.from(eventStream()));
  });

  fastify.get("/api/sims/:build/charts", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params as { build: string };
    return reply.send(listChartFilenames(build));
  });

  fastify.get("/api/sims/:build/charts/:name", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build, name } = request.params as { build: string; name: string };
    try {
      const p = chartPath(build, name);
      return reply.type("image/png").send(fs.createReadStream(p));
    } catch (e) {
      if (e instanceof InvalidChartNameError) {
        return badRequest(reply, 400, e.message);
      }
      if (e instanceof ArtifactNotFoundError) {
        return reply.status(404).send({ detail: "Chart not found" });
      }
      throw e;
    }
  });

  fastify.get("/api/sims/:build/players", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params as { build: string };
    try {
      return reply.send(playerSummaries(build));
    } catch {
      return reply.status(404).send({ detail: "outputs.csv not found yet" });
    }
  });

  fastify.get("/api/sims/:build/players/:pid", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build, pid } = request.params as { build: string; pid: string };
    try {
      const rows = playerAllRuns(build, pid);
      if (!rows.length) {
        return reply.status(404).send({ detail: "Player not found" });
      }
      return reply.send(rows);
    } catch {
      return reply.status(404).send({ detail: "outputs.csv not found yet" });
    }
  });

  fastify.get("/api/sims/:build/godprogs", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params as { build: string };
    return reply.send(godprogsRecords(build));
  });

  fastify.get<{
    Params: { build: string };
    Querystring: { artifact?: string };
  }>("/api/sims/:build/download", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params;
    const artifact = request.query.artifact ?? "analysis";
    if (["analysis", "xlsx", "analysis.xlsx"].includes(artifact)) {
      const p = analysisXlsxPath(build);
      if (!fs.existsSync(p)) {
        return reply.status(404).send({ detail: "analysis.xlsx not found" });
      }
      return reply
        .header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header("Content-Disposition", 'attachment; filename="analysis.xlsx"')
        .send(fs.createReadStream(p));
    }
    if (["csv", "raw", "outputs.csv"].includes(artifact)) {
      const p = rawOutputsCsvPath(build);
      if (!fs.existsSync(p)) {
        return reply.status(404).send({ detail: "outputs.csv not found" });
      }
      return reply
        .type("text/csv")
        .header("Content-Disposition", 'attachment; filename="outputs.csv"')
        .send(fs.createReadStream(p));
    }
    return badRequest(reply, 422, "Invalid file query (use analysis or csv)");
  });

  fastify.delete("/api/sims/:build", async (request, reply) => {
    const { build } = request.params as { build: string };
    if (!isValidBuildId(build)) return badRequest(reply, 422, "Invalid build id");
    PROGRESS.delete(build);
    if (!storage.deleteRun(build)) {
      return reply.status(404).send({ detail: "Run not found" });
    }
    return reply.send({ ok: true });
  });

  fastify.get("/api/sims/:build/analysis", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params as { build: string };
    const htmlPath = analysisDashboardPath(build);
    if (!fs.existsSync(htmlPath)) {
      return reply
        .status(404)
        .send({ detail: "analysis_dashboard.html not found for this run" });
    }
    return reply.type("text/html").send(fs.createReadStream(htmlPath));
  });

  /**
   * Shared validate + ensure-generated logic for the comparison routes.
   * Sends the error response and returns null on failure; returns the
   * comparison cache key once comparison_dashboard.html exists.
   */
  async function ensureComparison(
    buildsQuery: string | undefined,
    reply: FastifyReply,
  ): Promise<string | null> {
    const rawBuilds = (buildsQuery ?? "")
      .split(",")
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    const builds = [...new Set(rawBuilds)];

    if (builds.length < 2) {
      badRequest(reply, 400, "Provide at least 2 build ids to compare");
      return null;
    }
    for (const b of builds) {
      if (!isValidBuildId(b)) {
        badRequest(reply, 422, `Invalid build id: ${b}`);
        return null;
      }
    }
    for (const b of builds) {
      const run = storage.getRun(b);
      if (run == null) {
        reply.status(404).send({ detail: `Run not found: ${b}` });
        return null;
      }
      if (run.status !== "complete") {
        reply.status(409).send({ detail: `Run not complete: ${b}` });
        return null;
      }
    }

    // Cache keyed by the sorted build-id set: order-independent, reused on repeat.
    const key = [...builds].sort().join("_");
    const htmlPath = comparisonDashboardPath(key);
    if (!fs.existsSync(htmlPath)) {
      const runDirs = builds.map((b) => path.join(outputsRoot(), b));
      try {
        await runPythonComparison(runDirs, comparisonCacheDir(key));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        reply.status(500).send({ detail: `Comparison generation failed: ${msg}` });
        return null;
      }
      if (!fs.existsSync(htmlPath)) {
        reply.status(500).send({ detail: "Comparison dashboard was not produced" });
        return null;
      }
    }
    return key;
  }

  fastify.get<{ Querystring: { builds?: string } }>(
    "/api/sims/compare",
    async (request, reply) => {
      const key = await ensureComparison(request.query.builds, reply);
      if (key == null) return reply;
      return reply
        .type("text/html")
        .send(fs.createReadStream(comparisonDashboardPath(key)));
    },
  );

  fastify.get<{ Querystring: { builds?: string } }>(
    "/api/sims/compare-data",
    async (request, reply) => {
      const key = await ensureComparison(request.query.builds, reply);
      if (key == null) return reply;
      try {
        const data = getComparisonData(key);
        return reply.send({
          ...data,
          engine: "python",
          builds: key.split("_"),
          scorecard: getComparisonScorecard(key),
        });
      } catch (e) {
        if (e instanceof MarkersNotFoundError) {
          return reply.status(409).send({
            detail: "Native comparison unavailable: dashboard markers not found",
          });
        }
        throw e;
      }
    },
  );

  fastify.get(
    "/api/sims/:build/analysis-data",
    { preHandler: validateBuildIdHandler },
    async (request, reply) => {
      const { build } = request.params as { build: string };
      const htmlPath = analysisDashboardPath(build);
      if (!fs.existsSync(htmlPath)) {
        return reply
          .status(404)
          .send({ detail: "analysis_dashboard.html not found for this run" });
      }
      const run = storage.getRun(build);
      if (run?.analysis_engine === "fallback") {
        return reply.status(409).send({
          detail: "Native analysis unavailable: run used the fallback analysis engine",
        });
      }
      try {
        const data = getAnalysisData(build);
        return reply.send({ ...data, engine: "python", build });
      } catch (e) {
        if (e instanceof MarkersNotFoundError) {
          return reply.status(409).send({
            detail: "Native analysis unavailable: dashboard markers not found",
          });
        }
        throw e;
      }
    },
  );

  fastify.get("/api/sims/:build", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params as { build: string };
    const run = storage.getRun(build);
    return reply.send(run);
  });
}
