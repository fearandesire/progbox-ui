<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import VersionChip from "../components/VersionChip.vue";
import { compareUrl, fetchSims } from "../lib/api";
import type { RunMetadata } from "../lib/types";

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
      </div>

      <iframe
        :src="compareSrc"
        class="compare-frame"
        title="Comparison Dashboard"
        sandbox="allow-scripts allow-same-origin allow-downloads"
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
.compare-frame {
  width: 100%;
  height: 82vh;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
}
</style>
