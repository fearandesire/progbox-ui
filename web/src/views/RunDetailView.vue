<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChartGallery from "../components/ChartGallery.vue";
import DeIcon from "../components/DeIcon.vue";
import GodProgList from "../components/GodProgList.vue";
import InfoTip from "../components/InfoTip.vue";
import LeagueExportPill from "../components/LeagueExportPill.vue";
import PlayerTable from "../components/PlayerTable.vue";
import SimProgressPanel from "../components/SimProgressPanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import VersionChip from "../components/VersionChip.vue";
import { useRunStats } from "../composables/useRunStats";
import { deleteSim, downloadUrl, fetchSim } from "../lib/api";
import { duration, signed } from "../lib/format";
import type { RunMetadata } from "../lib/types";

type Tab = "overview" | "charts" | "players" | "godprogs";

// Local forward-compatible augmentation for pairing metadata (owned by lib).
type PairedRun = RunMetadata & {
  pair_id?: string | null;
  pair_role?: "primary" | "baseline" | null;
  paired_with?: string | null;
};

const route = useRoute();
const router = useRouter();
const build = computed(() => String(route.params.build ?? ""));
const tab = ref<Tab>("overview");

const run = ref<RunMetadata | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const notFound = ref(false);
const deleteError = ref<string | null>(null);
const copied = ref(false);
let requestSeq = 0;

function httpStatus(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const o = e as Record<string, unknown>;
  if (typeof o.status === "number") return o.status;
  if (typeof o.statusCode === "number") return o.statusCode;
  return null;
}

async function loadDetail() {
  const seq = ++requestSeq;
  const b = build.value;
  if (!b) {
    error.value = "Missing build id";
    return;
  }
  loading.value = true;
  error.value = null;
  notFound.value = false;
  run.value = null;
  try {
    const data = await fetchSim(b);
    if (seq !== requestSeq) return;
    run.value = data;
  } catch (e: unknown) {
    if (seq !== requestSeq) return;
    const status = httpStatus(e);
    if (status === 404) {
      notFound.value = true;
    } else if (status === 422) {
      error.value = "Invalid Run ID (expected 14-digit CalVer).";
    } else if (e instanceof Error) {
      error.value = e.message;
    } else {
      error.value = String(e);
    }
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

watch(build, () => void loadDetail(), { immediate: true });

// Derive KPIs from /players + /godprogs once the run is complete.
const statsBuild = computed<string | null>(() =>
  run.value && run.value.status === "complete" ? build.value : null,
);
const { stats } = useRunStats(statsBuild);

const kpis = computed(() => {
  const s = stats.value;
  return [
    {
      eyebrow: "Players analyzed",
      info: "Players on an active roster in the export. Free Agents, UDFA, and Retired buckets are excluded.",
      value: s ? String(s.playersAnalyzed) : run.value?.player_count != null ? String(run.value.player_count) : "—",
      accent: true,
      mono: false,
      label: "Only in-league players get a projection.",
    },
    {
      eyebrow: "God progs detected",
      info: "Iterations where a player gained an unusually large rating bump for their age. See the God Progs tab for per-event detail.",
      value: s ? String(s.godProgs) : "—",
      accent: true,
      mono: false,
      label: "Elite outcomes flagged across the run.",
    },
    {
      eyebrow: "Mean Δ baseline → P50",
      info: "Average rating change from each player's pre-sim baseline to their median projection. Positive means the cohort projects to improve.",
      value: s ? signed(s.meanDelta) : "—",
      accent: false,
      mono: true,
      label: "Did the league get better or worse, on average.",
    },
    {
      eyebrow: "Top P95 ceiling",
      info: "The highest 95th-percentile projection across all players: the single best-case outcome the simulation produced.",
      value: s ? s.p95Ceiling.toFixed(1) : "—",
      accent: false,
      mono: true,
      label: "Best-case projection produced for any player.",
    },
  ];
});

// Pairing: a run created via auto-comparison links to its sibling + the comparison.
const pairing = computed(() => {
  const r = run.value as PairedRun | null;
  if (!r || !r.paired_with) return null;
  return {
    sibling: r.paired_with,
    role: r.pair_role ?? null,
    compareBuilds: `${r.build},${r.paired_with}`,
  };
});

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "charts", label: "Charts" },
  { id: "players", label: "Players" },
  { id: "godprogs", label: "God Progs" },
];

async function copyBuild() {
  if (!run.value) return;
  try {
    await navigator.clipboard.writeText(run.value.build);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    /* clipboard unavailable */
  }
}

