<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  status: string;
}>();

const cls = computed(() => {
  if (props.status === "complete") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  }
  if (props.status === "running") {
    return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300";
  }
  if (props.status === "failed") {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  }
  return "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
});
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
    :class="cls"
  >
    {{ status }}
  </span>
</template>
