<script setup lang="ts">
import type { ParsedScorecard } from "../../lib/analysisTypes";

const props = defineProps<{
  scorecard: ParsedScorecard;
}>();

// Display formatting ported from the generated scorecard table's fmt()
// (vendor/progbox_cpp/tools/analysis.py cmp_scorecard).
function fmt(metric: string, val: number | null): string {
  if (val === null || Number.isNaN(val)) return "-";
  if (metric === "Players" || metric === "Runs") {
    return Math.trunc(val).toLocaleString("en-US");
  }
  if (metric === "%>cap") return `${(val * 100).toFixed(2)}%`;
  if (
    metric === "Drift" ||
    metric === "PrimeSep" ||
    metric === "PrimeSep(OVRadj)" ||
    metric === "DeclineSlope"
  ) {
    return `${val >= 0 ? "+" : ""}${val.toFixed(3)}`;
  }
  return val.toFixed(2);
}

function scriptColor(i: number): string {
  return props.scorecard.colors[i] ?? "#475569";
}
</script>

<template>
  <div class="scorecard">
    <table class="scorecard__table">
      <thead>
        <tr>
          <th class="scorecard__metric-head">
            Metric
          </th>
          <th
            v-for="(script, i) in scorecard.scripts"
            :key="script"
            class="scorecard__script-head"
          >
            <span
              class="scorecard__chip"
              :style="{ background: scriptColor(i) }"
              aria-hidden="true"
            />
            {{ script }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="metric in scorecard.metrics"
          :key="metric.name"
        >
          <td class="scorecard__metric">
            {{ metric.name }}
          </td>
          <td
            v-for="(val, i) in metric.values"
            :key="i"
            class="scorecard__value"
          >
            {{ fmt(metric.name, val) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scorecard {
  overflow-x: auto;
}
.scorecard__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.scorecard__table th,
.scorecard__table td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}
.scorecard__metric-head,
.scorecard__script-head {
  font-size: var(--t-label, 11.5px);
  text-transform: uppercase;
  letter-spacing: var(--tr-label, 0.06em);
  color: var(--fg-mute);
  font-weight: 600;
  white-space: nowrap;
}
.scorecard__script-head {
  white-space: normal;
  min-width: 160px;
}
.scorecard__chip {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 6px;
  vertical-align: baseline;
}
.scorecard__metric {
  color: var(--fg-soft);
  font-weight: 500;
  white-space: nowrap;
}
.scorecard__value {
  font-family: var(--mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}
tbody tr:hover td {
  background: var(--surface-2);
}
</style>
