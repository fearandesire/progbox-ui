<script setup lang="ts">
import { computed } from "vue";
import {
  versionLabel,
  versionTitle,
  type ProgressionVersion,
} from "../lib/versions";

/** Raw version id (`v321`/`v41`/`v43`), label (`v4.3`), or progression name. */
const props = defineProps<{ version?: string | null }>();

const kind = computed<"v321" | "v43" | "v41" | "other">(() => {
  const v = (props.version ?? "").toLowerCase().trim();
  if (!v) return "other";
  // Exact ids first, then label/engine-name heuristics.
  // Prefer 4.3 / 4.1 before 3.2 so a stray "v4.3.2" does not classify as published.
  if (v === "v321" || v.startsWith("v321")) return "v321";
  if (v === "v43" || v.startsWith("v43")) return "v43";
  if (v === "v41" || v.startsWith("v41")) return "v41";
  if (v.includes("4.3")) return "v43";
  if (v.includes("4.1")) return "v41";
  // Engine name is "v3.2.1, current progression script".
  if (v.includes("321") || v.includes("3.2")) return "v321";
  return "other";
});

const label = computed(() => {
  if (kind.value === "other") return props.version ?? "—";
  return versionLabel(kind.value);
});

const title = computed(() => {
  if (kind.value === "other") return `Progression script: ${label.value}`;
  return versionTitle(kind.value as ProgressionVersion);
});
</script>

<template>
  <span
    class="version-chip"
    :class="`version-chip--${kind}`"
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
.version-chip--v321 {
  color: #1d4ed8;
  border-color: color-mix(in srgb, #3b82f6 45%, transparent);
  background: color-mix(in srgb, #3b82f6 12%, transparent);
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
