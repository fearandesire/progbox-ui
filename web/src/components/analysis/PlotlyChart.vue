<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { loadPlotly, type PlotlyLike } from "../../composables/usePlotly";
import { buildLayoutOverrides } from "../../composables/usePlotlyTheme";
import { useTheme } from "../../composables/useTheme";
import type { PlotlyFigureJson } from "../../lib/analysisTypes";

const props = defineProps<{
  figure: PlotlyFigureJson;
  minHeight?: number;
  /** Render immediately instead of waiting for the viewport (explorer, tests). */
  eager?: boolean;
}>();

const host = ref<HTMLDivElement | null>(null);
const { theme } = useTheme();

const plotConfig = computed<Record<string, unknown>>(() => ({
  responsive: true,
  displayModeBar: false,
  ...(props.figure.config ?? {}),
}));

let plotly: PlotlyLike | null = null;
let rendered = false;
let observer: IntersectionObserver | null = null;

async function render() {
  const el = host.value;
  if (!el || rendered) return;
  rendered = true;
  plotly = await loadPlotly();
  if (!host.value) return; // unmounted while the bundle loaded
  await plotly.newPlot(
    el,
    props.figure.data,
    buildLayoutOverrides(theme.value, props.figure.layout ?? {}),
    plotConfig.value,
  );
}

onMounted(() => {
  if (props.eager || typeof IntersectionObserver === "undefined") {
    void render();
    return;
  }
  // Same pre-render margin the generated dashboard uses.
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer?.disconnect();
        observer = null;
        void render();
      }
    },
    { rootMargin: "800px 0px" },
  );
  observer.observe(host.value as Element);
});

watch([theme, () => props.figure], async () => {
  const el = host.value;
  if (!el || !rendered || !plotly) return;
  await plotly.react(
    el,
    props.figure.data,
    buildLayoutOverrides(theme.value, props.figure.layout ?? {}),
    plotConfig.value,
  );
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  if (rendered && plotly && host.value) {
    plotly.purge(host.value);
  }
});
</script>

<template>
  <div
    ref="host"
    class="plotly-chart"
    :style="{ minHeight: `${minHeight ?? 450}px` }"
  />
</template>

<style scoped>
.plotly-chart {
  width: 100%;
}
</style>
