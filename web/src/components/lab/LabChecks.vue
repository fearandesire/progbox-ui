<script setup lang="ts">
/* Verdict panel and Balance checks table for reports from NET Lab 0.3.0 on. */
import { computed, nextTick, ref } from "vue";
import {
  DIRECTION_LABEL,
  changeText,
  checkAnchor,
  filterCounts,
  fmtPct,
  moveGroups,
  passState,
  shortId,
  showCheck,
  verdictText,
  type CheckFilter,
} from "../../lib/labChecks";
import type { LabCheckItem, LabCheckValue, LabChecks } from "../../lib/labTypes";
import DeIcon from "../DeIcon.vue";

const props = defineProps<{ checks: LabChecks; scriptId: string; baselineId: string | null }>();

const filter = ref<CheckFilter>("all");
const hit = ref<string | null>(null);

const hasBase = computed(() => !!props.checks.baseline && !!props.baselineId);
const baseShort = computed(() => (props.baselineId ? shortId(props.baselineId) : ""));
const verdict = computed(() => verdictText(props.checks, props.scriptId, hasBase.value ? props.baselineId : null));
const groups = computed(() => (hasBase.value ? moveGroups(props.checks) : []));
const counts = computed(() => filterCounts(props.checks));
const rows = computed(() => props.checks.items.filter((c) => showCheck(c, filter.value)));
const hasNoScript = computed(() => props.checks.items.some((c) => c.noScript));
const icon = computed(() => (verdict.value.tone === "good" ? "check-circle" : verdict.value.tone === "bad" ? "x-circle" : "minus-circle"));

const strips = computed(() => {
  const out: { name: string; side: "script" | "baseline"; score: { passed: number; applicable: number } }[] = [
    { name: props.scriptId, side: "script", score: props.checks.script },
  ];
  if (hasBase.value && props.checks.baseline) out.push({ name: props.baselineId!, side: "baseline", score: props.checks.baseline });
  return out;
});
const sideValue = (c: LabCheckItem, side: "script" | "baseline") => (side === "script" ? c.script : c.baseline);
const stateWord = (s: string) => (s === "pass" ? "passes" : s === "fail" ? "fails" : "not applicable");

const filters = computed(() => {
  const out: { id: CheckFilter; label: string }[] = [
    { id: "all", label: `All ${counts.value.all}` },
    { id: "fail", label: `${props.scriptId} fails ${counts.value.fail}` },
  ];
  if (hasBase.value) out.push({ id: "diff", label: `Differ from ${baseShort.value} ${counts.value.diff}` });
  return out;
});

/** Jump to a check row: clear a filter that hides it, scroll, and highlight it. */
async function jump(e: Event, c: LabCheckItem) {
  e.preventDefault();
  if (!showCheck(c, filter.value)) filter.value = "all";
  hit.value = c.id;
  await nextTick();
  document.getElementById(checkAnchor(c.id))?.scrollIntoView({ block: "center" });
}

function cellState(v: LabCheckValue | null): string {
  return passState(v);
}
</script>

