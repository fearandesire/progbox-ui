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

const renderError = ref(false);

let plotly: PlotlyLike | null = null;
let rendered = false;
let rendering = false;
let observer: IntersectionObserver | null = null;

async function render() {
  const el = host.value;
  if (!el || rendered || rendering) return;
  rendering = true;
  try {
    plotly = await loadPlotly();
    if (!host.value) return; // unmounted while the bundle loaded
    await plotly.newPlot(
      el,
      props.figure.data,
      buildLayoutOverrides(theme.value, props.figure.layout ?? {}),
      plotConfig.value,
    );
    // Only latch `rendered` on success, so a failure stays retryable.
    rendered = true;
    renderError.value = false;
  } catch {
    renderError.value = true;
  } finally {
    rendering = false;
  }
}

function retry() {
  renderError.value = false;
  void render();
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
  try {
    await plotly.react(
      el,
      props.figure.data,
      buildLayoutOverrides(theme.value, props.figure.layout ?? {}),
      plotConfig.value,
    );
  } catch {
    renderError.value = true;
  }
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
  <div class="plotly-chart-wrap">
    <div
      ref="host"
      class="plotly-chart"
      :style="{ minHeight: `${minHeight ?? 450}px` }"
    />
    <p
      v-if="renderError"
      class="plotly-chart__error"
      role="status"
    >
      This chart failed to render.
      <button
        type="button"
        class="plotly-chart__retry"
        @click="retry"
      >
        Retry
      </button>
    </p>
  </div>
</template>

<style scoped>
.plotly-chart {
  width: 100%;
}
.plotly-chart__error {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  margin: 0;
  padding: 10px 0 2px;
  color: var(--fg-mute);
  font-size: 13px;
}
.plotly-chart__retry {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  background: var(--surface);
  color: var(--fg-soft);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.plotly-chart__retry:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}
</style>
