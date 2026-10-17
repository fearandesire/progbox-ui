<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import LabSubnav from "../components/lab/LabSubnav.vue";
import "../components/lab/lab.css";
import {
  addLabScript,
  checkLabLeague,
  createLabRun,
  downloadLabLeagues,
  fetchLabEstimate,
  fetchLabLeagues,
  fetchLabScripts,
  labErrorMessage,
  uploadLabLeague,
} from "../lib/api";
import { DEFAULT_LEAGUE_ID, LAB_PRESETS, sizeText } from "../lib/labFormat";
import {
  MODES,
  ROLE_NAME,
  baselineDrafts,
  defaultBaseline,
  etaText,
  isMidSeason,
  modeInfo,
  releases,
  statsReadText,
  uploadedAt,
  uploadedText,
  uploads,
} from "../lib/labScripts";
import type { LabEstimate, LabLeague, LabMode, LabRunInput, LabScript, LabScriptAdded, LabValidation } from "../lib/labTypes";

const router = useRouter();
const route = useRoute();

const scripts = ref<LabScript[]>([]);
const leagues = ref<LabLeague[]>([]);
const loadError = ref<string | null>(null);

const script = ref("");
const baseline = ref<string>("");
const league = ref(DEFAULT_LEAGUE_ID);
const mode = ref<LabMode>("deep");
const seed = ref(69);
const unlocked = ref(false);
const unlockRuns = ref<number>(LAB_PRESETS.quick.runs);
const unlockSeasons = ref<number>(LAB_PRESETS.deep.seasons);
const unlockReplicates = ref<number>(LAB_PRESETS.deep.replicates);

const family = ref("net");
const dragOver = ref(false);
const adding = ref(false);
const added = ref<(LabScriptAdded & { filename: string }) | null>(null);
const addError = ref<string | null>(null);

const validation = ref<LabValidation | null>(null);
const validating = ref(false);
const leagueError = ref<string | null>(null);
const uploadingLeague = ref(false);
const downloading = ref(false);

const estimate = ref<LabEstimate | null>(null);
const estimating = ref(false);
const estimateError = ref<string | null>(null);

const submitting = ref(false);
const submitError = ref<string | null>(null);

/** Script to test lists uploads only; a script handed over by Run again or Run test stays pickable. */
const uploadList = computed(() => uploads(scripts.value));
const extraScript = computed(() =>
  script.value && !uploadList.value.some((s) => s.id === script.value) ? scripts.value.find((s) => s.id === script.value) ?? null : null,
);
const releaseList = computed(() => releases(scripts.value));
const draftList = computed(() => baselineDrafts(scripts.value));
const uploadLabel = (s: LabScript) => {
  const when = uploadedText(uploadedAt(s));
  return when === "–" ? s.id : `${s.id} · uploaded ${when}`;
};

const info = computed(() => modeInfo(mode.value, validation.value?.season ?? null));
const cards = computed(() => MODES.map((m) => modeInfo(m, validation.value?.season ?? null)));
const midSeason = computed(() => mode.value === "quick" && isMidSeason(validation.value));
const runsPerScript = computed(() =>
  mode.value === "quick"
    ? (unlocked.value ? unlockRuns.value : LAB_PRESETS.quick.runs)
    : unlocked.value
      ? unlockReplicates.value
      : LAB_PRESETS[mode.value].replicates,
);
const preview = computed<[string, string][]>(() => [
  ["Script", script.value || "–"],
  ["Compare to", baseline.value || "None"],
  ["League", selectedLeague.value?.name ?? "–"],
  ["NET runs", unlocked.value && mode.value === "deep" ? `Every offseason, ${unlockSeasons.value} seasons` : info.value.netRuns],
  ["Games", info.value.games],
  ["Stats NET reads", statsReadText(mode.value, validation.value, unlocked.value ? unlockSeasons.value : LAB_PRESETS.deep.seasons)],
  ["Runs", `${runsPerScript.value.toLocaleString("en-US")} per script`],
]);

