<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { analysisHtmlUrl, fetchAnalysisData } from "../lib/api";
import type { AnalysisDataResponse } from "../lib/analysisTypes";
import AnalysisDashboard from "./analysis/AnalysisDashboard.vue";

const props = defineProps<{
  build: string;
  analysisEngine?: string | null;
}>();

// Direct URL to the engine-rendered dashboard HTML — used as the iframe
// fallback and as the "Open original dashboard" escape hatch.
const analysisUrl = computed(() => analysisHtmlUrl(props.build));

const isFallback = computed(() => props.analysisEngine === "fallback");

const data = ref<AnalysisDataResponse | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

// Native dashboard failed or is unavailable → embed the original HTML.
const useIframe = computed(
  () => isFallback.value || (loadError.value !== null && !loading.value),
);

// Monotonic token: a slow response for a previous build must never overwrite
// the current one's dashboard.
let requestId = 0;

async function load() {
  if (isFallback.value) return;
  const token = ++requestId;
  loading.value = true;
  loadError.value = null;
  data.value = null;
  try {
    const result = await fetchAnalysisData(props.build);
    if (token !== requestId) return;
    data.value = result;
  } catch (e) {
    if (token !== requestId) return;
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (token === requestId) loading.value = false;
  }
}

onMounted(load);
watch(() => props.build, load);

const containerEl = ref<HTMLElement | null>(null);
const frameEl = ref<HTMLIFrameElement | null>(null);

function toggleFullscreen() {
  const el = useIframe.value ? frameEl.value : containerEl.value;
  if (!el) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void el.requestFullscreen?.();
  }
}
</script>

<template>
  <section class="panel chart-gallery">
    <div class="panel-head chart-gallery__head">
      <div>
        <h2 class="panel-title">
          Analysis dashboard
        </h2>
        <p class="panel-sub">
          Interactive league-health, age-curve, attribute-movement and player-outcome charts.
        </p>
      </div>
      <div class="chart-gallery__actions">
        <a
          class="chart-gallery__fs"
          :href="analysisUrl"
          target="_blank"
          rel="noopener"
          title="Open the original engine-rendered dashboard in a new tab"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
          </svg>
          Original
        </a>
        <button
          class="chart-gallery__fs"
          type="button"
          title="View the dashboard fullscreen (Esc to exit)"
          aria-label="View dashboard fullscreen"
          @click="toggleFullscreen"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
          Fullscreen
        </button>
      </div>
    </div>
    <p
      v-if="isFallback"
      class="fallback-notice"
      role="status"
    >
      Full interactive dashboard unavailable for this run — showing the basic
      table instead. The Python analysis step failed (check the API logs and
      that the analysis dependencies are installed).
    </p>
    <p
      v-else-if="loadError && !loading"
      class="fallback-notice"
      role="status"
    >
      Native dashboard unavailable — showing the original engine-rendered
      report instead.
    </p>

    <div
      v-if="loading"
      class="chart-gallery__loading"
      role="status"
    >
      <span
        class="chart-gallery__spinner"
        aria-hidden="true"
      />
      Loading analysis data…
    </div>
    <div
      v-else-if="!useIframe && data"
      ref="containerEl"
      class="chart-gallery__native"
    >
      <AnalysisDashboard :data="data" />
    </div>
    <iframe
      v-else-if="useIframe"
      ref="frameEl"
      :src="analysisUrl"
      class="chart-gallery__frame"
      title="Analysis Report"
      sandbox="allow-scripts allow-same-origin allow-downloads"
      allowfullscreen
    />
  </section>
</template>

<style scoped>
.chart-gallery {
  padding-bottom: 22px;
}
.chart-gallery__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.chart-gallery__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.chart-gallery__fs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  background: var(--surface);
  color: var(--fg-soft, inherit);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
}
.chart-gallery__fs:hover {
  border-color: var(--accent, #10b981);
  color: var(--accent-text, inherit);
}
.chart-gallery__loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 48px 0;
  justify-content: center;
  color: var(--fg-mute);
  font-size: 13px;
}
.chart-gallery__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: cg-spin 0.8s linear infinite;
}
@keyframes cg-spin {
  to { transform: rotate(360deg); }
}
.chart-gallery__native:fullscreen {
  overflow-y: auto;
  background: var(--bg);
  padding: 24px;
}
.chart-gallery__frame {
  width: 100%;
  height: 78vh;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
}
.chart-gallery__frame:fullscreen {
  height: 100vh;
  border: 0;
  border-radius: 0;
}
.fallback-notice {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--rd-600, #dc2626) 40%, transparent);
  border-radius: var(--r-md, 8px);
  background: color-mix(in srgb, var(--rd-600, #dc2626) 8%, transparent);
  color: var(--rd-600, #b91c1c);
  font-size: 13px;
  line-height: 1.5;
}
</style>
