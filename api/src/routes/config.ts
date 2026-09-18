import type { FastifyInstance } from "fastify";
import { engineBuildVersion } from "../services/engineAdapter.js";
import {
  PROGRESSION_VERSIONS,
  PUBLISHED_PROGRESSION_VERSION,
  versionMeta,
} from "../progressionVersions.js";

export async function registerConfigRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/config", async () => ({
    engine_build: engineBuildVersion(),
    versions: PROGRESSION_VERSIONS,
    published_version: PUBLISHED_PROGRESSION_VERSION,
    version_meta: versionMeta(),
  }));
}