const selectedLeague = computed(() => leagues.value.find((l) => l.id === league.value) ?? null);
const leagueErrors = computed(() => validation.value?.issues.filter((i) => i.level === "error") ?? []);
const leagueNotes = computed(() => validation.value?.issues.filter((i) => i.level !== "error") ?? []);

const unlock = computed(() =>
  unlocked.value
    ? {
        runs: unlockRuns.value,
        ...(mode.value === "deep" ? { seasons: unlockSeasons.value, replicates: unlockReplicates.value } : {}),
        ...(mode.value === "season" ? { replicates: unlockReplicates.value } : {}),
      }
    : undefined,
);

const runInput = computed<LabRunInput | null>(() => {
  if (!script.value) return null;
  return {
    mode: mode.value,
    script: script.value,
    baseline: baseline.value || null,
    league: league.value,
    seed: seed.value,
    unlock: unlock.value,
  };
});

const blockers = computed(() => {
  const out: string[] = [];
  if (!script.value) out.push("Drop a script to test, or pick one of your uploads.");
  if (selectedLeague.value && !selectedLeague.value.available) out.push("This league isn't downloaded on the server yet.");
  if (leagueErrors.value.length) out.push("The league has errors that block a run.");
  if (validating.value) out.push("Checking the league…");
  if (unlocked.value && [unlockRuns.value, unlockSeasons.value, unlockReplicates.value].some((n) => !Number.isInteger(n) || n < 1)) {
    out.push("Unlocked sizes must be whole numbers of at least 1.");
  }
  return out;
});
const canRun = computed(() => !blockers.value.length && !submitting.value && !!validation.value?.ok);

async function loadCatalog() {
  try {
    const [s, l] = await Promise.all([fetchLabScripts(), fetchLabLeagues()]);
    scripts.value = s;
    leagues.value = l;
    applyQuery();
    if (baselineFromQuery === null) baseline.value = defaultBaseline(s);
    if (!script.value) script.value = uploads(s)[0]?.id ?? "";
    if (!l.some((x) => x.id === league.value)) league.value = l.find((x) => x.isDefault)?.id ?? l[0]?.id ?? "";
  } catch (e) {
    loadError.value = labErrorMessage(e, "Could not reach the NET Lab API");
  }
}
/** Run test (Scripts) and Run again (History, report) hand settings over in the query. */
let baselineFromQuery: string | null = null;
function applyQuery() {
  const q = route.query;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const s = str(q.script);
  if (s) script.value = s;
  const b = str(q.baseline);
  if (b) baselineFromQuery = baseline.value = b === "none" ? "" : b;
  const l = str(q.league);
  if (l) league.value = l;
  const m = str(q.mode);
  if (m === "deep" || m === "season" || m === "quick") mode.value = m;
}
onMounted(loadCatalog);

async function addFile(file: File) {
  addError.value = null;
  added.value = null;
  adding.value = true;
  try {
    const source = await file.text();
    const res = await addLabScript({ source, filename: file.name, family: family.value.trim() || "net" });
    added.value = { ...res, filename: file.name };
    scripts.value = await fetchLabScripts();
    script.value = res.entry.id;
  } catch (e) {
    addError.value = labErrorMessage(e, "Could not add the script");
  } finally {
    adding.value = false;
  }
}

function onScriptInput(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void addFile(f);
  (e.target as HTMLInputElement).value = "";
}
function onDrop(e: DragEvent) {
  dragOver.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) void addFile(f);
}

let checkSeq = 0;
async function checkLeague() {
  const id = league.value;
  const seq = ++checkSeq;
  validation.value = null;
  leagueError.value = null;
  // Wait for the catalog so the check runs once, against a league we know is on the server.
  if (!id || !selectedLeague.value?.available) return;
  validating.value = true;
  try {
    const v = await checkLabLeague(id);
    if (seq === checkSeq) validation.value = v;
  } catch (e) {
    if (seq === checkSeq) leagueError.value = labErrorMessage(e, "Could not check the league");
  } finally {
    if (seq === checkSeq) validating.value = false;
  }
}
watch([league, () => selectedLeague.value?.available], () => void checkLeague(), { immediate: true });

