<script setup lang="ts">
import { computed } from "vue";

/** Raw version id (`v41`/`v43`), label (`v4.3`), or progression name. */
const props = defineProps<{ version?: string | null }>();

const kind = computed<"v43" | "v41" | "other">(() => {
  const v = (props.version ?? "").toLowerCase();
  if (!v) return "other";
  if (v.includes("43") || v.includes("4.3")) return "v43";
  if (v.includes("41") || v.includes("4.1")) return "v41";
  return "other";
});

const label = computed(() => {
  if (kind.value === "v43") return "v4.3";
  if (kind.value === "v41") return "v4.1";
  return props.version ?? "—";
});
</script>

<template>
  <span
    class="version-chip"
    :class="`version-chip--${kind}`"
    :title="`Progression script: ${label}`"
  >{{ label }}</span>
</template>

<style scoped>
.version-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--line);
  font-family: var(--mono, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.5;
  color: var(--fg-mute);
  background: var(--surface);
  white-space: nowrap;
}
.version-chip--v43 {
  color: var(--accent-text, #047857);
  border-color: color-mix(in srgb, var(--accent, #10b981) 45%, transparent);
  background: color-mix(in srgb, var(--accent, #10b981) 12%, transparent);
}
.version-chip--v41 {
  color: var(--fg-mute);
}
</style>
