export function corsAllowOrigins(): string[] {
  const raw =
    process.env.CORS_ALLOW_ORIGINS ??
    "http://localhost:5173,http://127.0.0.1:5173";
  return raw
    .split(",")
    .map((x) => x.trim())
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
