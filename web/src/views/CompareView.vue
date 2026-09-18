<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AnalysisDashboard from "../components/analysis/AnalysisDashboard.vue";
import DeIcon from "../components/DeIcon.vue";
import VersionChip from "../components/VersionChip.vue";
import { compareUrl, fetchCompareData, fetchSims } from "../lib/api";
import type { CompareDataResponse } from "../lib/analysisTypes";
import type { RunMetadata } from "../lib/types";
import { versionRole, type VersionRole } from "../lib/versions";

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

const data = ref<CompareDataResponse | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

// Native comparison failed → embed the original engine-rendered HTML.
const useIframe = computed(() => loadError.value !== null && !loading.value);

// Monotonic token: an uncached comparison can take a minute, so a slow
// response for a previous build set must never replace the current one.
let requestId = 0;

async function load() {
  if (!valid.value) return;
  const token = ++requestId;
  loading.value = true;
  loadError.value = null;
  data.value = null;
  try {
    const result = await fetchCompareData(builds.value);
    if (token !== requestId) return;
    data.value = result;
  } catch (e) {
    if (token !== requestId) return;
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (token === requestId) loading.value = false;
  }
}

onMounted(load);
watch(builds, (next, prev) => {
  if (next.join(",") !== prev.join(",")) void load();
});

const runs = ref<RunMetadata[]>([]);

async function loadRuns() {
  try {
    const all = await fetchSims();
    const byBuild = new Map(all.map((r) => [r.build, r]));
    runs.value = builds.value
      .map((b) => byBuild.get(b))
      .filter((r): r is RunMetadata => r != null);
  } catch {
    runs.value = [];
  }
}

onMounted(() => {
  void loadRuns();
});
watch(builds, () => {
  void loadRuns();
});

function roleWord(role: VersionRole | null): string | null {
  if (role === "published") return "Published";
  if (role === "candidate") return "Candidate";
  if (role === "legacy") return "Legacy";
  return null;
}

function runRole(build: string): VersionRole | null {
  const r = runs.value.find((x) => x.build === build);
  return versionRole(r?.requested_version ?? "");
}

const isPublishedPair = computed(() => {
  if (builds.value.length !== 2 || runs.value.length !== 2) return false;
  const roles = runs.value.map((r) => versionRole(r.requested_version ?? ""));
  const hasPublished = roles.includes("published");
  const hasNonPublished = roles.some((r) => r != null && r !== "published");
  const pairId = runs.value[0]?.pair_id;
  const samePair =
    pairId != null && pairId !== "" && runs.value.every((r) => r.pair_id === pairId);
  return hasPublished && hasNonPublished && samePair;
});

/** Published-first when this is a published/candidate pair; else query order. */
const displayBuilds = computed(() => {
  if (!isPublishedPair.value) return builds.value;
  return [...builds.value].sort((a, b) => {
    const ra = runRole(a);
    const rb = runRole(b);
    if (ra === "published" && rb !== "published") return -1;
    if (rb === "published" && ra !== "published") return 1;
    return 0;
  });
});

const containerEl = ref<HTMLElement | null>(null);
const frameEl = ref<HTMLIFrameElement | null>(null);

function toggleFullscreen() {
  const el = useIframe.value ? frameEl.value : containerEl.value;
  if (!el) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void el.requestFullscreen?.();
  }
}
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
          <template v-if="isPublishedPair">Published vs Candidate</template>
          <template v-else>Comparison</template>
        </h1>
        <p class="page-desc">
          <template v-if="isPublishedPair">
            Left: NET 3.2, what leagues run today. Right: v4.3, the proposed release.
            Scorecard is the short answer, graphs are the detail.
          </template>
          <template v-else>
            Head-to-head scorecard and overlaid charts across the selected runs.
          </template>
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
          v-for="b in displayBuilds"
          :key="b"
          class="compare-runs__item"
        >
          <span
            v-if="roleWord(runRole(b))"
            class="compare-runs__role"
          >{{ roleWord(runRole(b)) }}</span>
          <VersionChip
            :version="runs.find((r) => r.build === b)?.requested_version
              ?? runs.find((r) => r.build === b)?.script_version"
          />
          <span class="compare-runs__id">{{ b }}</span>
        </span>
        <span class="compare-runs__actions">
          <a
            class="compare-fs"
            :href="compareSrc"
            target="_blank"
            rel="noopener"
            title="Open the original engine-rendered comparison in a new tab"
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
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
            </svg>
            Original
          </a>
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
        </span>
      </div>

      <p
        v-if="loadError && !loading"
        class="compare-error"
        role="status"
      >
        Native comparison unavailable — showing the original engine-rendered
        report instead.
      </p>

      <div
        v-if="loading"
        class="compare-loading"
        role="status"
      >
        <span
          class="compare-loading__spinner"
          aria-hidden="true"
        />
        Generating comparison… The first request runs the analysis engine and
        can take a minute; repeats load from cache.
      </div>
      <div
        v-else-if="!useIframe && data"
        ref="containerEl"
        class="compare-native panel"
      >
        <AnalysisDashboard
          :data="data"
          :scorecard="data.scorecard"
        />
      </div>
      <iframe
        v-else-if="useIframe"
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
.compare-runs__role {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-mute);
}
.compare-runs__id {
  font-family: var(--mono, monospace);
  font-size: 12.5px;
  color: var(--fg-soft);
}
.compare-runs__actions {
  display: inline-flex;
  gap: 8px;
  margin-left: auto;
}
.compare-fs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  background: var(--surface);
  color: var(--fg-soft, inherit);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
}
.compare-fs:hover {
  border-color: var(--accent, #10b981);
  color: var(--accent-text, inherit);
}
.compare-error {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--rd-600, #dc2626) 40%, transparent);
  border-radius: var(--r-md, 8px);
  background: color-mix(in srgb, var(--rd-600, #dc2626) 8%, transparent);
  color: var(--rd-600, #b91c1c);
  font-size: 13px;
  line-height: 1.5;
}
.compare-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 56px 0;
  justify-content: center;
  color: var(--fg-mute);
  font-size: 13px;
}
.compare-loading__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: cmp-spin 0.8s linear infinite;
}
@keyframes cmp-spin {
  to { transform: rotate(360deg); }
}
.compare-native {
  padding: 18px 20px 8px;
}
.compare-native:fullscreen {
  overflow-y: auto;
  background: var(--bg);
  padding: 24px;
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
