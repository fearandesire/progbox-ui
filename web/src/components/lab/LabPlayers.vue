<script setup lang="ts">
import { computed, ref } from "vue";
import { RATING_KEYS, int, sgn } from "../../lib/labFormat";
import type { LabDeepSide, LabPlayer, LabTrajectory } from "../../lib/labTypes";
import LabChart, { type LabSeries } from "./LabChart.vue";

const props = defineProps<{
  scriptId: string;
  baselineId: string | null;
  players: { script: LabPlayer[]; baseline: LabPlayer[] | null };
  deep: { script: LabDeepSide; baseline: LabDeepSide | null } | null;
}>();

type Row = LabPlayer & { baseDelta: number | null; diff: number | null };
type Key = "name" | "age" | "per" | "baseOvr" | "baseDelta" | "meanDelta" | "diff" | "sdDelta" | "godRate";

const query = ref("");
const sortKey = ref<Key>("meanDelta");
const sortDir = ref<1 | -1>(-1);
const selPid = ref<number | null>(null);

const basePlayers = computed(() => new Map((props.players.baseline ?? []).map((p) => [p.pid, p])));
const rows = computed<Row[]>(() =>
  props.players.script.map((p) => {
    const b = basePlayers.value.get(p.pid);
    return { ...p, baseDelta: b?.meanDelta ?? null, diff: b ? p.meanDelta - b.meanDelta : null };
  }),
);

const columns = computed(() => {
  const cols: { key: Key; label: string }[] = [
    { key: "name", label: "Player" },
    { key: "age", label: "Age" },
    { key: "per", label: "PER" },
    { key: "baseOvr", label: "Base OVR" },
  ];
  if (props.players.baseline) cols.push({ key: "baseDelta", label: `${props.baselineId} Δ` });
  cols.push({ key: "meanDelta", label: `${props.scriptId} Δ` });
  if (props.players.baseline) cols.push({ key: "diff", label: "Diff" });
  cols.push({ key: "sdDelta", label: "SD" }, { key: "godRate", label: "God %" });
  return cols;
});

function cell(r: Row, k: Key): string {
  const v = r[k];
  if (k === "name") return String(v);
  if (v === null || v === undefined) return "–";
  if (k === "per") return (v as number).toFixed(1);
  if (k === "baseDelta" || k === "meanDelta" || k === "diff") return sgn(v as number);
  if (k === "sdDelta") return (v as number).toFixed(2);
  if (k === "godRate") return `${((v as number) * 100).toFixed(0)}%`;
  return String(v);
}

const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = q ? rows.value.filter((r) => r.name.toLowerCase().includes(q)) : [...rows.value];
  const k = sortKey.value;
  return list.sort((a, b) => {
    const x = a[k];
    const y = b[k];
    if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y)) * sortDir.value;
    return ((x ?? -1e9) - (y ?? -1e9)) * sortDir.value;
  });
});

function sortBy(k: Key) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else {
    sortKey.value = k;
    sortDir.value = k === "name" ? 1 : -1;
  }
}

const selected = computed(() => rows.value.find((r) => r.pid === selPid.value) ?? null);
const selectedBase = computed(() => (selPid.value === null ? null : (basePlayers.value.get(selPid.value) ?? null)));

const ratingSeries = computed<LabSeries[]>(() => {
  const p = selected.value;
  if (!p) return [];
  const b = selectedBase.value;
  return [
    ...(b && props.baselineId ? [{ name: props.baselineId, role: "baseline" as const, data: RATING_KEYS.map((k) => b.attrDelta[k] ?? null) }] : []),
    { name: props.scriptId, role: "script" as const, data: RATING_KEYS.map((k) => p.attrDelta[k] ?? null) },
  ];
});

