import { ref, watch, type Ref } from "vue";
import { fetchGodprogs, fetchPlayers } from "../lib/api";

/** Aggregates the Deep Engine dashboard card needs but RunMetadata
 *  doesn't carry. Derived from the run's real /players + /godprogs. */
export interface RunStats {
  godProgs: number;
  /** Players whose mean rating change collapsed (fell off a cliff). */
  severeRegressions: number;
  /** Mean rating change across the analyzed cohort. */
  meanDelta: number;
  /** Standard deviation of the P50 distribution across players. */
  sigma: number;
  /** Highest single P95 projection produced for any player. */
  p95Ceiling: number;
  /** Players actually simulated. */
  playersAnalyzed: number;
}

const SEVERE_REGRESSION_THRESHOLD = -2.0;

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Reactively derive the rich stats for a build. `build` may be null
 *  (nothing to fetch) — stats stay null and `loading` stays false. */
export function useRunStats(build: Ref<string | null>) {
  const stats = ref<RunStats | null>(null);
  const loading = ref(false);
  const failed = ref(false);
  let requestSeq = 0;

  async function load(b: string) {
    const seq = ++requestSeq;
    loading.value = true;
    failed.value = false;
    stats.value = null;
    try {
      const [players, godprogs] = await Promise.all([
        fetchPlayers(b),
        fetchGodprogs(b),
      ]);
      const deltas = players.map((p) => p.MeanDelta);
      const p50s = players.map((p) => p.P50);
      if (seq !== requestSeq) return;
      stats.value = {
        godProgs: godprogs.length,
        severeRegressions: players.filter(
          (p) => p.MeanDelta <= SEVERE_REGRESSION_THRESHOLD,
        ).length,
        meanDelta: deltas.length
          ? deltas.reduce((a, b) => a + b, 0) / deltas.length
          : 0,
        sigma: stddev(p50s),
        p95Ceiling: players.length
          ? players.reduce((m, p) => Math.max(m, p.P95), -Infinity)
          : 0,
        playersAnalyzed: players.length,
      };
    } catch {
      if (seq !== requestSeq) return;
      // Graceful fallback: the card renders the metadata-only subset.
      failed.value = true;
      stats.value = null;
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  watch(
    build,
    (b) => {
      if (b) void load(b);
      else {
        requestSeq++;
        stats.value = null;
        loading.value = false;
        failed.value = false;
      }
    },
    { immediate: true },
  );

  return { stats, loading, failed };
}
