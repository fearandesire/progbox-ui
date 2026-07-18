<script lang="ts">
/* Exact copy for the paired-completion toast — shared by the template and the
   test so the two can't drift. */
export const PAIR_COMPLETE_TOAST =
  "Both runs saved to your dashboard. Opening the comparison results...";
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import SimProgressPanel from "../components/SimProgressPanel.vue";
import Toast from "../components/Toast.vue";
import { createSim } from "../lib/api";
import type { CreateSimInput, CreateSimResponse } from "../lib/api";
import { useSimProgress } from "../composables/useSimProgress";

type CreateState = "idle" | "uploading" | "running" | "failed";

const router = useRouter();

const exportFile = ref<File | null>(null);
const teaminfoFile = ref<File | null>(null);
const teamsCsv = ref("");
const seed = ref(69);
const runs = ref(500);
const nWorkers = ref<number | null>(null);
const version = ref<"v41" | "v43">("v43");
const compare = ref(true);

const state = ref<CreateState>("idle");
const error = ref<string | null>(null);
const activeBuild = ref<string | null>(null);
const compareBuild = ref<string | null>(null);
const paired = ref(false);
const finalizing = ref(false);
const showToast = ref(false);
const pairComparisonBlocked = ref<string | null>(null);
/** Pending compare-redirect timer — cleared on resubmit / unmount. */
let compareRedirectTimer: ReturnType<typeof setTimeout> | null = null;

function clearCompareRedirectTimer() {
  if (compareRedirectTimer !== null) {
    clearTimeout(compareRedirectTimer);
    compareRedirectTimer = null;
  }
}

onUnmounted(clearCompareRedirectTimer);

// Label the toggle with the OTHER version's v4.x display label.
const otherVersionLabel = computed(() => (version.value === "v43" ? "v4.1" : "v4.3"));

const primaryVersionLabel = computed(() => (version.value === "v43" ? "v4.3" : "v4.1"));

const pairComparisonBlockedMessage = computed(() =>
  pairComparisonBlocked.value
    ? `Comparison unavailable because the ${pairComparisonBlocked.value} run failed. You can still open either run from the links below.`
    : null,
);

const teaminfoExample = `{
  "0": "BOS",
  "1": "NYK",
  "-1": "FA",
  "-2": "UDFA",
  "-3": "Retired"
}`;

const showTeaminfoDetails = ref(false);
const showAdvanced = ref(false);

const canSubmit = computed(
  () =>
    !!exportFile.value &&
    (state.value === "idle" ||
      state.value === "failed" ||
      // Paired failure keeps panels mounted (state stays "running"); still allow retry.
      !!pairComparisonBlocked.value),
);
/** Progress panels stay up while a run is in flight, or after a paired failure. */
const showProgress = computed(
  () =>
    !!activeBuild.value &&
    (state.value === "running" || !!pairComparisonBlocked.value),
);
const simProgress = useSimProgress(activeBuild);
const compareProgress = useSimProgress(compareBuild);

// Single run (compare off): land on that run's detail once it completes.
watch(
  () => [simProgress.done.value, simProgress.phase.value] as const,
  ([done, phase]) => {
    if (!done || !activeBuild.value || paired.value) return;
    if (phase === "complete") {
      state.value = "idle";
      void router.push(`/runs/${activeBuild.value}`);
      return;
    }
    if (phase === "failed") {
      state.value = "failed";
      error.value = simProgress.message.value ?? "Simulation failed";
    }
  },
);

// Paired run: record the first failed version so we suppress compare redirect.
watch(
  () => [simProgress.done.value, simProgress.phase.value] as const,
  ([done, phase]) => {
    if (!paired.value || !done || phase !== "failed") return;
    if (!pairComparisonBlocked.value) {
      pairComparisonBlocked.value = primaryVersionLabel.value;
    }
  },
);

watch(
  () => [compareProgress.done.value, compareProgress.phase.value] as const,
  ([done, phase]) => {
    if (!paired.value || !done || phase !== "failed") return;
    if (!pairComparisonBlocked.value) {
      pairComparisonBlocked.value = otherVersionLabel.value;
    }
  },
);