const seasonLabels = computed(() => ["Start", ...(props.deep?.script.seasons.map((s) => String(s.season)) ?? [])]);
function trajectoryOf(side: LabDeepSide | null | undefined, pid: number): LabTrajectory | undefined {
  return side?.trajectories.find((t) => t.pid === pid);
}
const trajectorySeries = computed<LabSeries[]>(() => {
  const p = selected.value;
  if (!p || !props.deep) return [];
  const line = (side: LabDeepSide | null, name: string, role: "baseline" | "script"): LabSeries | null => {
    const t = trajectoryOf(side, p.pid);
    if (!t) return null;
    const pts = t.ovr.map((o) => (o ? o.mean : null));
    return { name, role, data: [p.baseOvr, ...pts] };
  };
  return [
    ...(props.baselineId ? [line(props.deep.baseline, props.baselineId, "baseline")] : []),
    line(props.deep.script, props.scriptId, "script"),
  ].filter((s): s is LabSeries => s !== null);
});
const trajectoryRange = computed(() => {
  const p = selected.value;
  const t = p ? trajectoryOf(props.deep?.script, p.pid) : undefined;
  const last = t?.ovr.filter(Boolean).at(-1);
  return last ? `Final season p10 to p90 under ${props.scriptId}: ${int(last.p10)} to ${int(last.p90)}, active in ${(last.active * 100).toFixed(0)}% of replicates.` : "";
});
</script>

<template>
  <div class="lab-stack">
    <div class="table-toolbar">
      <label
        class="search-box"
        style="max-width: 320px"
      >
        <input
          v-model="query"
          type="search"
          placeholder="Search players"
          aria-label="Search players"
          data-test="player-search"
        >
      </label>
      <span
        class="hint"
        data-test="player-count"
      >{{ visible.length }} of {{ rows.length }} players</span>
    </div>
    <div class="lab-grid2">
      <section class="panel table-panel">
        <div class="lab-table-scroll">
          <table
            class="de-table lab-table"
            data-test="players-table"
          >
            <thead>
              <tr>
                <th
                  v-for="c in columns"
                  :key="c.key"
                  :aria-sort="sortKey === c.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'"
                  @click="sortBy(c.key)"
                >
                  {{ c.label }}<span
                    v-if="sortKey === c.key"
                    class="sort-ind"
                  >{{ sortDir === 1 ? "↑" : "↓" }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in visible"
                :key="r.pid"
                :class="{ sel: r.pid === selPid }"
                tabindex="0"
                @click="selPid = r.pid"
                @keydown.enter="selPid = r.pid"
              >
                <td
                  v-for="c in columns"
                  :key="c.key"
                  :class="c.key === 'name' ? 'cell-name' : 'cell-mono'"
                >
                  {{ cell(r, c.key) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section
        class="panel"
        data-test="player-detail"
      >
        <template v-if="selected">
          <h2 class="panel-title">
            {{ selected.name }}
          </h2>
          <p class="panel-sub">
            Age {{ selected.age }} · PER {{ selected.per === null ? "–" : selected.per.toFixed(1) }} · base OVR {{ selected.baseOvr }}
          </p>
          <p style="font-size: 13px; margin: 8px 0">
            {{ scriptId }}: mean {{ sgn(selected.meanDelta) }}, p10 {{ int(selected.q10) }}, median {{ int(selected.median) }}, p90 {{ int(selected.q90) }}
            <template v-if="selectedBase">
              <br>{{ baselineId }}: mean {{ sgn(selectedBase.meanDelta) }}, p10 {{ int(selectedBase.q10) }}, median {{ int(selectedBase.median) }}, p90 {{ int(selectedBase.q90) }}
            </template>
          </p>
          <LabChart
            kind="bar"
            :labels="[...RATING_KEYS]"
            :series="ratingSeries"
            y-title="Mean Δ rating"
            x-title="Rating"
            :digits="2"
            signed
            chart-label="Mean change per rating for this player"
          >
            Mean change per rating in one offseason.
          </LabChart>
          <template v-if="trajectorySeries.length">
            <h3
              class="panel-title"
              style="margin-top: 16px; font-size: 14px"
            >
              OVR trajectory
            </h3>
            <LabChart
              kind="line"
              :labels="seasonLabels"
              :series="trajectorySeries"
              y-title="OVR"
              x-title="Season"
              :digits="1"
              statgen
              chart-label="Player OVR after each offseason, mean over replicates"
            >
              {{ trajectoryRange }}
            </LabChart>
          </template>
        </template>
        <p
          v-else
          class="page-desc"
        >
          Click a player to see their mean change per rating under both scripts<template v-if="deep">
            and their OVR trajectory over the seasons
          </template>.
        </p>
      </section>
    </div>
  </div>
</template>
