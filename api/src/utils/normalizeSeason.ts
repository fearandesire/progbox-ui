const DEFAULT_SEASON = 2021;

export function normalizeSeason(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return DEFAULT_SEASON;
}
