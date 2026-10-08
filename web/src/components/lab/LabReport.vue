<script setup lang="ts">
import { computed, ref } from "vue";
import { AGE_BANDS } from "../../lib/labFormat";
import type { LabDeepSeason, LabDeepSide, LabPlayer, LabReport } from "../../lib/labTypes";
import LabChart, { type LabSeries } from "./LabChart.vue";

const props = defineProps<{
  report: LabReport;
  players: { script: LabPlayer[]; baseline: LabPlayer[] | null };
  deep: { script: LabDeepSide; baseline: LabDeepSide | null } | null;
}>();

const sub = ref<"offseason" | "seasons">(props.deep ? "seasons" : "offseason");

const scriptId = computed(() => props.report.script.id);
const baseId = computed(() => props.report.baseline?.id ?? null);

/* ---- This offseason ---- */
const EDGES = Array.from({ length: 17 }, (_, i) => i - 10); // -10 … +6, 1-OVR bins
const histLabels = EDGES.slice(0, -1).map((e) => (e > 0 ? `+${e}` : String(e)));
function hist(ps: LabPlayer[]): number[] {
  return EDGES.slice(0, -1).map((e, i) => {
    const hi = EDGES[i + 1]!;
    const first = i === 0;
    const last = i === EDGES.length - 2;
    return ps.filter((p) => (first || p.meanDelta >= e) && (last || p.meanDelta < hi)).length;
  });
}
const histSeries = computed<LabSeries[]>(() => [
  ...(props.players.baseline && baseId.value ? [{ name: baseId.value, role: "baseline" as const, data: hist(props.players.baseline) }] : []),
  { name: scriptId.value, role: "script", data: hist(props.players.script) },
]);

function scatterOf(ps: LabPlayer[], name: string, role: "baseline" | "script"): LabSeries {
  const pts = ps.filter((p) => p.per !== null);
  return {
    name,
    role,
    data: pts.map((p) => ({ x: p.per as number, y: p.meanDelta })),
    tips: pts.map((p) => `${p.name} (${p.age})`),
  };
}
const scatterSeries = computed<LabSeries[]>(() => [
  ...(props.players.baseline && baseId.value ? [scatterOf(props.players.baseline, baseId.value, "baseline")] : []),
  scatterOf(props.players.script, scriptId.value, "script"),
]);

/* ---- Over N seasons ---- */
const seasonLabels = computed(() => props.deep?.script.seasons.map((s) => s.season) ?? []);
const nSeasons = computed(() => seasonLabels.value.length);

function seasonSeries(pick: (s: LabDeepSeason) => { mean: number; se: number }): LabSeries[] {
  if (!props.deep) return [];
  const side = (d: LabDeepSide, name: string, role: "baseline" | "script"): LabSeries => ({
    name,
    role,
    data: d.seasons.map((s) => pick(s).mean),
    se: d.seasons.map((s) => pick(s).se),
  });
  return [
    ...(props.deep.baseline && baseId.value ? [side(props.deep.baseline, baseId.value, "baseline")] : []),
    side(props.deep.script, scriptId.value, "script"),
  ];
}
const meanOvr = computed(() => seasonSeries((s) => s.leagueMeanOvr));
const count75 = computed(() => seasonSeries((s) => s.count75));
const god = computed(() => seasonSeries((s) => s.god));
const meanDelta = computed(() => seasonSeries((s) => s.meanDelta));
const ageCurve = computed<LabSeries[]>(() => {
  if (!props.deep) return [];
  const bands = AGE_BANDS.filter((b) => b in props.deep!.script.ageCurve);
  return [
    ...(props.deep.baseline && baseId.value ? [{ name: baseId.value, role: "baseline" as const, data: bands.map((b) => props.deep!.baseline!.ageCurve[b] ?? null) }] : []),
    { name: scriptId.value, role: "script" as const, data: bands.map((b) => props.deep!.script.ageCurve[b] ?? null) },
  ];
});
const ageBands = computed(() => (props.deep ? AGE_BANDS.filter((b) => b in props.deep!.script.ageCurve) : []));
</script>