async function onLeagueUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = "";
  if (!f) return;
  uploadingLeague.value = true;
  leagueError.value = null;
  try {
    const res = await uploadLabLeague(f, f.name);
    leagues.value = await fetchLabLeagues();
    league.value = res.league.id;
  } catch (err) {
    leagueError.value = labErrorMessage(err, "Upload failed");
  } finally {
    uploadingLeague.value = false;
  }
}

async function downloadLeagues() {
  downloading.value = true;
  leagueError.value = null;
  try {
    leagues.value = await downloadLabLeagues();
  } catch (e) {
    leagueError.value = labErrorMessage(e, "Download failed");
  } finally {
    downloading.value = false;
  }
}

// Measured estimate from the CLI; debounced because it can probe on first use.
let estTimer: ReturnType<typeof setTimeout> | null = null;
let estSeq = 0;
watch(
  () => (runInput.value && validation.value?.ok ? JSON.stringify({ ...runInput.value, seed: undefined }) : null),
  (key) => {
    if (estTimer) clearTimeout(estTimer);
    estimate.value = null;
    estimateError.value = null;
    if (!key || !runInput.value) return;
    const input = runInput.value;
    estTimer = setTimeout(async () => {
      const seq = ++estSeq;
      estimating.value = true;
      try {
        const e = await fetchLabEstimate(input);
        if (seq === estSeq) estimate.value = e;
      } catch (err) {
        if (seq === estSeq) estimateError.value = labErrorMessage(err, "Estimate unavailable");
      } finally {
        if (seq === estSeq) estimating.value = false;
      }
    }, 400);
  },
  { immediate: true },
);
onUnmounted(() => {
  if (estTimer) clearTimeout(estTimer);
});

async function submit() {
  if (!runInput.value || !canRun.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const res = await createLabRun(runInput.value);
    void router.push(`/lab/runs/${res.runId ?? res.queueId}`);
  } catch (e) {
    submitError.value = labErrorMessage(e, "Could not start the run");
  } finally {
    submitting.value = false;
  }
}

const etaTitle = computed(() => estimate.value?.basis.join("\n") ?? "");
</script>

