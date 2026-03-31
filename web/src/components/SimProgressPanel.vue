<script setup lang="ts">
import { useSimProgress } from "../composables/useSimProgress";

const props = defineProps<{
  build: string;
}>();

const { phase, pct, message } = useSimProgress(props.build);
</script>

<template>
  <div class="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/40">
    <p class="text-sm font-medium text-sky-900 dark:text-sky-100">
      Live progress
    </p>
    <p class="mt-1 font-mono text-xs text-sky-800 dark:text-sky-200">
      {{ phase ?? "…" }} · {{ Math.round(pct) }}%
    </p>
    <p
      v-if="message"
      class="mt-1 text-xs text-sky-700 dark:text-sky-300"
    >
      {{ message }}
    </p>
    <div class="mt-2 h-2 w-full overflow-hidden rounded bg-sky-200 dark:bg-sky-900">
      <div
        class="h-full bg-sky-600 transition-[width] duration-300 dark:bg-sky-400"
        :style="{ width: `${pct}%` }"
      />
    </div>
  </div>
</template>
