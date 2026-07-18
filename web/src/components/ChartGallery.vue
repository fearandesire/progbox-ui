<script setup lang="ts">
import { computed } from "vue";
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
</script>

<template>
  <section class="panel chart-gallery">
    <div class="panel-head">
      <div>
        <h2 class="panel-title">
          Analysis dashboard
        </h2>
        <p class="panel-sub">
          Interactive league-health, age-curve, attribute-movement and player-outcome charts.
        </p>
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
    <iframe
      :src="analysisUrl"
      class="chart-gallery__frame"
      title="Analysis Report"
      sandbox="allow-scripts allow-same-origin allow-downloads"
    />
  </section>
</template>

<style scoped>
.chart-gallery {
  padding-bottom: 22px;
}
.chart-gallery__frame {
  width: 100%;
  height: 78vh;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
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
