<script setup lang="ts">
/* Technical detail: the source BBGM export this run was built from.
   Real metadata only carries the filename (no league title / size),
   so the pill shows the filename and explains itself on hover. */
import DeIcon from "./DeIcon.vue";

defineProps<{ file: string }>();
</script>

<template>
  <span
    class="league-pill"
    :title="`Source export — ${file}`"
    tabindex="0"
  >
    <DeIcon
      name="box"
      :size="12"
    />
    <b>export</b>
    <span class="league-pill__file">{{ file }}</span>
  </span>
</template>
