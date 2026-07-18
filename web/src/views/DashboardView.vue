<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import InfoTip from "../components/InfoTip.vue";
import LeagueExportPill from "../components/LeagueExportPill.vue";
import StatusBadge from "../components/StatusBadge.vue";
import VersionChip from "../components/VersionChip.vue";
import { useRunStats } from "../composables/useRunStats";
import { deleteSim } from "../lib/api";
import { duration, signed, timeAgo } from "../lib/format";
import type { RunMetadata } from "../lib/types";
import { useSimsStore } from "../stores/sims";

const router = useRouter();
const sims = useSimsStore();

onMounted(() => {
  void sims.load();
});

// CalVer build ids sort lexicographically; newest first.
const sortedRuns = computed<RunMetadata[]>(() =>
  [...sims.runs].sort((a, b) => b.build.localeCompare(a.build)),
);

const lastCompleted = computed<RunMetadata | null>(
  () => sortedRuns.value.find((r) => r.status === "complete") ?? null,
);

const lastBuild = computed<string | null>(
  () => lastCompleted.value?.build ?? null,
);
const { stats, loading: statsLoading } = useRunStats(lastBuild);

const exportFile = computed(
  () =>
    lastCompleted.value?.export_file ??
    sortedRuns.value[0]?.export_file ??
    null,
);
const exportTitle = computed(
  () =>
    lastCompleted.value?.export_title ??
    sortedRuns.value[0]?.export_title ??
    null,
);
const playerCount = computed(
  () =>
    lastCompleted.value?.player_count ??
    sortedRuns.value[0]?.player_count ??
    null,
);

const num = (v: number | undefined | null, d = 0) =>
  v === undefined || v === null ? "—" : v.toFixed(d);

// Six stats: scale (iter / players / god progs) + shape (severe regs / mean delta / sigma).
const lastStats = computed(() => {
  const r = lastCompleted.value;
  const s = stats.value;
  return [
    {
      v: r?.runs != null ? String(r.runs) : "—",
      l: "Iterations",
      sub: "simulated seasons",
      tip: "How many times the season was re-rolled. The master seed (set in New sim) stays fixed across the run; each iteration derives a deterministic sub-seed from it, so identical inputs reproduce identical results. More iterations means tighter confidence intervals at the cost of compute.",
    },
    {
      v: s
        ? String(s.playersAnalyzed)
        : r?.player_count != null
          ? String(r.player_count)
          : "—",
      l: "Players analyzed",
      sub: "in-league only",
      tip: "The players actually simulated. Free Agents, UDFA, and Retired buckets are skipped; only players currently slotted onto a team get a projection.",
    },
    {
      v: s ? String(s.godProgs) : "—",
      l: "God progs",
      sub: "elite outliers",
      accent: true,
      tip: "Players who had a freak good run: an unusually large rating bump for their age. Open the run's God Progs tab for the per-event log.",
    },
    {
      v: s ? String(s.severeRegressions) : "—",
      l: "Severe regressions",
      sub: "cliff cases",
      color: "var(--rd-600)",
      tip: "Players who fell off a cliff: a big drop in projected rating. These are not gentle decliners, they are collapse cases (mean delta of -2.0 or worse from baseline).",
    },
    {
      v: s ? signed(s.meanDelta) : "—",
      l: "Mean Δ",
      sub: "baseline → P50",
      color: "var(--em-600)",
      tip: "Did the league get better or worse, on average. Mean rating change from each player's pre-sim baseline to their median projection, across the cohort. Positive means the league projects to improve.",
    },
    {
      v: s ? num(s.sigma, 2) : "—",
      l: "σ",
      sub: "spread",
      color: "var(--am-700)",
      tip: "How much the cohort disagrees with itself. Standard deviation of the P50 distribution across all players; higher sigma means a wider gap between the best and worst projections.",
    },
  ];
});

function openRun(build: string) {
  void router.push(`/runs/${build}`);
}
function onCardClick(e: Event) {
  if ((e.target as HTMLElement).closest(".info-tip")) return;
  if (lastCompleted.value) openRun(lastCompleted.value.build);
}

type Filter = "all" | "complete" | "running" | "failed";
const filter = ref<Filter>("all");
const query = ref("");
const page = ref(0);
const pageSize = 6;

const counts = computed(() => ({
  all: sortedRuns.value.length,
  complete: sortedRuns.value.filter((r) => r.status === "complete").length,
  running: sortedRuns.value.filter((r) => r.status === "running").length,
  failed: sortedRuns.value.filter((r) => r.status === "failed").length,
}));

const filtered = computed(() =>
  sortedRuns.value.filter((r) => {
    if (filter.value !== "all" && r.status !== filter.value) return false;
    if (
      query.value &&
      !r.build.toLowerCase().includes(query.value.toLowerCase())
    )
      return false;
    return true;
  }),
);

