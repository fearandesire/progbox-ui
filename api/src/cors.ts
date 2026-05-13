import { z } from "zod";

const corsOriginsSchema = z.string().default("http://localhost:5173,http://127.0.0.1:5173");

export function corsAllowOrigins(): string[] {
  const result = corsOriginsSchema.safeParse(process.env.CORS_ALLOW_ORIGINS);
  const raw = result.success ? result.data : "http://localhost:5173,http://127.0.0.1:5173";
  return raw
    .split(",")
    .map((x: string) => x.trim())
    .filter(Boolean);
}

export function corsAllowCredentials(): boolean {
  const v = process.env.CORS_ALLOW_CREDENTIALS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === undefined;
}

export function validateCorsConfig(origins: string[], allowCredentials: boolean): void {
  if (allowCredentials && origins.includes("*")) {
    throw new Error("Invalid CORS: allow_credentials=True cannot be used with origin '*'.");
  }
}
