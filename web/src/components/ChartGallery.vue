<script setup lang="ts">
import { computed, ref } from "vue";
import { getApiBaseUrl } from "../lib/api";

const props = defineProps<{
  build: string;
  analysisEngine?: string | null;
}>();

// Direct URL to the engine-rendered interactive analysis dashboard.
const analysisUrl = computed(
  () => `${getApiBaseUrl()}/sims/${encodeURIComponent(props.build)}/analysis`,
);

const isFallback = computed(() => props.analysisEngine === "fallback");

const frameEl = ref<HTMLIFrameElement | null>(null);

function toggleFullscreen() {
  const el = frameEl.value;
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
    <p
      v-if="isFallback"
      class="fallback-notice"
      role="status"
    >
      Full interactive dashboard unavailable for this run — showing the basic
      table instead. The Python analysis step failed (check the API logs and
      that the analysis dependencies are installed).
    </p>
    <iframe
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
}
.chart-gallery__fs:hover {
  border-color: var(--accent, #10b981);
  color: var(--accent-text, inherit);
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