// Paired run: once BOTH complete, show the toast then open the comparison.
watch(
  () =>
    [
      simProgress.done.value,
      simProgress.phase.value,
      compareProgress.done.value,
      compareProgress.phase.value,
    ] as const,
  ([primaryDone, primaryPhase, baselineDone, baselinePhase]) => {
    if (!paired.value || finalizing.value || pairComparisonBlocked.value) return;
    if (!primaryDone || !baselineDone) return;
    if (primaryPhase !== "complete" || baselinePhase !== "complete") return;
    if (!activeBuild.value || !compareBuild.value) return;
    finalizing.value = true;
    state.value = "idle";
    showToast.value = true;
    const builds = `${activeBuild.value},${compareBuild.value}`;
    clearCompareRedirectTimer();
    compareRedirectTimer = setTimeout(() => {
      compareRedirectTimer = null;
      void router.push({ path: "/compare", query: { builds } });
    }, 1500);
  },
);

function parseTeams(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function onExportChange(event: Event) {
  const target = event.target as HTMLInputElement;
  exportFile.value = target.files?.[0] ?? null;
}

function onTeaminfoChange(event: Event) {
  const target = event.target as HTMLInputElement;
  teaminfoFile.value = target.files?.[0] ?? null;
}

function httpErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && "detail" in data) {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === "string" && detail.length > 0) return detail;
    }
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Failed to create simulation";
}

