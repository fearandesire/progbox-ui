<script setup lang="ts">
import { computed } from "vue";
import { getApiBaseUrl } from "../lib/api";

const props = defineProps<{
  build: string;
}>();

// Construct the direct URL to the HTML report
const analysisUrl = computed(() => {
  return `${getApiBaseUrl()}/sims/${encodeURIComponent(props.build)}/analysis_dashboard.html`;
});
</script>

<template>
  <section class="h-[80vh] w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
    <!-- 
      We use an iframe to load the analysis.html directly. 
      The 'h-[80vh]' gives it a fixed height relative to the viewport.
    -->
    <iframe
      :src="analysisUrl"
      class="h-full w-full border-none"
      title="Analysis Report"
      sandbox="allow-scripts allow-same-origin allow-downloads"
    />
  </section>
</template>

<style scoped>
/* Optional: ensures the iframe container looks clean */
section {
  display: flex;
  flex-direction: column;
}
</style>