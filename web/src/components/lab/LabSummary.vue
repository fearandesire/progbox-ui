<script setup lang="ts">
import { computed, ref } from "vue";
import { AGE_BANDS, KPI_ROWS, copyText, int, sgn, verdictClass } from "../../lib/labFormat";
import type { LabPlayer, LabReport } from "../../lib/labTypes";
import LabChart from "./LabChart.vue";

const props = defineProps<{
  report: LabReport;
  players: LabPlayer[];
  summary: string | null;
}>();

const showMd = ref(false);
const copied = ref("");

const script = computed(() => props.report.script);
const base = computed(() => props.report.baseline);

const ageSeries = computed(() => [
  ...(base.value ? [{ name: base.value.id, role: "baseline" as const, data: AGE_BANDS.map((a) => base.value!.kpis.deltaByAge[a]?.meanDelta ?? null) }] : []),
  { name: script.value.id, role: "script" as const, data: AGE_BANDS.map((a) => script.value.kpis.deltaByAge[a]?.meanDelta ?? null) },
]);

const sorted = computed(() => [...props.players].sort((a, b) => b.meanDelta - a.meanDelta));
const risers = computed(() => sorted.value.slice(0, 5));
const fallers = computed(() => sorted.value.slice(-5).reverse());

// Warnings already appear as flags; list only the fixes NET Lab applied to the export.
const leagueNotes = computed(() => props.report.league.issues.filter((i) => i.level === "fix"));

function discordText(): string {
  const m = script.value.kpis;
  const b = base.value?.kpis;
  const head = `**NET Lab: ${script.value.id}${base.value ? ` vs ${base.value.id}` : ""}** · ${props.report.verdict}\n${props.report.mode} · ${props.report.league.name}`;
  const flags = props.report.flags.map((f) => `• ${f.text}`).join("\n");
  const line = b
    ? `Mean ΔOVR ${sgn(b.meanDelta)} → ${sgn(m.meanDelta)} · god progs/offseason ${b.godProgsPerRun.toFixed(2)} → ${m.godProgsPerRun.toFixed(2)}`
    : `Mean ΔOVR ${sgn(m.meanDelta)} · god progs/offseason ${m.godProgsPerRun.toFixed(2)}`;
  return [head, flags, line].filter(Boolean).join("\n");
}

async function copySummary() {
  copied.value = (await copyText(discordText())) ? "Copied" : "Copy blocked by the browser";
}
</script>

<template>
  <div class="lab-stack">
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">
            Verdict <span
              class="lab-pill"
              :class="verdictClass(report.verdict)"
              data-test="verdict"
            >{{ report.verdict }}</span>
          </h2>
          <p class="panel-sub">
            Flags are heuristics for where to look, not release gates.
          </p>
        </div>
      </div>
      <ul
        class="lab-issues"
        data-test="flags"
      >
        <li
          v-if="!report.flags.length"
          class="ok"
        >
          <span class="tag">ok</span><span>No flags</span>
        </li>
        <li
          v-for="f in report.flags"
          :key="f.text"
          :class="f.level === 'error' ? 'error' : 'warn'"
        >
          <span class="tag">{{ f.level }}</span><span>{{ f.text }}</span>
        </li>
      </ul>
      <p
        class="lab-credit"
        style="margin: 10px 0 0"
      >
        League: {{ report.league.name }}<template v-if="report.league.credit">
          · {{ report.league.credit }}
        </template>
      </p>
      <ul
        v-if="leagueNotes.length"
        class="lab-issues"
        style="margin-top: 6px"
      >
        <li
          v-for="i in leagueNotes"
          :key="i.code"
          :class="i.level"
        >
          <span class="tag">{{ i.level }}</span><span>{{ i.text }}</span>
        </li>
      </ul>
    </section>

    <div class="lab-grid2">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">
              Headline numbers
            </h2>
            <p class="panel-sub">
              One offseason on this league, {{ script.kpis.runs }} seeds.
            </p>
          </div>
        </div>
        <div class="table-scroll">
          <table
            class="de-table lab-table"
            data-test="kpis"
          >
            <thead>
              <tr>
                <th class="no-sort">
                  KPI
                </th>
                <th
                  v-if="base"
                  class="no-sort"
                >
                  {{ base.id }}
                </th>
                <th class="no-sort">
                  {{ script.id }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in KPI_ROWS"
                :key="row.label"
              >
                <td class="cell-name">
                  {{ row.label }}
                </td>
                <td
                  v-if="base"
                  class="cell-mono"
                >
                  {{ row.fmt(base.kpis) }}
                </td>
                <td class="cell-mono">
                  {{ row.fmt(script.kpis) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">
              Mean ΔOVR by age band
            </h2>
            <p class="panel-sub">
              One offseason, real export stats.
            </p>
          </div>
        </div>
        <LabChart
          kind="bar"
          :labels="[...AGE_BANDS]"
          :series="ageSeries"
          y-title="Mean ΔOVR"
          x-title="Age"
          :digits="2"
          signed
          chart-label="Mean OVR change by age band"
        />
      </section>
    </div>

    <div class="lab-grid2">
      <section
        v-for="block in [{ title: 'Biggest risers', list: risers }, { title: 'Biggest fallers', list: fallers }]"
        :key="block.title"
        class="panel"
      >
        <h2 class="panel-title">
          {{ block.title }}
        </h2>
        <div class="table-scroll">
          <table class="de-table lab-table">
            <thead>
              <tr>
                <th class="no-sort">
                  Player
                </th>
                <th class="no-sort">
                  Age
                </th>
                <th class="no-sort">
                  PER
                </th>
                <th class="no-sort">
                  Base
                </th>
                <th class="no-sort">
                  Mean Δ
                </th>
                <th class="no-sort">
                  p10 to p90
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in block.list"
                :key="p.pid"
              >
                <td class="cell-name">
                  {{ p.name }}
                </td>
                <td>{{ p.age }}</td>
                <td>{{ p.per === null ? "–" : p.per.toFixed(1) }}</td>
                <td>{{ p.baseOvr }}</td>
                <td class="cell-mono">
                  {{ sgn(p.meanDelta) }}
                </td>
                <td class="cell-mono">
                  {{ int(p.q10) }} to {{ int(p.q90) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
      <button
        type="button"
        class="btn"
        @click="copySummary"
      >
        Copy summary for Discord
      </button>
      <button
        v-if="summary"
        type="button"
        class="btn ghost"
        @click="showMd = !showMd"
      >
        {{ showMd ? "Hide summary.md" : "Show summary.md" }}
      </button>
      <span
        class="hint"
        role="status"
      >{{ copied }}</span>
    </div>
    <pre
      v-if="showMd && summary"
      class="lab-pre"
    >{{ summary }}</pre>
  </div>
</template>