<template>
  <div class="page">
    <LabSubnav current="new" />

    <div class="section-head lab-head">
      <div>
        <h1 class="page-title">
          Test a NET script
        </h1>
        <p class="page-desc">
          Pick a script, a league and how NET runs. The preview on the right is saved with the run.
        </p>
      </div>
    </div>

    <p
      v-if="loadError"
      role="alert"
      class="lab-error"
      style="margin-bottom: 12px"
    >
      {{ loadError }}
    </p>

    <form
      class="lab-newgrid"
      @submit.prevent="submit"
    >
      <div class="form-card lab-form">
        <!-- Script -->
        <div class="field">
          <label for="lab-script">Script to test</label>
          <label
            class="lab-drop"
            :class="{ over: dragOver }"
            data-test="drop"
            @dragenter.prevent="dragOver = true"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
          >
            <input
              id="lab-script-file"
              type="file"
              accept=".js,.mjs,.txt"
              aria-label="Upload a script"
              @change="onScriptInput"
            >
            <span v-if="adding">Saving…</span>
            <span v-else><b>Drop a .js file</b> or click to choose</span>
            <span class="lab-meta">It gets a version id like net@4.4.0-draft.4. A taken version is bumped, never overwritten.</span>
          </label>
          <select
            id="lab-script"
            v-model="script"
            class="input mono"
          >
            <option
              v-if="!uploadList.length && !extraScript"
              value=""
              disabled
            >
              No uploads yet. Drop a script above.
            </option>
            <option
              v-else
              value=""
              disabled
            >
              Pick one of your uploads
            </option>
            <option
              v-for="s in uploadList"
              :key="s.id"
              :value="s.id"
            >
              {{ uploadLabel(s) }}
            </option>
            <option
              v-if="extraScript"
              :value="extraScript.id"
            >
              {{ extraScript.id }} · {{ ROLE_NAME[extraScript.role] }}
            </option>
          </select>
          <div
            v-if="added"
            class="lab-assigned"
            data-test="assigned"
            role="status"
          >
            <span>{{ added.filename }} is saved as</span>
            <span class="lab-id">{{ added.entry.id }}</span>
            <span
              v-if="!added.created"
              class="hint"
            >Identical code was already saved, so the existing id {{ added.entry.id }} is reused.</span>
            <span
              v-for="n in added.notes.filter((x) => !x.startsWith('Saved as') && !x.startsWith('Same code'))"
              :key="n"
              class="hint"
            >{{ n }}</span>
          </div>
          <p
            v-if="addError"
            role="alert"
            class="lab-error"
          >
            {{ addError }}
          </p>
        </div>

        <div class="lab-row2">
          <!-- Baseline -->
          <div class="field">
            <label for="lab-baseline">Compare against</label>
            <select
              id="lab-baseline"
              v-model="baseline"
              class="input mono"
            >
              <optgroup
                v-if="releaseList.length"
                label="Releases"
              >
                <option
                  v-for="s in releaseList"
                  :key="s.id"
                  :value="s.id"
                >
                  {{ s.id }} · {{ ROLE_NAME[s.role] }}
                </option>
              </optgroup>
              <optgroup
                v-if="draftList.length"
                label="Your drafts"
              >
                <option
                  v-for="s in draftList"
                  :key="s.id"
                  :value="s.id"
                >
                  {{ s.id }}
                </option>
              </optgroup>
              <option value="">
                None
              </option>
            </select>
            <span class="hint">Defaults to the newest release. Releases are only offered here.</span>
          </div>

          <!-- League -->
          <div class="field">
            <label for="lab-league">League</label>
            <select
              id="lab-league"
              v-model="league"
              class="input"
            >
              <option
                v-for="l in leagues"
                :key="l.id"
                :value="l.id"
              >
                {{ l.name }}{{ l.available ? "" : " · not downloaded" }}
              </option>
            </select>
            <span
              v-if="selectedLeague?.credit"
              class="lab-credit"
              data-test="credit"
            >{{ selectedLeague.credit }}</span>
          </div>
        </div>

        <div
          v-if="selectedLeague && !selectedLeague.available"
          class="lab-inline-row"
        >
          <span class="hint">This league isn't on the server yet.</span>
          <button
            type="button"
            class="btn ghost"
            :disabled="downloading"
            @click="downloadLeagues"
          >
            <DeIcon name="download" />
            {{ downloading ? "Downloading…" : "Download built-in leagues" }}
          </button>
        </div>
        <ul
          v-if="validation"
          class="lab-issues"
          data-test="league-issues"
        >
          <li
            v-if="validation.ok"
            class="ok"
          >
            <span class="tag">ok</span>
            <span>Season {{ validation.season }}, phase {{ validation.phase }}. Ready to run.</span>
          </li>
          <li
            v-for="i in leagueErrors"
            :key="i.code"
            class="error"
          >
            <span class="tag">error</span><span>{{ i.text }}</span>
          </li>
          <li
            v-for="i in leagueNotes"
            :key="i.code"
            :class="i.level"
          >
            <span class="tag">{{ i.level }}</span><span>{{ i.text }}</span>
          </li>
        </ul>
        <p
          v-else-if="validating"
          class="hint"
          style="margin: 0"
        >
          Checking the league…
        </p>
        <p
          v-if="leagueError"
          role="alert"
          class="lab-error"
        >
          {{ leagueError }}
        </p>

        <!-- When NET runs -->
        <div class="field">
          <label id="lab-mode-label">When NET runs</label>
          <div
            class="lab-modes"
            role="radiogroup"
            aria-labelledby="lab-mode-label"
          >
            <button
              v-for="c in cards"
              :key="c.mode"
              type="button"
              role="radio"
              class="lab-mode"
              :class="{ on: mode === c.mode }"
              :aria-checked="mode === c.mode"
              :data-mode="c.mode"
              @click="mode = c.mode"
            >
              <span class="lab-mode__top"><b>{{ c.title }}</b><span class="lab-mode__tag">{{ c.tag }}</span></span>
              <span class="lab-mode__line">{{ c.line }}</span>
            </button>
          </div>
          <p
            class="lab-tip"
            data-test="mode-tip"
          >
            {{ info.tip }}
          </p>
        </div>

        <!-- Advanced -->
        <details class="lab-advanced">
          <summary>Advanced</summary>
          <div class="lab-advanced__body">
            <div class="field-row">
              <div class="field">
                <label for="lab-family">Family for uploads</label>
                <input
                  id="lab-family"
                  v-model="family"
                  class="input mono"
                  type="text"
                  maxlength="40"
                  placeholder="net"
                >
              </div>
              <div class="field">
                <label for="lab-seed">Seed</label>
                <input
                  id="lab-seed"
                  v-model.number="seed"
                  class="input mono"
                  type="number"
                  min="0"
                >
              </div>
            </div>
            <label class="lab-inline">
              <input
                v-model="unlocked"
                type="checkbox"
                data-test="unlock"
              >
              Unlock run sizes
            </label>
            <span
              v-if="!unlocked"
              class="hint"
              data-test="locked-sizes"
            >Locked: {{ sizeText(mode) }}</span>
            <div
              v-if="unlocked"
              class="field-row"
            >
              <div class="field">
                <label for="lab-runs">Offseasons</label>
                <input
                  id="lab-runs"
                  v-model.number="unlockRuns"
                  class="input mono"
                  type="number"
                  min="1"
                >
              </div>
              <div
                v-if="mode !== 'quick'"
                class="field"
              >
                <label for="lab-replicates">Replicates</label>
                <input
                  id="lab-replicates"
                  v-model.number="unlockReplicates"
                  class="input mono"
                  type="number"
                  min="1"
                >
              </div>
              <div
                v-if="mode === 'deep'"
                class="field"
              >
                <label for="lab-seasons">Seasons</label>
                <input
                  id="lab-seasons"
                  v-model.number="unlockSeasons"
                  class="input mono"
                  type="number"
                  min="1"
                  max="50"
                >
              </div>
            </div>
            <span
              v-if="unlocked"
              class="hint"
            >Locked sizes keep results comparable. Unlocked runs say so in their manifest.</span>
            <label class="lab-inline">
              <span>{{ uploadingLeague ? "Uploading and checking…" : "Upload a BBGM league export:" }}</span>
              <input
                type="file"
                accept=".json,application/json"
                data-test="league-upload"
                :disabled="uploadingLeague"
                @change="onLeagueUpload"
              >
            </label>
          </div>
        </details>
      </div>

      <aside
        class="panel lab-preview"
        aria-label="Run preview"
      >
        <span class="lab-lbl">Run preview</span>
        <dl
          class="lab-kv"
          data-test="preview"
        >
          <template
            v-for="[k, v] in preview"
            :key="k"
          >
            <dt>{{ k }}</dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
        <p
          v-if="midSeason"
          class="lab-warnline"
          data-test="mid-season"
        >
          This file is mid-season. NET will read partial-season stats.
        </p>
        <button
          type="submit"
          class="btn primary lg lab-press"
          data-test="run"
          :disabled="!canRun"
          :title="blockers.join(' ')"
        >
          <DeIcon name="play" />
          {{ submitting ? "Starting…" : "Run test" }}
        </button>
        <span
          v-if="estimate"
          class="lab-meta lab-eta"
          data-test="estimate"
          :title="etaTitle"
        >{{ etaText(estimate.seconds) }}</span>
        <span
          v-else-if="estimating"
          class="lab-meta"
        >Estimating…</span>
        <span
          v-else-if="estimateError"
          class="lab-meta"
        >{{ estimateError }}</span>
        <p
          v-if="submitError"
          role="alert"
          class="lab-error"
        >
          {{ submitError }}
        </p>
        <p
          v-else-if="blockers.length && !validating"
          class="lab-meta"
          style="margin: 0"
        >
          {{ blockers[0] }}
        </p>
      </aside>
    </form>
  </div>
</template>
