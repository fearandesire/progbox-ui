import type { FastifyInstance } from "fastify";
import { engineBuildVersion } from "../services/engineAdapter.js";
import { PROGRESSION_VERSIONS } from "./sims.js";

export async function registerConfigRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/config", async () => ({
    engine_build: engineBuildVersion(),
    versions: PROGRESSION_VERSIONS,
  }));
}
