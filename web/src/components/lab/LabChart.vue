<script setup lang="ts">
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { computed } from "vue";
import { Bar, Line, Scatter } from "vue-chartjs";
import { useTheme } from "../../composables/useTheme";
import { BASELINE_COLOR, SCRIPT_COLOR, STATGEN_NOTE } from "../../lib/labFormat";

ChartJS.register(BarController, LineController, ScatterController, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

export type LabSeries = {
  name: string;
  role: "baseline" | "script";
  /** Bar/line values, one per label; scatter takes {x, y} points. */
  data: (number | null)[] | { x: number; y: number }[];
  /** Standard errors shown in the tooltip (bar/line). */
  se?: (number | null)[];
  /** Per-point tooltip titles (scatter). */
  tips?: string[];
};

const props = withDefaults(
  defineProps<{
    kind: "bar" | "line" | "scatter";
    labels?: (string | number)[];
    series: LabSeries[];
    yTitle: string;
    xTitle?: string;
    digits?: number;
    signed?: boolean;
    /** Multi-season chart: label that seasons after the first use StatGen stats. */
    statgen?: boolean;
    height?: number;
    chartLabel: string;
  }>(),
  { labels: () => [], xTitle: "", digits: 1, signed: false, statgen: false, height: 240 },
);

const { theme } = useTheme();

const colorOf = (s: LabSeries) => (s.role === "baseline" ? BASELINE_COLOR : SCRIPT_COLOR);

function fmt(v: number): string {
  const t = v.toFixed(props.digits);
  return props.signed && v > 0 ? `+${t}` : t;
}

const data = computed(() => ({
  labels: props.kind === "scatter" ? undefined : props.labels.map(String),
  datasets: props.series.map((s) => ({
    label: s.name,
    data: s.data,
    backgroundColor: props.kind === "scatter" ? `${colorOf(s)}99` : colorOf(s),
    borderColor: colorOf(s),
    borderWidth: props.kind === "bar" ? 0 : 2,
    borderRadius: props.kind === "bar" ? 3 : 0,
    pointRadius: props.kind === "line" ? 3 : 3.5,
    pointHoverRadius: 6,
    tension: 0,
    spanGaps: false,
  })),
}));

const options = computed(() => {
  const dark = theme.value === "dark";
  const text = dark ? "#a3a3a3" : "#525252";
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const axisTitle = (t: string) => ({ display: !!t, text: t, color: text, font: { size: 11 } });
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: props.kind === "scatter" ? { mode: "nearest", intersect: true } : { mode: "index", intersect: false },
    plugins: {
      legend: { display: true, position: "top", align: "start", labels: { color: text, boxWidth: 12, boxHeight: 12, font: { size: 12 } } },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<"bar">[]) => {
            const it = items[0];
            if (!it) return "";
            if (props.kind === "scatter") return props.series[it.datasetIndex]?.tips?.[it.dataIndex] ?? "";
            return `${props.xTitle ? `${props.xTitle} ` : ""}${it.label}`;
          },
          label: (it: TooltipItem<"bar">) => {
            const s = props.series[it.datasetIndex];
            if (props.kind === "scatter") {
              const p = it.raw as { x: number; y: number };
              return `${s?.name}: ${props.xTitle} ${p.x.toFixed(1)}, ${props.yTitle} ${fmt(p.y)}`;
            }
            const v = it.parsed.y;
            if (v === null || v === undefined) return `${s?.name}: –`;
            const se = s?.se?.[it.dataIndex];
            return `${s?.name}: ${fmt(v)}${se ? ` ± ${se.toFixed(props.digits + 1)} SE` : ""}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: props.kind === "scatter" ? "linear" : "category",
        title: axisTitle(props.xTitle),
        ticks: { color: text },
        grid: { display: props.kind === "scatter", color: grid },
      },
      y: {
        type: "linear",
        position: "left",
        title: axisTitle(props.yTitle),
        ticks: { color: text, callback: (v: number | string) => fmt(Number(v)) },
        grid: { color: grid },
      },
    },
  };
});

// vue-chartjs types are strict per chart kind; one options object serves all three here.
const barData = computed(() => data.value as unknown as ChartData<"bar">);
const lineData = computed(() => data.value as unknown as ChartData<"line">);
const scatterData = computed(() => data.value as unknown as ChartData<"scatter">);
const barOpts = computed(() => options.value as unknown as ChartOptions<"bar">);
const lineOpts = computed(() => options.value as unknown as ChartOptions<"line">);
const scatterOpts = computed(() => options.value as unknown as ChartOptions<"scatter">);
</script>

<template>
  <figure class="lab-chart">
    <div
      class="lab-chart__canvas"
      :style="{ height: `${height}px` }"
      role="img"
      :aria-label="chartLabel"
    >
      <Bar
        v-if="kind === 'bar'"
        :data="barData"
        :options="barOpts"
      />
      <Line
        v-else-if="kind === 'line'"
        :data="lineData"
        :options="lineOpts"
      />
      <Scatter
        v-else
        :data="scatterData"
        :options="scatterOpts"
      />
    </div>
    <figcaption
      v-if="statgen"
      class="lab-statgen"
    >
      {{ STATGEN_NOTE }}
    </figcaption>
    <figcaption
      v-if="$slots.default"
      class="lab-caption"
    >
      <slot />
    </figcaption>
  </figure>
</template>
