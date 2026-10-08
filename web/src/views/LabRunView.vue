<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import LabAudit from "../components/lab/LabAudit.vue";
import LabChecks from "../components/lab/LabChecks.vue";
import LabPlayers from "../components/lab/LabPlayers.vue";
import LabReport from "../components/lab/LabReport.vue";
import LabSubnav from "../components/lab/LabSubnav.vue";
import LabSummary from "../components/lab/LabSummary.vue";
import "../components/lab/lab.css";
import { fetchLabRun, labErrorMessage, labFileUrl } from "../lib/api";
import { runDetailRows } from "../lib/labChecks";
import { expectedStages, modeLabel, secondsText } from "../lib/labFormat";
import type { LabRunDetail } from "../lib/labTypes";

const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id ?? ""));

const run = ref<LabRunDetail | null>(null);
const error = ref<string | null>(null);
const now = ref(Date.now());
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let seq = 0;

const POLL_MS = 1000;

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function load() {
  const mine = ++seq;
  stopPolling();
  try {
    const data = await fetchLabRun(id.value);
    if (mine !== seq) return;
    error.value = null;
    // A queued submission gets its real run id once it starts; move the URL to it.
    if (data.runId && data.runId !== id.value) {
      void router.replace(`/lab/runs/${data.runId}`);
      return;
    }
    run.value = data;
    if (data.state === "queued" || data.state === "running") pollTimer = setTimeout(load, POLL_MS);
  } catch (e) {
    if (mine !== seq) return;
    error.value = labErrorMessage(e, "Could not load the run");
    // Transient failures (API restart, network) keep retrying while a run might be live.
    if (run.value && (run.value.state === "queued" || run.value.state === "running")) pollTimer = setTimeout(load, POLL_MS * 3);
  }
}

watch(
  id,
  () => {
    run.value = null;
    void load();
  },
  { immediate: true },
);

clock = setInterval(() => (now.value = Date.now()), 1000);
onUnmounted(() => {
  stopPolling();
  if (clock) clearInterval(clock);
  seq++;
});

const isLive = computed(() => run.value?.state === "queued" || run.value?.state === "running");

const elapsed = computed(() => {
  const r = run.value;
  if (!r?.startedAt) return 0;
  if (r.state === "running") return Math.max(r.elapsed ?? 0, (now.value - new Date(r.startedAt).getTime()) / 1000);
  return r.seconds ?? r.elapsed ?? 0;
});

const overallPct = computed(() => {
  const r = run.value;
  if (!r) return 0;
  if (r.state === "done") return 100;
  if (!r.estimateSeconds) return 0;
  return Math.min(99, (elapsed.value / r.estimateSeconds) * 100);
});

const stageRows = computed(() => {
  const r = run.value;
  if (!r) return [];
  const live = new Map((r.stages ?? []).map((s) => [s.stage, s]));
  const plan = expectedStages(r);
  const current = r.stage ?? null;
  const curIdx = current ? plan.findIndex((p) => p.stage === current) : -1;
  return plan.map((p, i) => {
    const s = live.get(p.stage);
    let done = s?.done ?? 0;
    let total = s?.total ?? 0;
    if (!s && r.progress?.stage === p.stage) {
      done = r.progress.done;
      total = r.progress.total;
    }
    const state = r.state === "done" || i < curIdx ? "done" : i === curIdx ? "current" : "pending";
    return { ...p, label: s?.text && s.text !== p.stage ? s.text : p.label, done, total, state };
  });
});

const results = computed(() => run.value?.results ?? null);
const report = computed(() => results.value?.report ?? null);
const checks = computed(() => report.value?.checks ?? null);
const details = computed(() => report.value?.runDetails ?? null);
const detailRows = computed(() => runDetailRows(details.value, report.value?.lab));

const desc = computed(() => {
  const r = run.value;
  if (!r) return "";
  const parts = [details.value?.netRuns ?? modeLabel(r.mode), details.value?.league.name ?? report.value?.league.name ?? r.league ?? "default league"];
  if (details.value) parts.push(`${details.value.runs.toLocaleString("en-US")} runs`);
  const when = r.startedAt ?? r.createdAt;
  if (when) parts.push(new Date(when).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }));
  if (r.state === "done") parts.push(secondsText(r.seconds ?? elapsed.value));
  return parts.join(" · ");
});

const sections = computed(() => {
  const out: { id: string; label: string; count?: number }[] = [];
  if (checks.value) {
    out.push({ id: "r-verdict", label: "Verdict" }, { id: "r-checks", label: "Checks", count: checks.value.items.length });
    if (detailRows.value.length) out.push({ id: "r-details", label: "Run details" });
  } else out.push({ id: "r-summary", label: "Summary" });
  out.push({ id: "r-charts", label: "Charts" }, { id: "r-players", label: "Players" }, { id: "r-audit", label: "Audit" });
  return out;
});