const pageCount = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / pageSize)),
);
const safePage = computed(() => Math.min(page.value, pageCount.value - 1));
const pageRows = computed(() =>
  filtered.value.slice(
    safePage.value * pageSize,
    safePage.value * pageSize + pageSize,
  ),
);
const startN = computed(() =>
  filtered.value.length ? safePage.value * pageSize + 1 : 0,
);
const endN = computed(() =>
  Math.min(filtered.value.length, (safePage.value + 1) * pageSize),
);

function setFilter(f: Filter) {
  filter.value = f;
  page.value = 0;
}
function onSearch(e: Event) {
  query.value = (e.target as HTMLInputElement).value;
  page.value = 0;
}

const chips: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "complete", label: "Complete" },
  { id: "running", label: "Running" },
  { id: "failed", label: "Failed" },
];

async function removeRun(build: string, e: Event) {
  e.stopPropagation();
  if (!window.confirm(`Delete run ${build}?`)) return;
  try {
    await deleteSim(build);
    await sims.load();
    selected.value = selected.value.filter((b) => b !== build);
  } catch (err) {
    console.error(err);
    window.alert("Failed to delete run. Please try again.");
  }
}

// Comparison: pick 2+ completed runs, open the head-to-head dashboard.
const selected = ref<string[]>([]);
const canCompare = computed(() => selected.value.length >= 2);

function toggleSelect(build: string) {
  const i = selected.value.indexOf(build);
  if (i >= 0) selected.value.splice(i, 1);
  else selected.value.push(build);
}

function openCompare() {
  if (!canCompare.value) return;
  void router.push({ path: "/compare", query: { builds: selected.value.join(",") } });
}
</script>

