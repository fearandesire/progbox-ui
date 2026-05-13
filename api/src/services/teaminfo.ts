import type { TeaminfoSource } from "../types.js";

export const SPECIAL_ENTRIES: Record<string, string> = {
  "-1": "FA",
  "-2": "UDFA",
  "-3": "Retired",
};

export class InvalidTeaminfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTeaminfoError";
  }
}

export function generateTeaminfo(exportData: Record<string, unknown>): Record<string, string> {
  const teams = (exportData.teams as unknown[]) ?? [];
  const out: Record<string, string> = {};
  for (const t of teams) {
    if (!t || typeof t !== "object") continue;
    const team = t as Record<string, unknown>;
    if (team.active === false) continue;
    const tid = team.tid;
    const abbrev = team.abbrev;
    if (tid === undefined || tid === null || !abbrev) continue;
    out[String(tid)] = String(abbrev).toUpperCase();
  }
  return { ...out, ...SPECIAL_ENTRIES };
}

export function validateTeaminfo(data: unknown): Record<string, string> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidTeaminfoError(
      "teaminfo.json must be a JSON object mapping team IDs to abbreviations",
    );
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof k !== "string" || !k) {
      throw new InvalidTeaminfoError(`teaminfo key must be a non-empty string, got ${JSON.stringify(k)}`);
    }
    if (typeof v !== "string" || !v) {
      throw new InvalidTeaminfoError(`teaminfo value for key ${JSON.stringify(k)} must be a non-empty string`);
    }
    out[k] = v;
  }
  return out;
}

export function teaminfoSourceFromUpload(hasUserUpload: boolean): TeaminfoSource {
  return hasUserUpload ? "user" : "generated";
}