async function submit() {
  if (!exportFile.value) {
    error.value = "Please choose an export JSON file.";
    return;
  }
  error.value = null;
  state.value = "uploading";
  finalizing.value = false;
  showToast.value = false;
  compareBuild.value = null;
  paired.value = false;
  pairComparisonBlocked.value = null;
  clearCompareRedirectTimer();
  try {
    const response = (await createSim(
      exportFile.value,
      {
        teams: parseTeams(teamsCsv.value),
        seed: seed.value,
        runs: runs.value,
        n_workers: nWorkers.value,
        version: version.value,
        compare: compare.value,
      } as CreateSimInput,
      teaminfoFile.value,
    )) as CreateSimResponse & { compare_build?: string; pair_id?: string };
    activeBuild.value = response.build;
    if (compare.value && response.compare_build) {
      compareBuild.value = response.compare_build;
      paired.value = true;
    }
    state.value = "running";
  } catch (e: unknown) {
    error.value = httpErrorMessage(e);
    state.value = "failed";
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
      style="margin-bottom: 8px"
    >
      <div>
        <h1 class="page-title">
          New simulation
        </h1>
        <p class="page-desc">
          Upload a BBGM export and launch a new Progbox run.
        </p>
      </div>
    </div>

    <form
      class="form-card"
      @submit.prevent="submit"
    >
      <div class="field">
        <label for="export-file">Export JSON <span class="req">*</span></label>
        <input
          id="export-file"
          class="file"
          type="file"
          accept=".json,application/json"
          @change="onExportChange"
        >
        <span
          v-if="exportFile"
          class="hint"
        >{{ exportFile.name }}</span>
      </div>

      <div class="field">
        <label for="sim-version">Progression script</label>
        <select
          id="sim-version"
          v-model="version"
          class="input"
        >
          <option value="v43">
            v4.3 — adopted engine (recommended)
          </option>
          <option value="v41">
            v4.1 — legacy
          </option>
        </select>
        <span class="hint">v4.3 fixes league-wide OVR deflation and the age curve. Pick v4.1 only to compare.</span>
      </div>

      <div class="field">
        <label class="compare-toggle">
          <input
            v-model="compare"
            type="checkbox"
          >
          <span>Also run {{ otherVersionLabel }} and compare</span>
        </label>
        <span class="hint">
          Runs the simulation twice from one submission — your selected version and
          {{ otherVersionLabel }} — with identical inputs, then opens the head-to-head comparison.
        </span>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="sim-seed">Seed</label>
          <input
            id="sim-seed"
            v-model.number="seed"
            class="input mono"
            type="number"
          >
        </div>
        <div class="field">
          <label for="sim-runs">Runs</label>
          <input
            id="sim-runs"
            v-model.number="runs"
            class="input mono"
            type="number"
            min="1"
          >
        </div>
        <div class="field">
          <label for="sim-workers">Workers (blank = auto)</label>
          <input
            id="sim-workers"
            :value="nWorkers ?? ''"
            class="input mono"
            type="number"
            min="1"
            @input="nWorkers = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null"
          >
        </div>
      </div>

      <div style="border-top: 1px solid var(--line); padding-top: 16px">
        <button
          type="button"
          class="disclosure"
          :aria-expanded="showAdvanced"
          @click="showAdvanced = !showAdvanced"
        >
          <DeIcon
            name="chevron-right"
            :size="14"
          />
          Advanced options
        </button>
        <div
          v-show="showAdvanced"
          style="margin-top: 16px; display: grid; gap: 18px"
        >
          <div class="field">
            <label for="sim-teams">Teams (comma-separated)</label>
            <input
              id="sim-teams"
              v-model="teamsCsv"
              class="input"
              type="text"
              placeholder="GSW, BOS"
            >
            <span class="hint">Filter the simulation to specific team abbreviations only.</span>
          </div>

          <div class="field">
            <label for="sim-teaminfo">Teaminfo override</label>
            <div class="callout-warn">
              <DeIcon
                name="alert"
                :size="18"
              />
              <div>
                <p class="callout-warn__title">
                  Warning
                </p>
                <p class="callout-warn__body">
                  Teaminfo is <strong>auto-generated</strong> from your export.
                  Only override this if you need custom team abbreviations
                  (renamed teams, custom league, etc.). An incorrect override
                  can break the simulation.
                </p>
              </div>
            </div>
            <input
              id="sim-teaminfo"
              class="file"
              style="margin-top: 10px"
              type="file"
              accept=".json,application/json"
              @change="onTeaminfoChange"
            >
            <p
              v-if="teaminfoFile"
              class="hint"
            >
              Override selected:
              <span style="font-family: var(--mono)">{{ teaminfoFile.name }}</span>
            </p>
            <div style="margin-top: 8px">
              <button
                type="button"
                class="disclosure"
                style="font-size: 12px"
                :aria-expanded="showTeaminfoDetails"
                @click="showTeaminfoDetails = !showTeaminfoDetails"
              >
                <DeIcon
                  name="chevron-right"
                  :size="12"
                />
                {{ showTeaminfoDetails ? 'Hide format details' : 'Show format details' }}
              </button>
              <div
                v-show="showTeaminfoDetails"
                style="margin-top: 8px; display: grid; gap: 8px; font-size: 12.5px; color: var(--fg-mute); line-height: 1.5"
              >
                <p style="margin: 0">
                  By default, <span style="font-family: var(--mono)">teaminfo.json</span>
                  is <strong>auto-generated</strong> from the active teams in your
                  export (team ID → abbreviation, plus the
                  <span style="font-family: var(--mono)">-1 FA</span> /
                  <span style="font-family: var(--mono)">-2 UDFA</span> /
                  <span style="font-family: var(--mono)">-3 Retired</span> slots).
                </p>
                <p style="margin: 0">
                  Only upload a file here to override team abbreviations — for
                  example a custom league or a different era with renamed teams.
                  Expected format:
                </p>
                <pre class="code-block">{{ teaminfoExample }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p
        v-if="error"
        role="alert"
        style="color: var(--rd-600); font-size: 13px; margin: 0"
      >
        {{ error }}
      </p>

      <div style="display: flex; gap: 8px">
        <button
          type="submit"
          class="btn primary lg"
          :disabled="!canSubmit"
        >
          <DeIcon name="plus" />
          {{ state === "uploading" ? "Starting…" : "Start simulation" }}
        </button>
        <button
          type="button"
          class="btn ghost"
          @click="router.push('/')"
        >
          Cancel
        </button>
      </div>
    </form>

    <div
      v-if="showProgress && activeBuild"
      style="margin-top: 20px; display: grid; gap: 18px"
    >
      <p
        v-if="pairComparisonBlockedMessage"
        role="alert"
        style="color: var(--rd-600); font-size: 13px; margin: 0"
      >
        {{ pairComparisonBlockedMessage }}
      </p>
      <div>
        <p
          style="font-family: var(--mono); font-size: 11.5px; color: var(--fg-mute); letter-spacing: 0.04em; margin: 0 0 10px"
        >
          run started ·
          <RouterLink
            :to="`/runs/${activeBuild}`"
            style="color: var(--accent-text)"
          >
            {{ activeBuild }}
          </RouterLink>
        </p>
        <SimProgressPanel :build="activeBuild" />
      </div>
      <div v-if="paired && compareBuild">
        <p
          style="font-family: var(--mono); font-size: 11.5px; color: var(--fg-mute); letter-spacing: 0.04em; margin: 0 0 10px"
        >
          paired run ({{ otherVersionLabel }}) ·
          <RouterLink
            :to="`/runs/${compareBuild}`"
            style="color: var(--accent-text)"
          >
            {{ compareBuild }}
          </RouterLink>
        </p>
        <SimProgressPanel :build="compareBuild" />
      </div>
    </div>

    <Toast
      :show="showToast"
      :message="PAIR_COMPLETE_TOAST"
      @close="showToast = false"
    />
  </div>
</template>

<style scoped>
.compare-toggle {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  font-weight: 500;
}
.compare-toggle input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent, #10b981);
  cursor: pointer;
}
</style>
