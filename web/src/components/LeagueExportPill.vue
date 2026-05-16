<script setup lang="ts">
import { computed } from "vue";
import DeIcon from "./DeIcon.vue";

const props = defineProps<{ file: string; title?: string | null }>();

const label = computed(() => props.title ?? props.file.split("/").pop() ?? props.file);
</script>

<template>
  <span
    class="league-pill"
    :title="`Source export — ${file}`"
  >
    <DeIcon
      name="box"
      :size="12"
    />
    <b>export</b>
    <span class="league-pill__file">{{ label }}</span>
  </span>
</template>
