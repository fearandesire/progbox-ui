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
  const teamsRaw = exportData.teams;
  if (!Array.isArray(teamsRaw)) {
    return { ...SPECIAL_ENTRIES };
  }
  const out: Record<string, string> = {};
  for (const t of teamsRaw) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const team = t as Record<string, unknown>;
    // Only include explicitly active teams
    if (team.active !== true) continue;
    const tid = team.tid;
    const abbrev = team.abbrev;
    // Validate tid is a finite number
    if (typeof tid !== "number" || !Number.isFinite(tid)) continue;
    // Validate abbrev is a non-empty string
    if (typeof abbrev !== "string" || abbrev.trim() === "") continue;
    out[String(tid)] = abbrev.trim().toUpperCase();
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
