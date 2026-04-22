<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useRouter } from "vue-router";
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
  const file = target.files?.[0] ?? null;
  exportFile.value = file;
}

function onTeaminfoChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  teaminfoFile.value = file;
}

function httpErrorMessage(err: unknown): string {
  // ofetch surfaces the API body as `err.data`; prefer FastAPI's `detail` string.
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
    const response = await createSim(exportFile.value, {
      teams: parseTeams(teamsCsv.value),
      seed: seed.value,
      runs: runs.value,
      n_workers: nWorkers.value,
    }, teaminfoFile.value);
    activeBuild.value = response.build;
    state.value = "running";
  } catch (e: unknown) {
    error.value = httpErrorMessage(e);
    state.value = "failed";
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8">
    <RouterLink
      to="/"
      class="mb-6 inline-block text-sm text-sky-600 transition-colors duration-150 hover:text-sky-500 hover:underline"
    >
      ← Back
    </RouterLink>
    <h1 class="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
      New simulation
    </h1>
    <p class="mt-2 text-neutral-600 dark:text-neutral-400">
      Upload a BBGM export and launch a new Progbox run.
    </p>

    <form
      class="mt-6 space-y-5 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-shadow duration-150 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
      @submit.prevent="submit"
    >
      <div>
        <label class="mb-1 block text-sm font-medium">Export JSON (required)</label>
        <input
          type="file"
          accept=".json,application/json"
          class="block w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          @change="onExportChange"
        >
        <p
          v-if="exportFile"
          class="mt-1 text-xs text-neutral-500"
        >
          {{ exportFile.name }}
        </p>
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium">
          Teaminfo JSON <span class="font-normal text-neutral-500">(advanced — optional override)</span>
        </label>
        <input
          type="file"
          accept=".json,application/json"
          class="block w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          @change="onTeaminfoChange"
        >
        <div class="mt-1 space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          <p>
            By default, <span class="font-mono">teaminfo.json</span> is <strong>auto-generated</strong>
            from the active teams in your export (team ID → abbreviation, plus the
            <span class="font-mono">-1 FA</span> / <span class="font-mono">-2 UDFA</span> /
            <span class="font-mono">-3 Retired</span> game-rule slots).
          </p>
          <p>
            Only upload a file here to override team abbreviations — for example a custom
            league or a different era with renamed teams. Expected format:
          </p>
          <pre class="overflow-x-auto rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] leading-snug dark:bg-neutral-800">{{ teaminfoExample }}</pre>
          <p
            v-if="teaminfoFile"
            class="text-neutral-600 dark:text-neutral-300"
          >
            Override selected: <span class="font-mono">{{ teaminfoFile.name }}</span>
          </p>
        </div>
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium">Teams (comma-separated, optional)</label>
        <input
          v-model="teamsCsv"
          type="text"
          placeholder="GSW, BOS"
          class="block w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div>
          <label class="mb-1 block text-sm font-medium">Seed</label>
          <input
            v-model.number="seed"
            type="number"
            class="block w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Runs</label>
          <input
            v-model.number="runs"
            type="number"
            min="1"
            class="block w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Workers (blank = auto)</label>
          <input
            :value="nWorkers ?? ''"
            type="number"
            min="1"
            class="block w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            @input="nWorkers = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null"
          >
        </div>
      </div>

      <p
        v-if="error"
        class="text-sm text-red-600"
      >
        {{ error }}
      </p>

      <button
        type="submit"
        :disabled="!canSubmit"
        class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {{ state === "uploading" ? "Starting..." : "Start simulation" }}
      </button>
    </form>

    <div
      v-if="state === 'running' && activeBuild"
      class="mt-4"
    >
      <p class="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
        Run started:
        <RouterLink
          :to="`/runs/${activeBuild}`"
          class="font-mono text-sky-600 transition-colors duration-150 hover:text-sky-500 hover:underline"
        >
          {{ activeBuild }}
        </RouterLink>
      </p>
      <SimProgressPanel :build="activeBuild" />
    </div>
  </div>
</template>