<template>
  <div class="page">
    <div class="section-head">
      <div>
        <h1 class="page-title">
          Simulations
        </h1>
        <p
          v-if="!sims.loading && sortedRuns.length"
          class="page-desc"
        >
          <template v-if="exportFile">
            From
            <LeagueExportPill
              :file="exportFile"
              :title="exportTitle"
            />
          </template>
          <template v-if="playerCount != null">
            <span v-if="exportFile"> · </span>
            <b style="color: var(--fg-soft); font-weight: 500">{{ playerCount }} players</b>
          </template>
        </p>
        <p
          v-else
          class="page-desc"
        >
          Upload a BBGM league export to run your first simulation.
        </p>
      </div>
      <RouterLink
        v-if="sortedRuns.length"
        to="/new"
        class="btn primary lg"
      >
        <DeIcon name="plus" />
        New simulation
      </RouterLink>
    </div>

    <div
      v-if="sims.loading"
      class="empty"
    >
      Loading simulations…
    </div>
    <div
      v-else-if="sims.error"
      class="empty"
      style="color: var(--rd-600); border-color: color-mix(in oklab, var(--rd-600) 35%, transparent)"
    >
      {{ sims.error }}
    </div>

    <section
      v-else-if="sortedRuns.length === 0"
      class="empty-hero"
    >
      <div class="empty-hero__mark">
        P
      </div>
      <h2 class="empty-hero__title">
        No simulations yet
      </h2>
      <p class="empty-hero__desc">
        Progbox runs Monte Carlo simulations against a BBGM league export.
        Upload an
        <code style="font-family: var(--mono); font-size: 13px; color: var(--fg-soft)">export.json</code>
        to start.
      </p>
      <div style="margin-top: 18px">
        <RouterLink
          to="/new"
          class="btn primary lg"
        >
          <DeIcon name="plus" />
          Start your first simulation
        </RouterLink>
      </div>
      <p class="empty-hero__hint">
        Don't have an export? In BBGM, open
        <span style="font-family: var(--mono)">Tools → Export league</span> and pick JSON.
      </p>
    </section>

    <template v-else>
      <article
        v-if="lastCompleted"
        class="last-run"
        role="link"
        tabindex="0"
        @click="onCardClick"
        @keydown.enter.prevent="lastCompleted && openRun(lastCompleted.build)"
        @keydown.space.prevent="lastCompleted && openRun(lastCompleted.build)"
      >
        <div class="last-run__head">
          <span class="eyebrow">Last completed run · stats below are for this run only</span>
          <span class="last-run__ago">
            ran in
            <b style="color: var(--fg-soft); font-weight: 500">{{ duration(lastCompleted.started_at, lastCompleted.completed_at) }}</b>
            · {{ timeAgo(lastCompleted.completed_at) }}
          </span>
        </div>

        <div class="last-run__title">
          <h3>
            <span class="last-run__build">{{ lastCompleted.build }}</span>
          </h3>
          <StatusBadge :status="lastCompleted.status" />
          <span
            v-if="statsLoading"
            class="eyebrow"
            style="margin-left: auto"
          >deriving stats…</span>
        </div>

        <div class="last-run__stats">
          <div
            v-for="st in lastStats"
            :key="st.l"
            class="last-run__stat"
          >
            <div
              class="last-run__stat-value"
              :style="{ color: st.accent ? 'var(--accent-text)' : st.color || 'var(--fg)' }"
            >
              {{ st.v }}
            </div>
            <div class="last-run__stat-label">
              <span>{{ st.l }}</span>
              <InfoTip :label="`${st.l} explanation`">
                {{ st.tip }}
              </InfoTip>
            </div>
            <div class="last-run__stat-sub">
              {{ st.sub }}
            </div>
          </div>
        </div>

        <div class="last-run__foot">
          <span class="last-run__foot-hint">
            Open this run to inspect player tables, charts, and the god-prog log.
          </span>
          <span class="last-run__cta">View run →</span>
        </div>
      </article>

      <div
        class="section-head"
        style="margin-top: 32px; margin-bottom: 14px"
      >
        <div>
          <h2>All simulations</h2>
          <p
            class="page-desc"
            style="margin-top: 2px; font-size: 13px"
          >
            Every run launched.
          </p>
        </div>
        <span class="meta">
          <b>{{ counts.all }}</b> total
          <template v-if="counts.running > 0">
            · <b style="color: var(--accent-text)">{{ counts.running }} running</b>
          </template>
        </span>
      </div>

      <div class="runs-toolbar">
        <div
          class="filter-chips"
          role="tablist"
          aria-label="Filter by status"
        >
          <button
            v-for="c in chips"
            :key="c.id"
            class="chip"
            :class="{ active: filter === c.id }"
            role="tab"
            :aria-selected="filter === c.id"
            type="button"
            @click="setFilter(c.id)"
          >
            {{ c.label }}
            <span class="chip__count">{{ counts[c.id] }}</span>
          </button>
        </div>
        <div class="search-box">
          <DeIcon
            name="search"
            :size="12"
          />
          <input
            :value="query"
            placeholder="Search Run ID…"
            aria-label="Search Run ID"
            @input="onSearch"
          >
        </div>
        <button
          class="btn ghost compare-btn"
          type="button"
          :disabled="!canCompare"
          :title="canCompare ? 'Compare selected runs' : 'Select 2 or more completed runs to compare'"
          aria-label="Compare selected runs"
          @click="openCompare"
        >
          Compare<span v-if="selected.length"> ({{ selected.length }})</span>
        </button>
      </div>

      <div
        v-if="pageRows.length === 0"
        class="empty"
        style="margin-top: 14px"
      >
        No simulations match these filters.
      </div>
      <div
        v-else
        class="runs-list"
      >
        <div
          v-for="r in pageRows"
          :key="r.build"
          class="run-row"
          role="link"
          tabindex="0"
          :aria-label="r.build"
          @click="openRun(r.build)"
          @keydown.enter.prevent="openRun(r.build)"
          @keydown.space.prevent="openRun(r.build)"
        >
          <div class="run-row__main">
            <input
              v-if="r.status === 'complete'"
              class="run-row__select"
              type="checkbox"
              :checked="selected.includes(r.build)"
              :aria-label="`Select run ${r.build} for comparison`"
              @click.stop
              @change="toggleSelect(r.build)"
            >
            <span class="run-row__id">{{ r.build }}</span>
            <StatusBadge :status="r.status" />
            <VersionChip :version="r.requested_version ?? r.script_version" />
            <div class="run-row__meta">
              <span><b>{{ r.runs ?? "—" }}</b> iter</span>
              <span><b>{{ r.player_count ?? "—" }}</b> players</span>
              <span>{{ timeAgo(r.started_at) || (r.started_at ?? "—") }}</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px">
            <span class="run-row__meta">
              <span>{{ duration(r.started_at, r.completed_at) }}</span>
            </span>
            <button
              class="run-row__del"
              type="button"
              :aria-label="`Delete run ${r.build}`"
              title="Delete run"
              @click="removeRun(r.build, $event)"
            >
              <DeIcon
                name="trash"
                :size="14"
              />
            </button>
          </div>
        </div>
      </div>

      <div class="pagination">
        <span class="pagination__count">
          <template v-if="filtered.length === 0">0 results</template>
          <template v-else>
            <b>{{ startN }}–{{ endN }}</b> of <b>{{ filtered.length }}</b>
          </template>
        </span>
        <div class="pagination__nav">
          <button
            class="pagination__btn"
            type="button"
            :disabled="safePage === 0"
            @click="page = Math.max(0, safePage - 1)"
          >
            ← Prev
          </button>
          <span class="pagination__page">
            page <b>{{ safePage + 1 }}</b> of <b>{{ pageCount }}</b>
          </span>
          <button
            class="pagination__btn"
            type="button"
            :disabled="safePage >= pageCount - 1"
            @click="page = Math.min(pageCount - 1, safePage + 1)"
          >
            Next →
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
