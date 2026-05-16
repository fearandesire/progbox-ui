<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import SimProgressPanel from "../components/SimProgressPanel.vue";
import { createSim } from "../lib/api";
import { useSimProgress } from "../composables/useSimProgress";

type CreateState = "idle" | "uploading" | "running" | "failed";

const router = useRouter();

const exportFile = ref<File | null>(null);
const teaminfoFile = ref<File | null>(null);
const teamsCsv = ref("");
const seed = ref(69);
const runs = ref(500);
const nWorkers = ref<number | null>(null);

const state = ref<CreateState>("idle");
const error = ref<string | null>(null);
const activeBuild = ref<string | null>(null);

const teaminfoExample = `{
  "0": "BOS",
  "1": "NYK",
  "-1": "FA",
  "-2": "UDFA",
  "-3": "Retired"
}`;

const showTeaminfoDetails = ref(false);
const showAdvanced = ref(false);

const canSubmit = computed(() => exportFile.value && state.value !== "uploading");
const simProgress = useSimProgress(activeBuild);

watch(
  () => simProgress.done.value,
  (done) => {
    if (!done || !activeBuild.value) return;
    state.value = "idle";
    void router.push(`/runs/${activeBuild.value}`);
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
  try {
    const response = await createSim(
      exportFile.value,
      {
        teams: parseTeams(teamsCsv.value),
        seed: seed.value,
        runs: runs.value,
        n_workers: nWorkers.value,
      },
      teaminfoFile.value,
    );
    activeBuild.value = response.build;
    state.value = "running";
  } catch (e: unknown) {
    error.value = httpErrorMessage(e);
    state.value = "failed";
  }
}
</script>

<template>
  <main class="page">
    <a
      class="back"
      role="link"
      tabindex="0"
      @click="router.push('/')"
    >
      <DeIcon
        name="arrow-left"
        :size="14"
      />
      Dashboard
    </a>

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
        <label>Export JSON <span class="req">*</span></label>
        <input
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

      <div class="field-row">
        <div class="field">
          <label>Seed</label>
          <input
            v-model.number="seed"
            class="input mono"
            type="number"
          >
        </div>
        <div class="field">
          <label>Runs</label>
          <input
            v-model.number="runs"
            class="input mono"
            type="number"
            min="1"
          >
        </div>
        <div class="field">
          <label>Workers (blank = auto)</label>
          <input
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
            <label>Teams (comma-separated)</label>
            <input
              v-model="teamsCsv"
              class="input"
              type="text"
              placeholder="GSW, BOS"
            >
            <span class="hint">Filter the simulation to specific team abbreviations only.</span>
          </div>

          <div class="field">
            <label>Teaminfo override</label>
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
      v-if="state === 'running' && activeBuild"
      style="margin-top: 20px"
    >
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
  </main>
</template>
