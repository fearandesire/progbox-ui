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
  godprogsRecords,
  InvalidChartNameError,
  listChartFilenames,
  playerAllRuns,
  playerSummaries,
  rawOutputsCsvPath,
} from "../services/simArtifacts.js";
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

function newBuildId(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function defaultNWorkers(requested: number | null | undefined): number {
  if (requested != null) return requested;
  // Requires Node.js >= 18.14.0 for os.availableParallelism
  const cpu =
    typeof availableParallelism === "function" ? availableParallelism() : 4;
  return Math.max(cpu - 1, 1);
}

const SimCreateBodySchema = z.object({
  teams: z.array(z.string()).default([]),
  seed: z.number().int().default(69),
  runs: z.number().int().positive().default(500),
  n_workers: z.number().int().positive().nullable().optional(),
});

type SimCreateBody = z.infer<typeof SimCreateBodySchema>;

function parseSimCreateBody(json: string): SimCreateBody {
  const data = JSON.parse(json);
  return SimCreateBodySchema.parse(data);
}

function badRequest(reply: FastifyReply, status: number, detail: string) {
  return reply.status(status).send({ detail });
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

    const build = newBuildId();
    const out = path.join(outputsRoot(), build);
    await fsp.mkdir(out, { recursive: true });

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
        return badRequest(reply, 422, "export file is empty");
      }

      const exportStat = await fsp.stat(exportPath);
      if (exportStat.size === 0) {
        return badRequest(reply, 422, "export file is empty");
      }

      let body: SimCreateBody;
      try {
        body = parseSimCreateBody(configStr);
      } catch (e) {
        return badRequest(reply, 422, `config is not valid JSON: ${String(e)}`);
      }

      const n_workers = defaultNWorkers(body.n_workers);
      if (n_workers < 1) {
        return badRequest(reply, 422, "n_workers must be >= 1");
      }

      let exportData: Record<string, unknown>;
      try {
        const exportBuf = await fsp.readFile(exportPath, "utf8");
        exportData = JSON.parse(exportBuf) as Record<string, unknown>;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return badRequest(reply, 422, `export is not valid JSON: ${msg}`);
      }

      let teaminfoSource: "generated" | "user";
      let teaminfoMap: Record<string, string>;

      if (teaminfoPath != null) {
        const teaminfoStat = await fsp.stat(teaminfoPath);
        if (teaminfoStat.size === 0) {
          return badRequest(reply, 422, "teaminfo file is empty");
        }
        try {
          const teaminfoBuf = await fsp.readFile(teaminfoPath, "utf8");
          const rawTeaminfo = JSON.parse(teaminfoBuf);
          teaminfoMap = validateTeaminfo(rawTeaminfo);
        } catch (e) {
          if (e instanceof InvalidTeaminfoError) {
            return badRequest(reply, 400, e.message);
          }
          if (e instanceof SyntaxError) {
            return badRequest(reply, 400, `teaminfo.json is not valid JSON: ${e.message}`);
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

      const meta = {
        build,
        script_version: engineAdapter.scriptVersion(),
        teams: body.teams,
        seed: body.seed,
        runs: body.runs,
        n_workers,
        export_file: `outputs/${build}/export.json`,
        teaminfo_file: `outputs/${build}/teaminfo.json`,
        teaminfo_source: teaminfoSource,
        status: "running",
        started_at: utcNowIso(),
        completed_at: null,
        player_count: null,
        config_snapshot: engineAdapter.configSnapshot(),
        error: null,
      };
      await fsp.writeFile(path.join(out, "metadata.json"), JSON.stringify(meta, null, 2), "utf8");

      opts.scheduleBackground(() =>
        runSimulationJob(
          build,
          exportPath!,
          teaminfoPath!,
          body.teams,
          body.seed,
          body.runs,
          n_workers,
        ),
      );

      return reply.send({ build });
    } catch (err) {
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

  fastify.get("/api/sims/:build", { preHandler: validateBuildIdHandler }, async (request, reply) => {
    const { build } = request.params as { build: string };
    const run = storage.getRun(build);
    return reply.send(run);
  });
}
