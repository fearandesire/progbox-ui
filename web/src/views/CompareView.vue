<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import VersionChip from "../components/VersionChip.vue";
import { compareUrl, fetchSims } from "../lib/api";
import type { RunMetadata } from "../lib/types";

const frameEl = ref<HTMLIFrameElement | null>(null);
function toggleFullscreen() {
  const el = frameEl.value;
  if (!el) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void el.requestFullscreen?.();
  }
}

const route = useRoute();

const builds = computed<string[]>(() => {
  const raw = route.query.builds;
  const s = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  return String(s)
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
});

const valid = computed(() => builds.value.length >= 2);
const compareSrc = computed(() => compareUrl(builds.value));

const runs = ref<RunMetadata[]>([]);
onMounted(async () => {
  try {
    const all = await fetchSims();
    const byBuild = new Map(all.map((r) => [r.build, r]));
    runs.value = builds.value
      .map((b) => byBuild.get(b))
      .filter((r): r is RunMetadata => r != null);
  } catch {
    runs.value = [];
  }
});
</script>

<template>
  <div class="page">
    <RouterLink
      class="back"
      to="/"
    >
      <DeIcon
        name="arrow-left"
        :size="14"
      />
      Dashboard
    </RouterLink>

    <div
      class="section-head"
      style="margin-bottom: 12px"
    >
      <div>
        <h1 class="page-title">
          Comparison
        </h1>
        <p class="page-desc">
          Head-to-head scorecard and overlaid charts across the selected runs.
        </p>
      </div>
    </div>

    <div
      v-if="!valid"
      class="empty"
    >
      Select at least two completed runs from the dashboard to compare.
    </div>

    <template v-else>
      <div class="compare-runs">
        <span
          v-for="b in builds"
          :key="b"
          class="compare-runs__item"
        >
          <VersionChip
            :version="runs.find((r) => r.build === b)?.requested_version
              ?? runs.find((r) => r.build === b)?.script_version"
          />
          <span class="compare-runs__id">{{ b }}</span>
        </span>
        <button
          class="compare-fs"
          type="button"
          title="View the comparison fullscreen (Esc to exit)"
          aria-label="View comparison fullscreen"
          @click="toggleFullscreen"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
          Fullscreen
        </button>
      </div>

      <iframe
        ref="frameEl"
        :src="compareSrc"
        class="compare-frame"
        title="Comparison Dashboard"
        sandbox="allow-scripts allow-same-origin allow-downloads"
        allowfullscreen
      />
    </template>
  </div>
</template>

<style scoped>
.compare-runs {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 14px;
}
.compare-runs__item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.compare-runs__id {
  font-family: var(--mono, monospace);
  font-size: 12.5px;
  color: var(--fg-soft);
}
.compare-fs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  background: var(--surface);
  color: var(--fg-soft, inherit);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.compare-fs:hover {
  border-color: var(--accent, #10b981);
  color: var(--accent-text, inherit);
}
.compare-frame:fullscreen {
  height: 100vh;
  border: 0;
  border-radius: 0;
}
.compare-frame {
  width: 100%;
  height: 82vh;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
}
</style>