async function removeRun() {
  if (!run.value) return;
  if (!window.confirm(`Delete run ${run.value.build}?`)) return;
  deleteError.value = null;
  try {
    await deleteSim(run.value.build);
    await router.push("/");
  } catch (e: unknown) {
    deleteError.value = e instanceof Error ? e.message : String(e);
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
      v-if="loading"
      class="empty"
    >
      Loading run…
    </div>
    <div
      v-else-if="notFound"
      class="empty"
      style="color: var(--am-700); border-color: color-mix(in oklab, var(--am-700) 35%, transparent)"
    >
      Run not found (no metadata for this Run ID).
    </div>
    <div
      v-else-if="error"
      class="empty"
      style="color: var(--rd-600); border-color: color-mix(in oklab, var(--rd-600) 35%, transparent)"
    >
      {{ error }}
    </div>

    <template v-else-if="run">
      <SimProgressPanel
        v-if="run.status === 'running'"
        :build="build"
      />

      <section
        class="header-split"
        aria-label="Run summary"
      >
        <aside class="manifest">
          <span class="eyebrow">Run summary</span>
          <div>
            <h1>
              Progbox <span class="accent">·</span> run
            </h1>
            <p
              class="desc"
              style="margin-top: 8px"
            >
              Monte Carlo simulation of player rating distributions across the active export.
            </p>
            <div style="margin-top: 10px">
              <LeagueExportPill
                v-if="run.export_file"
                :file="run.export_file"
              />
            </div>
          </div>

          <button
            class="build-id"
            type="button"
            :title="copied ? 'Copied' : 'Copy Run ID'"
            @click="copyBuild"
          >
            <span class="lbl">run id</span>
            {{ run.build }}
            <DeIcon
              name="copy"
              :size="13"
            />
          </button>

          <dl class="meta-list">
            <div class="meta-row">
              <dt>Iter</dt><dd>{{ run.runs ?? "—" }}</dd>
            </div>
            <div class="meta-row">
              <dt>Players</dt><dd>{{ run.player_count ?? "—" }}</dd>
            </div>
            <div class="meta-row">
              <dt>Seed</dt><dd>{{ run.seed ?? "—" }}</dd>
            </div>
            <div class="meta-row">
              <dt>Workers</dt><dd>{{ run.n_workers ?? "auto" }}</dd>
            </div>
            <div class="meta-row">
              <dt>Script</dt>
              <dd style="display: flex; align-items: center; gap: 8px">
                <VersionChip :version="run.script_version ?? run.requested_version" />
                <span
                  v-if="run.script_version && run.script_version !== 'v4.3' && run.script_version !== 'v4.1'"
                  style="font-size: 12px; color: var(--fg-mute)"
                >{{ run.script_version }}</span>
              </dd>
            </div>
            <div class="meta-row">
              <dt>Teams</dt><dd>{{ run.teams?.length ? run.teams.join(", ") : "all" }}</dd>
            </div>
            <div class="meta-row">
              <dt>Started</dt><dd>{{ run.started_at ?? "—" }}</dd>
            </div>
            <div class="meta-row">
              <dt>Duration</dt><dd>{{ duration(run.started_at, run.completed_at) }}</dd>
            </div>
          </dl>

          <div class="status-row">
            <span class="lbl">Status</span>
            <StatusBadge :status="run.status" />
          </div>
          <div
            v-if="run.teaminfo_source"
            class="status-row"
          >
            <span class="lbl">Teaminfo</span>
            <span class="teaminfo-tag">{{ run.teaminfo_source }}</span>
          </div>

          <div
            v-if="pairing"
            class="paired-box"
          >
            <span class="paired-box__tag">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Paired run<template v-if="pairing.role"> · {{ pairing.role }}</template>
            </span>
            <div class="paired-box__links">
              <RouterLink :to="`/runs/${pairing.sibling}`">
                Sibling run
              </RouterLink>
              <RouterLink :to="{ path: '/compare', query: { builds: pairing.compareBuilds } }">
                View comparison
              </RouterLink>
            </div>
          </div>

          <div class="actions">
            <a
              class="btn primary"
              :href="downloadUrl(run.build, 'analysis')"
            >
              <DeIcon name="download" />
              Download .xlsx
            </a>
            <a
              class="btn ghost"
              :href="downloadUrl(run.build, 'csv')"
            >
              CSV
            </a>
            <button
              class="btn danger"
              type="button"
              @click="removeRun"
            >
              <DeIcon name="trash" />
              Delete
            </button>
          </div>
          <p
            v-if="deleteError"
            role="alert"
            style="color: var(--rd-600); font-size: 13px; margin: 0"
          >
            {{ deleteError }}
          </p>
        </aside>

        <div class="kpi-grid">
          <article
            v-for="k in kpis"
            :key="k.eyebrow"
            class="kpi"
          >
            <div class="kpi-top">
              <span class="kpi-eyebrow">
                {{ k.eyebrow }}
                <InfoTip :label="`${k.eyebrow} explanation`">
                  {{ k.info }}
                </InfoTip>
              </span>
            </div>
            <div
              class="kpi-number"
              :class="{ accent: k.accent, mono: k.mono }"
            >
              {{ k.value }}
            </div>
            <div class="kpi-foot">
              <div class="kpi-label">
                {{ k.label }}
              </div>
            </div>
          </article>
        </div>
      </section>

      <nav
        class="tabs"
        aria-label="Run sections"
      >
        <button
          v-for="t in TABS"
          :key="t.id"
          class="tab"
          :class="{ active: tab === t.id }"
          type="button"
          role="tab"
          :aria-selected="tab === t.id"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>

      <section
        v-if="tab === 'overview'"
        class="panel"
        aria-label="Rating distribution"
      >
        <div class="panel-head">
          <div>
            <h2 class="panel-title">
              Rating distribution across runs
            </h2>
            <p class="panel-sub">
              Representative shape of the P50 trajectory vs. baseline. The full
              per-stat panels rendered by the engine are under the Charts tab.
            </p>
          </div>
          <div
            v-if="stats"
            class="panel-meta"
          >
            <span>n=<b>{{ stats.playersAnalyzed }}</b></span>
            <span>σ=<b>{{ stats.sigma.toFixed(2) }}</b></span>
            <span>μ=<b>{{ signed(stats.meanDelta) }}</b></span>
          </div>
        </div>
        <div class="chart-wrap">
          <svg
            viewBox="0 0 800 220"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <g
              stroke="var(--line)"
              stroke-width="1"
            >
              <line
                x1="0"
                y1="55"
                x2="800"
                y2="55"
              />
              <line
                x1="0"
                y1="110"
                x2="800"
                y2="110"
              />
              <line
                x1="0"
                y1="165"
                x2="800"
                y2="165"
              />
            </g>
            <polyline
              points="0,150 80,148 160,144 240,142 320,138 400,135 480,132 560,128 640,124 720,120 800,116"
              fill="none"
              stroke="var(--fg-faint)"
              stroke-width="1.25"
              stroke-dasharray="4 4"
            />
            <path
              d="M0,135 L40,128 L80,120 L120,124 L160,108 L200,100 L240,90 L280,80 L320,70 L360,62 L400,55 L440,48 L480,42 L520,36 L560,32 L600,28 L640,24 L680,22 L720,18 L760,16 L800,14 L800,220 L0,220 Z"
              fill="var(--accent)"
              opacity=".10"
            />
            <polyline
              points="0,135 40,128 80,120 120,124 160,108 200,100 240,90 280,80 320,70 360,62 400,55 440,48 480,42 520,36 560,32 600,28 640,24 680,22 720,18 760,16 800,14"
              fill="none"
              stroke="var(--accent)"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle
              cx="800"
              cy="14"
              r="3.5"
              fill="var(--accent)"
            />
            <circle
              cx="800"
              cy="14"
              r="6"
              fill="var(--accent)"
              opacity=".25"
            />
          </svg>
        </div>
        <div class="legend">
          <span class="item"><span class="sw solid" />P50 trajectory</span>
          <span class="item"><span class="sw dashed" />Baseline</span>
          <span class="item"><span class="sw area" />Δ band</span>
        </div>
      </section>

      <ChartGallery
        v-else-if="tab === 'charts'"
        :build="run.build"
        :analysis-engine="run.analysis_engine"
      />
      <PlayerTable
        v-else-if="tab === 'players'"
        :build="run.build"
      />
      <GodProgList
        v-else
        :build="run.build"
      />
    </template>
  </div>
</template>

<style scoped>
.paired-box {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  background: var(--surface);
}
.paired-box__tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--fg-mute);
}
.paired-box__links {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
}
.paired-box__links a {
  color: var(--accent-text, inherit);
  text-decoration: none;
}
.paired-box__links a:hover {
  text-decoration: underline;
}
</style>
