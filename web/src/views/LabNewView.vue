<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import InfoTip from "../components/InfoTip.vue";
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
import { DEFAULT_LEAGUE_ID, LAB_PRESETS, secondsText, sizeText } from "../lib/labFormat";
import type { LabEstimate, LabLeague, LabMode, LabRunInput, LabScript, LabScriptAdded, LabValidation } from "../lib/labTypes";

const router = useRouter();

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

/** Hook scripts (the pre-progs hook family) aren't progression scripts to test. */
const progScripts = computed(() => scripts.value.filter((s) => !s.id.startsWith("hook@")));
const roleLabel = (r: string) => (r === "published" ? "Published" : r === "candidate" ? "Candidate" : "Draft");

const selectedLeague = computed(() => leagues.value.find((l) => l.id === league.value) ?? null);
const leagueErrors = computed(() => validation.value?.issues.filter((i) => i.level === "error") ?? []);
const leagueNotes = computed(() => validation.value?.issues.filter((i) => i.level !== "error") ?? []);

const unlock = computed(() =>
  unlocked.value
    ? {
        runs: unlockRuns.value,
        ...(mode.value === "deep" ? { seasons: unlockSeasons.value, replicates: unlockReplicates.value } : {}),
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
  if (!script.value) out.push("Drop a script or pick one from the registry.");
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
    if (!baseline.value) baseline.value = s.find((x) => x.role === "published" && x.id.startsWith("net@"))?.id ?? "";
    if (!script.value) script.value = s.find((x) => x.role === "candidate")?.id ?? "";
    if (!l.some((x) => x.id === league.value)) league.value = l.find((x) => x.isDefault)?.id ?? l[0]?.id ?? "";
  } catch (e) {
    loadError.value = labErrorMessage(e, "Could not reach the NET Lab API");
  }
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
</script>

<template>
  <div class="page">
    <nav
      class="lab-subnav"
      aria-label="Lab"
    >
      <RouterLink
        to="/lab"
        class="chip active"
      >
        New test
      </RouterLink>
      <RouterLink
        to="/lab/history"
        class="chip"
      >
        History
      </RouterLink>
    </nav>

    <div
      class="section-head"
      style="margin-bottom: 8px"
    >
      <div>
        <h1 class="page-title">
          Test a NET script
        </h1>
        <p class="page-desc">
          NET Lab runs your progression script, unchanged, against a league and reports what it does.
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
      class="form-card"
      @submit.prevent="submit"
    >
      <!-- Script -->
      <div class="field">
        <label for="lab-script-file">Script</label>
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
            @change="onScriptInput"
          >
          <span v-if="adding">Registering…</span>
          <span v-else><b>Drop a .js file</b> or click to choose</span>
          <span style="font-size: 12px">Every script gets a family name and an immutable version id.</span>
        </label>
        <div class="lab-row2">
          <div class="field">
            <label for="lab-family">Family name</label>
            <input
              id="lab-family"
              v-model="family"
              class="input mono"
              type="text"
              maxlength="40"
              placeholder="net"
            >
            <span class="hint">Versions are numbered within a family, e.g. net@4.4.0-draft.1.</span>
          </div>
          <div class="field">
            <label for="lab-script">Script to test</label>
            <select
              id="lab-script"
              v-model="script"
              class="input mono"
            >
              <option
                value=""
                disabled
              >
                Pick a registered script
              </option>
              <option
                v-for="s in progScripts"
                :key="s.id"
                :value="s.id"
              >
                {{ s.id }} · {{ roleLabel(s.role) }}
              </option>
            </select>
          </div>
        </div>
        <div
          v-if="added"
          class="lab-assigned"
          data-test="assigned"
          role="status"
        >
          <span>{{ added.filename }} is registered as</span>
          <span class="lab-id">{{ added.entry.id }}</span>
          <span
            v-if="!added.created"
            class="hint"
          >Identical code was already registered, so the existing id {{ added.entry.id }} is reused.</span>
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

      <!-- Baseline -->
      <div class="field">
        <label for="lab-baseline">Compare against</label>
        <select
          id="lab-baseline"
          v-model="baseline"
          class="input mono"
        >
          <option value="">
            None
          </option>
          <option
            v-for="s in progScripts"
            :key="s.id"
            :value="s.id"
          >
            {{ s.id }} · {{ roleLabel(s.role) }}
          </option>
        </select>
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
            {{ l.name }}{{ l.isDefault ? " (default)" : "" }}{{ l.available ? "" : " · not downloaded" }}
          </option>
        </select>
        <span
          v-if="selectedLeague?.credit"
          class="lab-credit"
          data-test="credit"
        >{{ selectedLeague.credit }}</span>
        <div
          v-if="selectedLeague && !selectedLeague.available"
          style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap"
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
        <label class="lab-inline">
          <span>{{ uploadingLeague ? "Uploading and validating…" : "Or upload a BBGM export:" }}</span>
          <input
            type="file"
            accept=".json,application/json"
            data-test="league-upload"
            :disabled="uploadingLeague"
            @change="onLeagueUpload"
          >
        </label>
        <p
          v-if="validating"
          class="hint"
        >
          Checking the league…
        </p>
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
          v-if="leagueError"
          role="alert"
          class="lab-error"
        >
          {{ leagueError }}
        </p>
      </div>

      <!-- Mode and sizes -->
      <div class="field">
        <label id="lab-mode-label">Mode</label>
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
          <div
            class="lab-seg"
            role="radiogroup"
            aria-labelledby="lab-mode-label"
          >
            <button
              type="button"
              role="radio"
              :aria-checked="mode === 'deep'"
              @click="mode = 'deep'"
            >
              Deep · multi-season
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="mode === 'quick'"
              @click="mode = 'quick'"
            >
              Quick · one offseason
            </button>
          </div>
          <span
            v-if="!unlocked"
            class="lab-locked"
            data-test="locked-sizes"
          >
            Locked: {{ sizeText(mode) }}
          </span>
        </div>
        <label class="lab-inline">
          <input
            v-model="unlocked"
            type="checkbox"
            data-test="unlock"
          >
          Unlock (advanced)
        </label>
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
            v-if="mode === 'deep'"
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
        >Locked sizes keep results stable and comparable. Unlocked runs say so in their manifest.</span>
      </div>

      <div class="field-row">
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

      <div style="display: flex; gap: 14px; align-items: center; justify-content: space-between; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 16px">
        <span
          v-if="estimate"
          class="lab-estimate"
          data-test="estimate"
          :title="estimate.basis.join('\n')"
        >
          Estimated ~{{ secondsText(estimate.seconds) }}
          <InfoTip label="How this estimate was measured">
            <span
              v-for="b in estimate.basis"
              :key="b"
              style="display: block"
            >{{ b }}</span>
          </InfoTip>
        </span>
        <span
          v-else-if="estimating"
          class="lab-estimate"
        >Measuring estimate…</span>
        <span
          v-else-if="estimateError"
          class="hint"
        >{{ estimateError }}</span>
        <span v-else />
        <button
          type="submit"
          class="btn primary lg"
          data-test="run"
          :disabled="!canRun"
          :title="blockers.join(' ')"
        >
          <DeIcon name="plus" />
          {{ submitting ? "Starting…" : "Run test" }}
        </button>
      </div>
      <p
        v-if="submitError"
        role="alert"
        class="lab-error"
      >
        {{ submitError }}
      </p>
      <p
        v-else-if="blockers.length && !validating"
        class="hint"
        style="margin: 0"
      >
        {{ blockers[0] }}
      </p>
    </form>
  </div>
</template>
