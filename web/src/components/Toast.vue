<script setup lang="ts">
/* Minimal, reusable transient toast. Single-line message, fixed position,
   auto-dismisses. Visibility is parent-controlled via `show`; when shown it
   schedules a `close` emit after `duration` ms. */
import { onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    message: string;
    show: boolean;
    duration?: number;
  }>(),
  { duration: 4000 },
);

const emit = defineEmits<{ close: [] }>();

let timer: ReturnType<typeof setTimeout> | null = null;

function clear() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

watch(
  () => props.show,
  (visible) => {
    clear();
    if (visible && props.duration > 0) {
      timer = setTimeout(() => emit("close"), props.duration);
    }
  },
);

onUnmounted(clear);
</script>

<template>
  <Transition name="toast">
    <div
      v-if="show"
      class="toast"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 100;
  max-width: min(92vw, 520px);
  padding: 12px 18px;
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  background: var(--surface);
  color: var(--fg, inherit);
  font-size: 13.5px;
  line-height: 1.4;
  box-shadow: 0 8px 28px -8px rgba(0, 0, 0, 0.35);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
