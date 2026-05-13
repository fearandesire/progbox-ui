import type { FastifyInstance } from "fastify";
import { configSnapshot, scriptVersion } from "../services/engineAdapter.js";

export async function registerConfigRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/config", async () => ({
    script_version: scriptVersion(),
    config: configSnapshot(),
  }));
}
