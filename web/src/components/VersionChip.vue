<script setup lang="ts">
import { computed } from "vue";
import {
  versionChipClass,
  versionLabel,
  versionTitle,
  resolveVersion,
  type ProgressionVersion,
} from "../lib/versions";

/** Requested version and engine-reported fallback, as stored in run metadata. */
const props = defineProps<{ version?: string | null; scriptVersion?: string | null }>();

const kind = computed<ProgressionVersion | "other">(
  () => resolveVersion(props.version, props.scriptVersion) ?? "other",
);

const label = computed(() => {
  if (kind.value === "other") return props.version ?? props.scriptVersion ?? "—";
  return versionLabel(kind.value);
});

const title = computed(() => {
  if (kind.value === "other") return `Progression script: ${label.value}`;
  return versionTitle(kind.value);
});

const chipClass = computed(() => {
  if (kind.value === "other") return "other";
  return versionChipClass(kind.value);
});
</script>

<template>
  <span
    class="version-chip"
    :class="`version-chip--${chipClass}`"
    :title="title"
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
.version-chip--v3-2-1 {
  color: #1d4ed8;
  border-color: color-mix(in srgb, #3b82f6 45%, transparent);
  background: color-mix(in srgb, #3b82f6 12%, transparent);
}
.version-chip--v4-3 {
  color: var(--accent-text, #047857);
  border-color: color-mix(in srgb, var(--accent, #10b981) 45%, transparent);
  background: color-mix(in srgb, var(--accent, #10b981) 12%, transparent);
}
.version-chip--v4-1 {
  color: var(--fg-mute);
}
</style>
