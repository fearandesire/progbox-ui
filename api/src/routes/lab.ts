import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { LabCliError, runLabCommand, runLabJson } from "../services/labCli.js";
import {
  LAB_FILES,
  LAB_MODES,
  LabRunQueue,
  QUEUE_ID_RE,
  RUN_ID_RE,
  labFilePath,
  listStatuses,
  readStatus,
  runResults,
  type LabFile,
  type LiveRun,
} from "../services/labRuns.js";

/** Registry ids (net@4.4.0-draft.1), builtin aliases (net-4.3.0) and league ids. Never paths or flags. */
const REF = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9@._+-]{0,119}$/, "must be an id, not a path");
const FAMILY = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, "letters, digits, spaces, - or _ (max 40)")
  .default("net");

const Unlock = z
  .object({
    runs: z.number().int().min(1).max(100_000).optional(),
    seasons: z.number().int().min(1).max(50).optional(),
    replicates: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

const RunBody = z
  .object({
    mode: z.enum(LAB_MODES).default("deep"),
    script: REF,
    baseline: REF.nullable().optional(),
    league: REF.optional(),
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    unlock: Unlock.optional(),
  })
  .strict();

const ScriptJsonBody = z.object({
  source: z.string().min(1).max(2_000_000),
  filename: z.string().max(200).optional(),
  family: FAMILY,
});

const EstimateQuery = z.object({
  script: REF,
  baseline: REF.optional(),
  mode: z.enum(LAB_MODES).default("deep"),
  league: REF.optional(),
  unlock: z.enum(["1", "true"]).optional(),
  runs: z.coerce.number().int().min(1).max(100_000).optional(),
  seasons: z.coerce.number().int().min(1).max(50).optional(),
  replicates: z.coerce.number().int().min(1).max(10_000).optional(),
});

const ESTIMATE_TIMEOUT_MS = 10 * 60_000;
const START_TIMEOUT_MS = 10 * 60_000;

function detail(reply: FastifyReply, status: number, message: string) {
  return reply.status(status).send({ detail: message });
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

/** The CLI exits 3 for a locked script (409) and 4 for a missing one (404); anything else is a 422. */
function cliFailure(reply: FastifyReply, err: unknown) {
  if (err instanceof LabCliError) return detail(reply, err.code === 3 ? 409 : err.code === 4 ? 404 : 422, err.message);
  throw err;
}

const DiffQuery = z.object({ against: REF.default("original") });
const DeleteQuery = z.object({ runs: z.enum(["0", "1", "true", "false"]).optional() });
const SourceQuery = z.object({ original: z.enum(["0", "1", "true", "false"]).optional() });
const yes = (v: string | undefined) => v === "1" || v === "true";

function scriptId(request: FastifyRequest): string | null {
  const id = REF.safeParse((request.params as { id: string }).id);
  return id.success ? id.data : null;
}

/** Keep the uploaded name readable but safe; the registry records it as `file:<name>`. */
function safeFilename(name: string | undefined, fallback: string): string {
  const base = path.basename(name ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
  return base || fallback;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "progbox-lab-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function liveView(run: LiveRun, queue: LabRunQueue) {
  return {
    queueId: run.queueId,
    runId: run.runId,
    state: run.state,
    position: run.state === "queued" ? queue.position(run) : 0,
    mode: run.spec.mode,
    script: run.spec.script,
    baseline: run.spec.baseline ?? null,
    league: run.spec.league ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt ?? null,
    estimateSeconds: run.estimateSeconds ?? null,
    estimateBasis: run.estimateBasis ?? [],
    stage: run.stage ?? null,
    stages: run.stages,
    issues: run.issues,
    elapsed: run.elapsed,
    verdict: run.verdict ?? null,
    error: run.error ?? null,
  };
}

export async function registerLabRoutes(fastify: FastifyInstance): Promise<void> {
  const queue = new LabRunQueue();

  fastify.get("/api/lab/scripts", async (_req, reply) => {
    try {
      return reply.send(await runLabJson(["scripts", "list", "--json"]));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.post("/api/lab/scripts", { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    let source: string | null = null;
    let filename: string | undefined;
    let familyRaw: unknown;
    if (request.isMultipart()) {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer();
          source = buf.toString("utf8");
          filename = part.filename;
        } else if (part.fieldname === "family") {
          familyRaw = part.value;
        } else if (part.fieldname === "filename") {
          filename = String(part.value);
        }
      }
    } else {
      const parsed = ScriptJsonBody.safeParse(request.body ?? {});
      if (!parsed.success) return detail(reply, 422, zodMessage(parsed.error));
      source = parsed.data.source;
      filename = parsed.data.filename;
      familyRaw = parsed.data.family;
    }
    if (!source || !source.trim()) return detail(reply, 422, "The script file is empty.");
    if (source.length > 2_000_000) return detail(reply, 413, "Script is larger than 2 MB.");
    const family = FAMILY.safeParse(familyRaw === "" ? undefined : familyRaw);
    if (!family.success) return detail(reply, 422, `family: ${family.error.issues[0]?.message}`);

    try {
      const added = await withTempDir(async (dir) => {
        const file = path.join(dir, safeFilename(filename, "script.js"));
        await fsp.writeFile(file, source!, "utf8");
        return runLabJson(["scripts", "add", file, "--family", family.data, "--json"]);
      });
      return reply.send(added);
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.delete("/api/lab/scripts/:id", async (request, reply) => {
    const id = scriptId(request);
    if (!id) return detail(reply, 422, "Invalid script id");
    const q = DeleteQuery.safeParse(request.query ?? {});
    if (!q.success) return detail(reply, 422, zodMessage(q.error));
    try {
      return reply.send(await runLabJson(["scripts", "delete", id, ...(yes(q.data.runs) ? ["--runs"] : []), "--json"]));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.post("/api/lab/scripts/:id/restore", async (request, reply) => {
    const id = scriptId(request);
    if (!id) return detail(reply, 422, "Invalid script id");
    try {
      return reply.send(await runLabJson(["scripts", "restore", id, "--json"]));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.get("/api/lab/scripts/:id/source", async (request, reply) => {
    const id = scriptId(request);
    if (!id) return detail(reply, 422, "Invalid script id");
    const q = SourceQuery.safeParse(request.query ?? {});
    if (!q.success) return detail(reply, 422, zodMessage(q.error));
    const original = yes(q.data.original);
    try {
      const text = await runLabCommand(["scripts", "export", id, ...(original ? ["--original"] : [])]);
      return reply
        .header("Content-Type", "text/javascript; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${id}${original ? ".original" : ""}.js"`)
        .send(text);
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.get("/api/lab/scripts/:id/diff", async (request, reply) => {
    const id = scriptId(request);
    if (!id) return detail(reply, 422, "Invalid script id");
    const q = DiffQuery.safeParse(request.query ?? {});
    if (!q.success) return detail(reply, 422, zodMessage(q.error));
    try {
      return reply.send(await runLabJson(["scripts", "diff", id, "--against", q.data.against, "--json"]));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.get("/api/lab/leagues", async (_req, reply) => {
    try {
      return reply.send(await runLabJson(["leagues", "list"]));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.post("/api/lab/leagues", async (request, reply) => {
    if (!request.isMultipart()) return detail(reply, 415, "Upload the league export as multipart field 'file'.");
    try {
      const result = await withTempDir(async (dir) => {
        let file: string | null = null;
        let name: string | undefined;
        for await (const part of request.parts()) {
          if (part.type === "file") {
            file = path.join(dir, safeFilename(part.filename, "export.json"));
            name ??= part.filename;
            await pipeline(part.file, fs.createWriteStream(file));
          } else if (part.fieldname === "name" && String(part.value).trim()) {
            name = String(part.value).trim().slice(0, 120);
          }
        }
        if (!file || (await fsp.stat(file)).size === 0) return null;
        return runLabJson(["leagues", "add", file, "--name", name || "uploaded export"], ESTIMATE_TIMEOUT_MS);
      });
      if (!result) return detail(reply, 422, "The export file is empty.");
      return reply.send(result);
    } catch (err) {
      if (err instanceof LabCliError && /JSON/.test(err.message)) return detail(reply, 422, `That file isn't a BBGM export: ${err.message}`);
      return cliFailure(reply, err);
    }
  });

  fastify.post("/api/lab/leagues/fetch", async (_req, reply) => {
    try {
      await runLabCommand(["leagues", "fetch"], ESTIMATE_TIMEOUT_MS);
      return reply.send(await runLabJson(["leagues", "list"]));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.get("/api/lab/leagues/:id/check", async (request, reply) => {
    const id = REF.safeParse((request.params as { id: string }).id);
    if (!id.success) return detail(reply, 422, "Invalid league id");
    try {
      return reply.send(await runLabJson(["leagues", "check", id.data, "--json"], ESTIMATE_TIMEOUT_MS));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.get("/api/lab/estimate", async (request, reply) => {
    const q = EstimateQuery.safeParse(request.query ?? {});
    if (!q.success) return detail(reply, 422, zodMessage(q.error));
    const { script, baseline, mode, league, unlock, runs, seasons, replicates } = q.data;
    if (!unlock && (runs || seasons || replicates)) return detail(reply, 422, "Run sizes are locked. Pass unlock=1 to override them.");
    const args = ["estimate", "--script", script, "--mode", mode];
    if (baseline) args.push("--baseline", baseline);
    if (league) args.push("--league", league);
    if (unlock) {
      args.push("--unlock");
      if (runs) args.push("--runs", String(runs));
      if (seasons) args.push("--seasons", String(seasons));
      if (replicates) args.push("--replicates", String(replicates));
    }
    try {
      return reply.send(await runLabJson(args, ESTIMATE_TIMEOUT_MS));
    } catch (err) {
      return cliFailure(reply, err);
    }
  });

  fastify.post("/api/lab/runs", async (request, reply) => {
    const body = RunBody.safeParse(request.body ?? {});
    if (!body.success) return detail(reply, 422, zodMessage(body.error));
    const run = queue.enqueue(body.data);
    if (run.state === "queued") {
      return reply.status(202).send({ runId: null, queueId: run.queueId, state: "queued", position: queue.position(run) });
    }
    const started = await Promise.race([
      queue.started(run),
      new Promise<null>((r) => setTimeout(() => r(null), START_TIMEOUT_MS).unref()),
    ]);
    if (!started || (!started.runId && started.state !== "failed")) {
      return reply.status(202).send({ runId: null, queueId: run.queueId, state: run.state, position: 0 });
    }
    if (!started.runId) return detail(reply, 422, started.error ?? "NET Lab could not start the run.");
    return reply.status(201).send({
      runId: started.runId,
      queueId: run.queueId,
      state: started.state,
      estimateSeconds: started.estimateSeconds ?? null,
      estimateBasis: started.estimateBasis ?? [],
    });
  });

  fastify.get("/api/lab/runs", async (_req, reply) => {
    const queued = queue.queued().map((r) => liveView(r, queue));
    return reply.send([...queued, ...listStatuses()]);
  });

  fastify.get("/api/lab/runs/:id", async (request: FastifyRequest, reply) => {
    const { id } = request.params as { id: string };
    if (QUEUE_ID_RE.test(id)) {
      const live = queue.get(id);
      if (!live) return detail(reply, 404, "Queued run not found (the API may have restarted).");
      return reply.send({ ...liveView(live, queue), results: null });
    }
    if (!RUN_ID_RE.test(id)) return detail(reply, 422, "Invalid run id");
    const status = readStatus(id);
    const live = queue.get(id);
    if (!status && !live) return detail(reply, 404, "Run not found");
    const state = live && live.state !== "done" ? live.state : String(status?.state ?? live?.state ?? "running");
    const base = {
      // status.json carries the resolved ids (net@4.3.0); the live record adds stages and issues.
      ...(live ? liveView(live, queue) : {}),
      ...(status ?? {}),
      runId: id,
      state,
      error: live?.error ?? (status?.error as string | undefined) ?? null,
    };
    return reply.send({ ...base, results: state === "done" ? runResults(id) : null });
  });

  fastify.get("/api/lab/runs/:id/files/:name", async (request, reply) => {
    const { id, name } = request.params as { id: string; name: string };
    if (!RUN_ID_RE.test(id)) return detail(reply, 422, "Invalid run id");
    if (!(LAB_FILES as readonly string[]).includes(name)) return detail(reply, 404, "Unknown file");
    const file = labFilePath(id, name as LabFile);
    if (!fs.existsSync(file)) return detail(reply, 404, "File not found");
    const type = name.endsWith(".json")
      ? "application/json; charset=utf-8"
      : name.endsWith(".csv")
        ? "text/csv; charset=utf-8"
        : "text/markdown; charset=utf-8";
    return reply
      .header("Content-Type", type)
      .header("Content-Disposition", `attachment; filename="${id}-${name}"`)
      .send(fs.createReadStream(file));
  });
}
