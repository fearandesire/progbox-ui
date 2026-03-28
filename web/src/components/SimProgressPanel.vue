<script setup lang="ts">
import { useSimProgress } from "../composables/useSimProgress";

const props = defineProps<{
  build: string;
}>();

const { phase, pct, message } = useSimProgress(props.build);
</script>

<template>
  <div class="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/40">
    <p class="text-sm font-medium text-violet-900 dark:text-violet-100">
      Live progress
    </p>
    <p class="mt-1 font-mono text-xs text-violet-800 dark:text-violet-200">
      {{ phase ?? "…" }} · {{ Math.round(pct) }}%
    </p>
    <p
      v-if="message"
      class="mt-1 text-xs text-violet-700 dark:text-violet-300"
    >
      {{ message }}
    </p>
    <div class="mt-2 h-2 w-full overflow-hidden rounded bg-violet-200 dark:bg-violet-900">
      <div
        class="h-full bg-violet-600 transition-[width] duration-300 dark:bg-violet-400"
        :style="{ width: `${pct}%` }"
      />
    </div>
  </div>
</template>