function jumpTo(e: Event, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

const againQuery = computed(() => {
  const r = run.value;
  if (!r) return {};
  return { script: r.script, baseline: r.baseline ?? "none", ...(r.league ? { league: r.league } : {}), mode: r.mode };
});
const title = computed(() => {
  const r = run.value;
  if (!r) return id.value;
  return `${r.script}${r.baseline ? ` vs ${r.baseline}` : ""}`;
});
</script>

<template>
  <div class="page">
    <LabSubnav />

    <p
      v-if="error && !run"
      role="alert"
      class="lab-error"
    >
      {{ error }}
    </p>

    <template v-if="run">
      <div
        class="section-head"
        style="margin-bottom: 14px"
      >
        <div>
          <h1
            class="page-title"
            style="font-family: var(--mono); font-size: 22px"
          >
            {{ title }}
          </h1>
          <p
            class="page-desc"
            :title="run.runId ? `Run ${run.runId}` : undefined"
          >
            {{ desc }}
          </p>
        </div>
        <div
          v-if="run.state !== 'queued' && run.state !== 'running'"
          class="actions"
        >
          <RouterLink
            class="btn ghost lab-press"
            :to="{ path: '/lab', query: againQuery }"
            data-test="run-again"
          >
            <DeIcon name="rotate" />Run again
          </RouterLink>
          <a
            v-if="run.runId && report"
            class="btn ghost lab-press"
            :href="labFileUrl(run.runId, 'report.json')"
            download="report.json"
          >
            <DeIcon name="download" />Download report
          </a>
        </div>
      </div>

      <!-- Queued / running -->
      <section
        v-if="isLive"
        class="panel"
        data-test="progress"
      >
        <template v-if="run.state === 'queued'">
          <h2 class="panel-title">
            Queued
          </h2>
          <p class="page-desc">
            NET Lab runs one test at a time. This one is number {{ run.position || 1 }} in line and starts when the run ahead finishes.
          </p>
        </template>
        <template v-else>
          <div class="progress__top">
            <span class="eyebrow">Running</span>
            <span
              class="lab-estimate"
              :title="(run.estimateBasis ?? []).join('\n')"
            >
              {{ secondsText(elapsed) }} of ~{{ secondsText(run.estimateSeconds) }} estimated
            </span>
          </div>
          <div
            class="lab-bar"
            style="margin: 8px 0 16px"
          >
            <div :style="{ transform: `scaleX(${overallPct / 100})` }" />
          </div>
          <ol class="lab-stages">
            <li
              v-for="s in stageRows"
              :key="s.stage"
              class="lab-stage"
              :class="s.state"
            >
              <div class="lab-stage__row">
                <span>{{ s.state === "done" ? "✓" : s.state === "current" ? "◐" : "○" }} {{ s.label }}</span>
                <span
                  v-if="s.total"
                  class="lab-estimate"
                >{{ s.done }} / {{ s.total }}</span>
              </div>
              <div
                v-if="s.state === 'current' && s.total"
                class="lab-bar"
              >
                <div :style="{ transform: `scaleX(${s.done / s.total})` }" />
              </div>
            </li>
          </ol>
          <ul
            v-if="run.issues?.length"
            class="lab-issues"
            style="margin-top: 16px"
          >
            <li
              v-for="i in run.issues"
              :key="i.code"
              :class="i.level"
            >
              <span class="tag">{{ i.level }}</span><span>{{ i.text }}</span>
            </li>
          </ul>
        </template>
      </section>

      <!-- Failed -->
      <section
        v-else-if="run.state === 'failed'"
        class="panel"
      >
        <div class="callout-warn">
          <DeIcon
            name="alert"
            :size="18"
          />
          <div>
            <p class="callout-warn__title">
              The run failed
            </p>
            <pre
              class="lab-pre"
              data-test="run-error"
            >{{ run.error ?? "No error message was recorded." }}</pre>
          </div>
        </div>
      </section>

      <!-- Results -->
      <div
        v-else-if="results && report"
        class="lab-report"
      >
        <nav
          class="lab-jump"
          aria-label="Report sections"
          data-test="jump"
        >
          <a
            v-for="sec in sections"
            :key="sec.id"
            :href="`#${sec.id}`"
            @click="jumpTo($event, sec.id)"
          >{{ sec.label }}<b v-if="sec.count !== undefined">{{ sec.count }}</b></a>
        </nav>

        <template v-if="checks">
          <LabChecks
            :checks="checks"
            :script-id="report.script.id"
            :baseline-id="report.baseline?.id ?? null"
          />
          <section
            v-if="detailRows.length"
            id="r-details"
            class="panel lab-section"
            data-test="run-details"
          >
            <h2 class="panel-title">
              Run details
            </h2>
            <dl
              class="lab-kv"
              style="margin-top: 10px"
            >
              <template
                v-for="[k, v] in detailRows"
                :key="k"
              >
                <dt>{{ k }}</dt>
                <dd>{{ v }}</dd>
              </template>
            </dl>
          </section>
        </template>
        <section
          v-else
          id="r-summary"
          class="lab-section lab-stack"
        >
          <p
            class="lab-note"
            data-test="old-report"
          >
            This run was made before NET Lab 0.3.0, so it has no balance checks or Run details. Run it again to get them.
          </p>
          <LabSummary
            :report="report"
            :players="results.players.script"
            :summary="results.summary"
          />
        </section>

        <section
          id="r-charts"
          class="lab-section"
        >
          <h2 class="lab-h2">
            Charts
          </h2>
          <LabReport
            :report="report"
            :players="results.players"
            :deep="results.deep"
            style="margin-top: 12px"
          />
        </section>
        <section
          id="r-players"
          class="lab-section"
        >
          <h2 class="lab-h2">
            Players
          </h2>
          <LabPlayers
            :script-id="report.script.id"
            :baseline-id="report.baseline?.id ?? null"
            :players="results.players"
            :deep="results.deep"
            style="margin-top: 12px"
          />
        </section>
        <section
          id="r-audit"
          class="lab-section"
        >
          <h2 class="lab-h2">
            Audit
          </h2>
          <LabAudit
            :run-id="run.runId ?? id"
            :results="results"
            style="margin-top: 12px"
          />
        </section>
      </div>
      <p
        v-else
        class="page-desc"
      >
        This run finished but its report files are missing.
      </p>
    </template>
    <p
      v-else-if="!error"
      class="page-desc"
    >
      Loading…
    </p>
  </div>
</template>
