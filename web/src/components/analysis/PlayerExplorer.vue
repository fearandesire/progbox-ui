<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ExplorerPayload, ExplorerPlayer, PlotlyFigureJson } from "../../lib/analysisTypes";
import PlotlyChart from "./PlotlyChart.vue";

// Native port of the generated dashboard's player-explorer widget
// (_EXPLORER_JS in vendor/progbox_cpp/tools/analysis.py): searchable player
// selector + two client-built figures. Chart math and thresholds mirror the
// original; light-only chrome is dropped in favor of PlotlyChart theming.

const props = defineProps<{
  payload: ExplorerPayload;
}>();

const search = ref(props.payload.players[0]?.label ?? "");

// The selection is sticky: it only moves when the query resolves to a real
// player. Mid-typing states keep the current charts on screen instead of
// tearing both Plotly plots down on every keystroke (the generated widget
// redrew on `change` for the same reason).
const selected = ref<ExplorerPlayer | null>(props.payload.players[0] ?? null);

watch(search, (q) => {
  const match = props.payload.players.find((p) => p.label === q);
  if (match) selected.value = match;
});

watch(
  () => props.payload,
  (next) => {
    selected.value = next.players[0] ?? null;
    search.value = next.players[0]?.label ?? "";
  },
);

const player = computed<ExplorerPlayer | null>(() => selected.value);

/** True while the typed query doesn't name a player (charts stay pinned). */
const noMatch = computed(
  () =>
    search.value.length > 0 &&
    !props.payload.players.some((p) => p.label === search.value),
);

const statsLine = computed(() => {
  const p = player.value;
  if (!p) return "";
  const sign = p.p50 >= 0 ? "+" : "";
  return `age ${p.age} · base ${p.base} · median Δ ${sign}${p.p50} · 90% [${p.p05}, ${p.p95}]`;
});

const distFigure = computed<PlotlyFigureJson | null>(() => {
  const p = player.value;
  if (!p) return null;
  const pUp = Math.round(p.pUp * 100);
  const pDn = Math.round(p.pDn * 100);
  const pct = p.dp.map((v) => v * 100);
  const colors = p.dx.map((x) =>
    x > 1e-9 ? "#16a34a" : x < -1e-9 ? "#dc2626" : "#94a3b8",
  );
  const width =
    p.mode === "pmf" ? 0.82 : p.dx.length > 1 ? (p.dx[1] - p.dx[0]) * 0.98 : 0.5;
  const ymax = Math.max(...pct, 0) || 1;
  const rulerY = 0.9;

  const shapes = [
    { type: "line", x0: 0, x1: 0, yref: "paper", y0: 0, y1: 1,
      line: { color: "#0f172a", width: 2 } },
    { type: "line", x0: p.mean, x1: p.mean, yref: "paper", y0: 0, y1: 0.8,
      line: { color: "#2563eb", width: 2, dash: "dash" } },
    { type: "line", x0: props.payload.leagueMean, x1: props.payload.leagueMean,
      yref: "paper", y0: 0, y1: 0.8,
      line: { color: "#94a3b8", width: 1.5, dash: "dot" } },
    { type: "line", x0: p.p05, x1: p.p95, yref: "paper", y0: rulerY, y1: rulerY,
      line: { color: "#64748b", width: 2 } },
    { type: "line", x0: p.p25, x1: p.p75, yref: "paper", y0: rulerY, y1: rulerY,
      line: { color: "#334155", width: 7 } },
    { type: "line", x0: p.p50, x1: p.p50, yref: "paper",
      y0: rulerY - 0.045, y1: rulerY + 0.045,
      line: { color: "#0f172a", width: 2 } },
  ];

  const sign = p.p50 >= 0 ? "+" : "";
  const bigTxt =
    p.pBig >= 0.001 ? `<br>P(jump ≥ +5): ${(p.pBig * 100).toFixed(1)}%` : "";

  return {
    data: [
      {
        type: "bar",
        x: p.dx,
        y: pct,
        width,
        marker: { color: colors, opacity: 0.9, line: { color: "#fff", width: 0.5 } },
        hovertemplate: "Δ %{x}<br>%{y:.1f}% of runs<extra></extra>",
      },
    ],
    layout: {
      title: { text: "OVR Δ outcome distribution (share of runs)", font: { size: 15 } },
      height: 360,
      margin: { l: 55, r: 20, t: 50, b: 45 },
      shapes,
      bargap: 0.06,
      xaxis: { title: { text: "OVR Δ" }, zeroline: false },
      yaxis: { title: { text: "% of runs" }, range: [0, ymax * 1.3] },
      annotations: [
        { x: p.mean, yref: "paper", y: 0.82, text: "mean", showarrow: false,
          font: { color: "#2563eb", size: 10 } },
        { x: p.p50, yref: "paper", y: rulerY + 0.07, text: "P25–75 · median",
          showarrow: false, font: { color: "#334155", size: 10 } },
        { xref: "paper", yref: "paper", x: 0.98, y: 0.98, xanchor: "right",
          align: "right", showarrow: false,
          bgcolor: "rgba(255,255,255,0.92)", bordercolor: "#e2e8f0", borderwidth: 1,
          font: { size: 11, color: "#0f172a", family: "monospace" },
          text:
            `improve ${pUp}%  ·  decline ${pDn}%` +
            `<br>median ${sign}${p.p50}  ·  90% [${p.p05}, ${p.p95}]` +
            bigTxt },
      ],
    },
  };
});

