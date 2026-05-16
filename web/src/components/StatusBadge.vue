<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status: string }>();

// Map any backend status onto one of the four signal dots.
const kind = computed(() => {
  if (props.status === "complete") return "complete";
  if (props.status === "running") return "running";
  if (props.status === "failed") return "failed";
  return "queued";
});
</script>

<template>
  <span
    class="badge"
    :class="kind"
  >{{ status }}</span>
</template>