<template>
  <section
    id="r-verdict"
    class="panel lab-verdict lab-section"
    data-test="verdict"
  >
    <div class="lab-vtop">
      <div>
        <h2
          class="lab-vtitle"
          :class="verdict.tone"
          data-test="verdict-title"
        >
          <DeIcon
            :name="icon"
            :size="20"
          />{{ verdict.title }}
        </h2>
        <p class="lab-meta lab-vline">
          {{ verdict.line }}
        </p>
      </div>
      <div
        class="lab-score"
        aria-label="Checks passed"
      >
        <div
          v-for="st in strips"
          :key="st.side"
          class="lab-srow"
          :data-test="`strip-${st.side}`"
        >
          <span
            class="lab-sname"
            :title="st.name"
          >{{ st.name }}</span>
          <span class="lab-dots">
            <a
              v-for="c in checks.items"
              :key="c.id"
              :href="`#${checkAnchor(c.id)}`"
              :class="cellState(sideValue(c, st.side))"
              :title="`${c.name}: ${stateWord(cellState(sideValue(c, st.side)))}`"
              :aria-label="`${c.name}: ${stateWord(cellState(sideValue(c, st.side)))}`"
              @click="jump($event, c)"
            />
          </span>
          <b class="lab-snum">{{ st.score.passed }}/{{ st.score.applicable }}</b>
        </div>
      </div>
    </div>
    <dl
      v-if="groups.length"
      class="lab-moves"
      data-test="moves"
    >
      <template
        v-for="g in groups"
        :key="g.direction"
      >
        <dt><span :class="['lab-cmp', g.direction]">{{ DIRECTION_LABEL[g.direction] }}</span> {{ g.items.length }}</dt>
        <dd>
          <span
            v-for="c in g.items"
            :key="c.id"
          >
            <a
              :href="`#${checkAnchor(c.id)}`"
              @click="jump($event, c)"
            >{{ c.name }}</a>
            <span
              v-if="g.direction === 'better' && c.script.pass === false"
              class="lab-meta"
            > still fails</span>
          </span>
        </dd>
      </template>
    </dl>
  </section>

  <section
    id="r-checks"
    class="panel table-panel lab-section"
  >
    <div class="table-toolbar">
      <h2 class="panel-title">
        Balance checks
      </h2>
      <div
        class="lab-segs"
        role="group"
        aria-label="Show checks"
        style="margin-left: auto"
      >
        <button
          v-for="f in filters"
          :key="f.id"
          type="button"
          :aria-pressed="filter === f.id"
          :data-filter="f.id"
          @click="filter = f.id"
        >
          {{ f.label }}
        </button>
      </div>
    </div>
    <div class="table-scroll">
      <table
        class="lab-checks"
        data-test="checks"
      >
        <thead>
          <tr>
            <th>Check</th>
            <th class="num">
              {{ scriptId }}
            </th>
            <th
              v-if="hasBase"
              class="num"
            >
              {{ baselineId }}
            </th>
            <th
              v-if="hasNoScript"
              class="num"
            >
              No script
            </th>
            <th v-if="hasBase">
              Change vs {{ baseShort }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length">
            <td
              colspan="5"
              class="lab-empty-row"
            >
              No checks match this filter.
            </td>
          </tr>
          <tr
            v-for="c in rows"
            :id="checkAnchor(c.id)"
            :key="c.id"
            :class="{ hit: hit === c.id }"
            :data-check="c.id"
          >
            <td :title="`Passes when: ${c.rule}`">
              {{ c.name }}
              <div class="lab-meta lab-unit">
                {{ c.unit }}. Passes: {{ c.rule }}.
              </div>
            </td>
            <td class="num">
              <template v-if="c.applicable">
                <span
                  class="lab-r"
                  :class="cellState(c.script)"
                >{{ c.script.display }}</span>
                <span
                  v-if="fmtPct(c.script.pctFromStart)"
                  class="lab-pct"
                >{{ fmtPct(c.script.pctFromStart) }}</span>
              </template>
              <span
                v-else
                class="lab-meta"
                title="Needs a 10-season run"
              >n/a</span>
            </td>
            <td
              v-if="hasBase"
              class="num"
            >
              <template v-if="c.applicable && c.baseline">
                <span
                  class="lab-r"
                  :class="cellState(c.baseline)"
                >{{ c.baseline.display }}</span>
                <span
                  v-if="fmtPct(c.baseline.pctFromStart)"
                  class="lab-pct"
                >{{ fmtPct(c.baseline.pctFromStart) }}</span>
              </template>
              <span
                v-else
                class="lab-meta"
              >n/a</span>
            </td>
            <td
              v-if="hasNoScript"
              class="num"
            >
              {{ c.noScript?.display ?? "–" }}
            </td>
            <td
              v-if="hasBase"
              class="lab-dv"
            >
              <span
                v-if="c.change"
                :class="['lab-cmp', c.change.direction]"
              >{{ changeText(c) }}</span>
              <span
                v-else
                class="lab-meta"
              >–</span>
              <small v-if="c.change?.note">{{ c.change.note }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="lab-meta lab-checks-note">
      Values are in the unit under each check; the small % under a value is its change from the start of the run.
      <template v-if="hasBase">
        Change vs {{ baseShort }} is the relative difference between the two scripts.
      </template>
      <template v-if="hasNoScript">
        "No script" is the same league with only the preseason development step, no NET.
      </template>
      Gaps under two standard errors count as a tie. The rules live in <code>lab/src/verdict.ts</code>.
    </p>
  </section>
</template>
