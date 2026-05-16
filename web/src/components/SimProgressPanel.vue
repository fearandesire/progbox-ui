<script setup lang="ts">
import { useSimProgress } from "../composables/useSimProgress";

const props = defineProps<{ build: string }>();

const { pct, message } = useSimProgress(props.build);
</script>

<template>
  <div class="progress">
    <span class="eyebrow">Live progress · SSE stream</span>
    <div class="progress__top">
      <div class="progress__num">
        {{ Math.round(pct) }}<span class="pct">%</span>
      </div>
    </div>
    <div class="progress__bar">
      <div
        class="progress__fill"
        :style="{ width: `${pct}%` }"
      />
    </div>
    <div
      v-if="message"
      class="progress__msg"
    >
      {{ message }}
    </div>
  </div>
</template>
