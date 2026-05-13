import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { validateCorsConfig, corsAllowCredentials, corsAllowOrigins } from "./cors.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerSimsRoutes } from "./routes/sims.js";

export interface BuildAppOptions {
  /** Override background scheduling (tests capture the job instead of setImmediate). */
  scheduleBackground?: (task: () => void | Promise<void>) => void;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const origins = corsAllowOrigins();
  const allowCredentials = corsAllowCredentials();
  validateCorsConfig(origins, allowCredentials);

  const fastify = Fastify({ logger: false });

  await fastify.register(cors, {
    origin: origins,
    credentials: allowCredentials,
    methods: ["*"],
    allowedHeaders: ["*"],
  });

  await fastify.register(multipart, {
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  const schedule =
    opts.scheduleBackground ??
    ((task: () => void | Promise<void>) => {
      setImmediate(() => {
        void Promise.resolve(task()).catch((err) => console.error(err));
      });
    });

  await registerConfigRoutes(fastify);
  await registerSimsRoutes(fastify, { scheduleBackground: schedule });

  return fastify;
}
