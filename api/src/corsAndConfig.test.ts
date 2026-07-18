import { describe, expect, it } from "vitest";
import { validateCorsConfig } from "./cors.js";
import { buildApp } from "./app.js";

describe("cors", () => {
  it("rejects wildcard with credentials", () => {
    expect(() => validateCorsConfig(["*"], true)).toThrow(/Invalid CORS/);
  });

  it("allows explicit origins", () => {
    expect(() => validateCorsConfig(["http://localhost:5173"], true)).not.toThrow();
  });
});

describe("config route", () => {
  it("returns the engine build and available progression versions", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/config" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(typeof body.engine_build).toBe("string");
      expect(body.versions).toEqual(["v41", "v43"]);
    } finally {
      await app.close();
    }
  });
});