<template>
  <div>
    <div
      class="lab-subtabs"
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="sub === 'offseason'"
        @click="sub = 'offseason'"
      >
        This offseason
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="sub === 'seasons'"
        data-test="seasons-tab"
        @click="sub = 'seasons'"
      >
        Over {{ nSeasons || "N" }} seasons
      </button>
    </div>

    <div
      v-if="sub === 'offseason'"
      class="lab-stack"
    >
      <section class="panel">
        <h2 class="panel-title">
          Distribution of each player's mean ΔOVR
        </h2>
        <LabChart
          kind="bar"
          :labels="histLabels"
          :series="histSeries"
          y-title="Players"
          x-title="Mean ΔOVR bin"
          :digits="0"
          chart-label="Histogram of player mean OVR change"
        >
          Bins of 1 OVR labeled by lower edge; the end bins include everything beyond them.
        </LabChart>
      </section>
      <section class="panel">
        <h2 class="panel-title">
          Does production matter? PER vs mean ΔOVR
        </h2>
        <LabChart
          kind="scatter"
          :series="scatterSeries"
          y-title="Mean ΔOVR"
          x-title="PER"
          :digits="2"
          signed
          :height="300"
          chart-label="Prior-season PER against mean OVR change per player"
        >
          OLS, holding age and base OVR fixed:
          <template v-if="report.baseline">
            {{ report.baseline.id }} {{ report.baseline.kpis.perEffect?.toFixed(2) ?? "–" }} vs
          </template>
          {{ report.script.id }} {{ report.script.kpis.perEffect?.toFixed(2) ?? "–" }} OVR per SD of PER.
        </LabChart>
      </section>
    </div>

    <div
      v-else
      class="lab-stack"
    >
      <section
        v-if="!deep"
        class="panel"
      >
        <p
          class="page-desc"
          data-test="no-deep"
        >
          This was a quick run (one offseason). Run in Deep mode to see how the league evolves over several seasons.
        </p>
      </section>
      <template v-else>
        <div class="lab-grid2">
          <section class="panel">
            <h2 class="panel-title">
              League mean OVR by season
            </h2>
            <LabChart
              kind="line"
              :labels="seasonLabels"
              :series="meanOvr"
              y-title="Mean OVR"
              x-title="Season"
              :digits="2"
              statgen
              chart-label="League mean OVR after each offseason"
            />
          </section>
          <section class="panel">
            <h2 class="panel-title">
              Players at 75+ OVR by season
            </h2>
            <LabChart
              kind="line"
              :labels="seasonLabels"
              :series="count75"
              y-title="Players 75+"
              x-title="Season"
              :digits="1"
              statgen
              chart-label="Count of players at 75 OVR or higher by season"
            />
          </section>
        </div>
        <div class="lab-grid2">
          <section class="panel">
            <h2 class="panel-title">
              God progs per season
            </h2>
            <LabChart
              kind="bar"
              :labels="seasonLabels"
              :series="god"
              y-title="God progs"
              x-title="Season"
              :digits="2"
              statgen
              chart-label="God progs per season"
            />
          </section>
          <section class="panel">
            <h2 class="panel-title">
              Age curve: mean ΔOVR by age band
            </h2>
            <LabChart
              kind="line"
              :labels="ageBands"
              :series="ageCurve"
              y-title="Mean ΔOVR"
              x-title="Age"
              :digits="2"
              signed
              statgen
              chart-label="Mean OVR change by age band over all seasons"
            >
              Averaged over all {{ nSeasons }} seasons and {{ deep.script.replicates }} replicates.
            </LabChart>
          </section>
        </div>
        <section class="panel">
          <h2 class="panel-title">
            Mean ΔOVR per season
          </h2>
          <LabChart
            kind="line"
            :labels="seasonLabels"
            :series="meanDelta"
            y-title="Mean ΔOVR"
            x-title="Season"
            :digits="2"
            signed
            statgen
            chart-label="Mean OVR change per season"
          />
        </section>
      </template>
    </div>
  </div>
</template>
