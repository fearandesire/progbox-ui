<script setup lang="ts">
import { computed } from "vue";
import { getApiBaseUrl } from "../lib/api";

const props = defineProps<{ build: string }>();

// Direct URL to the engine-rendered HTML analysis report.
const analysisUrl = computed(
  () => `${getApiBaseUrl()}/sims/${encodeURIComponent(props.build)}/analysis`,
);
</script>

<template>
  <section class="panel chart-gallery">
    <div class="panel-head">
      <div>
        <h2 class="panel-title">
          Analysis report
        </h2>
        <p class="panel-sub">
          Six per-stat panels rendered by the engine.
        </p>
      </div>
    </div>
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
</style>
