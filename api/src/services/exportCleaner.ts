/**
 * Export cleaner — produces rows for `data/input.csv` (logic aligned with legacy Progbox v4.1 exportcleaner).
 */

const ATTRS = [
  "dIQ",
  "Dnk",
  "Drb",
  "End",
  "2Pt",
  "FT",
  "Ins",
  "Jmp",
  "oIQ",
  "Pss",
  "Reb",
  "Spd",
  "Str",
  "3Pt",
  "Hgt",
  "Ovr",
] as const;

const FAILSAFE: Record<string, string> = {
  end: "endu",
  "2pt": "fg",
  "3pt": "tp",
  str: "stre",
};

function normalizeSeason(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) return n;
  }
  return 2021;
}

export function extractMetadata(exportData: Record<string, unknown>): Record<string, unknown> {
  const meta = (exportData.meta as Record<string, unknown>) ?? {};
  const gameAttributes = (exportData.gameAttributes as Record<string, unknown>) ?? {};
  return {
    league_name: meta.name ?? "Unknown League",
    season: exportData.season ?? gameAttributes.season ?? "Unknown Season",
    phase: gameAttributes.phase ?? "Unknown",
  };
}

export type ExportCleanerRow = {
  Team: string;
  Name: string;
  Age: number;
  PER: number;
  DWS: number;
  EWA: number;
} & Record<(typeof ATTRS)[number], number>;

export function buildInputRows(
  exportData: Record<string, unknown>,
  teamLookup: Record<string, string>,
  teamsFilter: string[],
): ExportCleanerRow[] {
  const players = (exportData.players as unknown[]) ?? [];
  const metadata = extractMetadata(exportData);
  const season = normalizeSeason((exportData.gameAttributes as Record<string, unknown>)?.season ?? 2021);
  void metadata;

  const records: ExportCleanerRow[] = [];

  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    const pl = p as Record<string, unknown>;
    const statsArr = pl.stats as unknown[] | undefined;
    if (!statsArr || statsArr.length === 0) continue;
    const tid = pl.tid as number;
    if (typeof tid !== "number" || tid < -1) continue;

    const last = statsArr[statsArr.length - 1] as Record<string, unknown>;
    const prev = statsArr.length >= 2 ? (statsArr[statsArr.length - 2] as Record<string, unknown>) : last;
    const stats = (last.playoffs ? prev : last) as Record<string, unknown>;

    const per = (stats.per as number) ?? 0;
    if (per === 0) continue;

    const dws = (stats.dws as number) ?? 0;
    const ewa = (stats.ewa as number) ?? 0;

    const team = teamLookup[String(tid)];
    if (teamsFilter.length > 0 && !teamsFilter.includes(String(team))) {
      continue;
    }

    const born = pl.born as Record<string, unknown> | undefined;
    const bornYear = typeof born?.year === "number" ? born.year : 1990;
    const age = season - bornYear;
    if (age < 25) continue;

    const ratingsArr = pl.ratings as unknown[] | undefined;
    const ratingsLast =
      ratingsArr && ratingsArr.length > 0
        ? (ratingsArr[ratingsArr.length - 1] as Record<string, unknown>)
        : {};
    const ratings: Record<string, number> = {};
    for (const [k, v] of Object.entries(ratingsLast)) {
      ratings[String(k).toLowerCase()] = typeof v === "number" ? v : 0;
    }

    const row: Record<string, unknown> = {
      Team: team,
      Name: `${pl.firstName ?? ""} ${pl.lastName ?? ""}`.trim(),
      Age: age,
      PER: per,
      DWS: dws,
      EWA: ewa,
    };

    for (const a of ATTRS) {
      const key = FAILSAFE[a.toLowerCase()] ?? a.toLowerCase();
      row[a] = ratings[key] ?? 0;
    }

    records.push(row as ExportCleanerRow);
  }

  return records;
}

/** CSV header matching pandas export from exportcleaner + ATTRS */
export function inputCsvHeader(): string[] {
  return ["Team", "Name", "Age", "PER", "DWS", "EWA", ...ATTRS];
}

export function rowsToCsv(rows: ExportCleanerRow[]): string {
  const header = inputCsvHeader();
  const lines = [header.join(",")];
  for (const r of rows) {
    const vals = header.map((h) => {
      const v = (r as Record<string, unknown>)[h];
      if (typeof v === "string" && (v.includes(",") || v.includes('"'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return String(v ?? "");
    });
    lines.push(vals.join(","));
  }
  return lines.join("\n") + "\n";
}
