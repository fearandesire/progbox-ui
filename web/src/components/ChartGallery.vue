<script setup lang="ts">
import { onMounted, ref } from "vue";
import { chartUrl, fetchCharts } from "../lib/api";

const props = defineProps<{
  build: string;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const charts = ref<string[]>([]);
const selectedChart = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    charts.value = await fetchCharts(props.build);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function open(name: string) {
  selectedChart.value = name;
}

function close() {
  selectedChart.value = null;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="space-y-4">
    <div
      v-if="loading"
      class="grid gap-4 md:grid-cols-2"
    >
      <div
        v-for="n in 4"
        :key="n"
        class="h-44 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800"
      />
    </div>

    <div
      v-else-if="error"
      class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    >
      <p>{{ error }}</p>
      <button
        class="mt-2 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
        @click="load"
      >
        Retry
      </button>
    </div>

    <p
      v-else-if="charts.length === 0"
      class="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
    >
      No charts yet.
    </p>

    <div
      v-else
      class="grid gap-4 md:grid-cols-2"
    >
      <button
        v-for="name in charts"
        :key="name"
        class="overflow-hidden rounded-lg border border-neutral-200 bg-white text-left shadow-sm transition duration-150 hover:border-sky-400 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
        @click="open(name)"
      >
        <img
          :src="chartUrl(build, name)"
          :alt="name"
          class="h-44 w-full object-cover"
          loading="lazy"
        >
        <p class="truncate px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
          {{ name }}
        </p>
      </button>
    </div>
  </section>

  <div
    v-if="selectedChart"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    @click.self="close"
  >
    <div class="w-full max-w-6xl space-y-2">
      <div class="flex items-center justify-between text-sm text-white">
        <p class="truncate font-mono">
          {{ selectedChart }}
        </p>
        <button
          class="rounded bg-white/20 px-3 py-1 transition-colors duration-150 hover:bg-white/30"
          @click="close"
        >
          Close
        </button>
      </div>
      <img
        :src="chartUrl(build, selectedChart)"
        :alt="selectedChart"
        class="max-h-[80vh] w-full rounded-lg object-contain"
      >
    </div>
  </div>
</template>
