import { createHash } from "node:crypto";
import fs from "node:fs";
import { bbgmHelpers, RATING_KEYS, type Ratings } from "./bbgmHelpers.ts";
import { PHASE, type Player } from "./shim.ts";

/**
 * One NET boundary built from a league export (see docs/net-parity-contract.md).
 * Preseason export: BBGM progs already ran; the export is used as-is.
 * Any other phase: the next preseason is emulated by copying each active or
 * free-agent player's last ratings row into the entering season. BBGM's own
 * develop() is not applied (quick mode measures what the script changes).
 */
export type Boundary = {
  exportSha256: string;
  sourceSeason: number;
  sourcePhase: number;
  statsSeason: number;
  enteringSeason: number;
  baseDevelop: "export" | "copy-last-row";
  gameAttributes: Record<string, unknown>;
  /** Players before the pre-progs hook. */
  players: Player[];
};

export type ExportFile = { data: Record<string, any>; sha256: string };

export function readExport(file: string): ExportFile {
  const buf = fs.readFileSync(file);
  return { data: JSON.parse(buf.toString("utf8")), sha256: createHash("sha256").update(buf).digest("hex") };
}

function attr(value: unknown): unknown {
  if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === "object" && "value" in v)) {
    return (value.at(-1) as { value: unknown }).value;
  }
  return value;
}

export function gameAttributesOf(data: Record<string, any>): Record<string, unknown> {
  const raw = data.gameAttributes;
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((a: { key: string; value: unknown }) => [a.key, a.value]));
  return { ...(raw ?? {}) };
}

export function boundaryFrom(file: ExportFile): Boundary {
  const gameAttributes = gameAttributesOf(file.data);
  const season = Number(attr(gameAttributes.season));
  const phase = Number(attr(gameAttributes.phase));
  if (!Number.isInteger(season)) throw new Error("export has no integer gameAttributes.season");
  const preseason = phase === PHASE.PRESEASON;
  const enteringSeason = preseason ? season : season + 1;
  const players = (Array.isArray(file.data.players) ? file.data.players : []).filter(
    (p: unknown): p is Player => !!p && typeof p === "object" && Array.isArray((p as Player).ratings),
  );
  return {
    exportSha256: file.sha256,
    sourceSeason: season,
    sourcePhase: phase,
    statsSeason: enteringSeason - 1,
    enteringSeason,
    baseDevelop: preseason ? "export" : "copy-last-row",
    gameAttributes,
    players,
  };
}

/** Advance a (cloned) roster into the entering preseason, mirroring BBGM's addRatingsRow. */
export function enterPreseason(b: Boundary, players: Player[]): void {
  if (b.baseDevelop === "export") return;
  for (const p of players) {
    if (!Number.isInteger(p.tid) || p.tid < -1 || !p.ratings.length) continue;
    const last = p.ratings.at(-1)!;
    if (last.season >= b.enteringSeason) continue;
    p.ratings.push({ ...structuredClone(last), season: b.enteringSeason });
  }
}

/** The ratings row a NET script rebuilds from: the last row before the entering season. */
export function baseRow(p: Player, enteringSeason: number): Ratings | undefined {
  for (let i = p.ratings.length - 1; i >= 0; i--) {
    const r = p.ratings[i]!;
    if (r.season < enteringSeason) return r as Ratings;
  }
  return undefined;
}

export function ratingsOf(row: Record<string, any>): Ratings {
  return Object.fromEntries(RATING_KEYS.map((k) => [k, Number(row[k])]));
}

export function ovrOf(row: Record<string, any>): number {
  return bbgmHelpers().ovr(ratingsOf(row));
}

/** Last regular-season stats row for a season (what NET 4.3 reads); used for report context only. */
export function statsRow(p: Player, season: number): Record<string, number> | undefined {
  const rows = Array.isArray(p.stats) ? p.stats : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const s = rows[i];
    if (s && s.season === season && !s.playoffs) return s;
  }
  return undefined;
}
