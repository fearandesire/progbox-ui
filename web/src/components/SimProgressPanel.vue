<script setup lang="ts">
import { useSimProgress } from "../composables/useSimProgress";

const props = defineProps<{
  build: string;
}>();

const { pct, message } = useSimProgress(props.build);
</script>

<template>
  <div class="mt-6 rounded-lg border border-neutral-200 bg-white p-5 shadow-[4px_4px_0px_rgba(0,0,0,0.1)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-[4px_4px_0px_rgba(255,255,255,0.05)]">
    <p class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
      Live Progress
    </p>
    <p class="mt-2 font-mono text-lg font-bold text-neutral-900 dark:text-neutral-100">
      {{ Math.round(pct) }}%
    </p>
    <p
      v-if="message"
      class="mt-1 text-sm text-neutral-600 dark:text-neutral-400"
    >
      {{ message }}
    </p>
    <div class="mt-4 h-3 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
      <div
        class="h-full bg-gradient-to-r from-sky-500 to-indigo-600 transition-[width] duration-500 ease-[cubic-bezier(0.87,0,0.13,1)] dark:from-sky-400 dark:to-indigo-500"
        :style="{ width: `${pct}%` }"
      />
    </div>
  </div>
</template>