const attrsFigure = computed<PlotlyFigureJson | null>(() => {
  const p = player.value;
  if (!p) return null;
  const keys = Object.keys(p.attrs ?? {}).sort((a, b) => p.attrs[a] - p.attrs[b]);
  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        y: keys,
        x: keys.map((k) => p.attrs[k]),
        marker: {
          color: keys.map((k) => props.payload.groupColors[k] || "#475569"),
          opacity: 0.9,
        },
        hovertemplate: "%{y}<br>OVR-weighted Δ %{x:+.3f}<extra></extra>",
      },
    ],
    layout: {
      title: { text: "Attribute movement (coef × mean Δ)", font: { size: 15 } },
      height: 360,
      margin: { l: 55, r: 20, t: 50, b: 45 },
      xaxis: { title: { text: "OVR points contributed" } },
      yaxis: {},
    },
  };
});
</script>

<template>
  <div class="explorer">
    <div class="explorer__controls">
      <label
        class="explorer__label"
        for="explorer-select"
      >Player</label>
      <input
        id="explorer-select"
        v-model="search"
        list="explorer-options"
        class="explorer__input"
        placeholder="type to search…"
      >
      <datalist id="explorer-options">
        <option
          v-for="p in payload.players"
          :key="p.id"
          :value="p.label"
        />
      </datalist>
      <span
        class="explorer__stats"
        data-testid="explorer-stats"
      >{{ statsLine }}</span>
      <span
        v-if="noMatch"
        class="explorer__hint"
      >No player matches “{{ search }}”</span>
    </div>
    <div
      v-if="player"
      class="explorer__charts"
    >
      <PlotlyChart
        v-if="distFigure"
        :figure="distFigure"
        :min-height="360"
        eager
      />
      <PlotlyChart
        v-if="attrsFigure"
        :figure="attrsFigure"
        :min-height="360"
        eager
      />
    </div>
    <p
      v-else
      class="explorer__empty"
    >
      No player data available.
    </p>
  </div>
</template>

<style scoped>
.explorer__controls {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.explorer__label {
  font-weight: 600;
  font-size: 13px;
  color: var(--fg-soft);
}
.explorer__input {
  flex: 1;
  min-width: 240px;
  max-width: 420px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  background: var(--surface);
  color: var(--fg);
  font-size: 14px;
  font-family: inherit;
}
.explorer__input:focus-visible {
  outline: 2px solid var(--ring, var(--accent));
  outline-offset: 1px;
}
.explorer__stats {
  color: var(--fg-mute);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.explorer__charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 900px) {
  .explorer__charts {
    grid-template-columns: 1fr;
  }
}
.explorer__hint {
  color: var(--fg-mute);
  font-size: 12.5px;
  font-style: italic;
}
.explorer__empty {
  color: var(--fg-mute);
  font-size: 13px;
  margin: 0;
}
</style>
