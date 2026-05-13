import { z } from "zod";
import { buildApp } from "./app.js";

const envSchema = z.object({
  PORT: z.string().optional().transform((val: string | undefined) => {
    const num = Number(val ?? 8000);
    if (!Number.isInteger(num) || num < 1 || num > 65535) {
      throw new Error(`PORT must be a valid TCP port (1-65535), got: ${val}`);
    }
    return num;
  }),
  HOST: z.string().min(1).default("127.0.0.1"),
});

let env;
try {
  env = envSchema.parse({
    PORT: process.env.PORT,
    HOST: process.env.HOST,
  });
} catch (error) {
  console.error("Environment validation failed:", error);
  process.exit(1);
}

const port = env.PORT;
const host = env.HOST;

const app = await buildApp();
await app.listen({ port, host });
// eslint-disable-next-line no-console
console.log(`API listening on http://${host}:${port}`);
