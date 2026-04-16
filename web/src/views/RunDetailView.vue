<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useRouter } from "vue-router";
import ChartGallery from "../components/ChartGallery.vue";
import GodProgList from "../components/GodProgList.vue";
import PlayerTable from "../components/PlayerTable.vue";
import SimProgressPanel from "../components/SimProgressPanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { deleteSim, downloadUrl, fetchSim } from "../lib/api";
import type { RunMetadata } from "../lib/types";

type Tab = "overview" | "charts" | "players" | "godprogs";

const route = useRoute();
const router = useRouter();
const build = computed(() => String(route.params.build ?? ""));
const tab = ref<Tab>("overview");

const run = ref<RunMetadata | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const notFound = ref(false);
const deleteError = ref<string | null>(null);

function httpStatus(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const o = e as Record<string, unknown>;
  if (typeof o.status === "number") return o.status;
  if (typeof o.statusCode === "number") return o.statusCode;
  return null;
}

async function loadDetail() {
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
    run.value = await fetchSim(b);
  } catch (e: unknown) {
    const status = httpStatus(e);
    if (status === 404) {
      notFound.value = true;
    } else if (status === 422) {
      error.value = "Invalid build id (expected 14-digit CalVer).";
    } else if (e instanceof Error) {
      error.value = e.message;
    } else {
      error.value = String(e);
    }
  } finally {
    loading.value = false;
  }
}

watch(
  build,
  () => {
    void loadDetail();
  },
  { immediate: true },
);

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
  <div class="mx-auto max-w-4xl px-4 py-8">
    <RouterLink
      to="/"
      class="mb-6 inline-block text-sm text-sky-600 transition-colors duration-150 hover:text-sky-500 hover:underline"
    >
      ← Dashboard
    </RouterLink>

    <h1 class="font-mono text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
      {{ build }}
    </h1>

    <p
      v-if="loading"
      class="mt-4 text-neutral-500"
    >
      Loading…
    </p>
    <p
      v-else-if="notFound"
      class="mt-4 text-amber-700 dark:text-amber-400"
    >
      Run not found (no metadata for this build id).
    </p>
    <p
      v-else-if="error"
      class="mt-4 text-red-600"
    >
      {{ error }}
    </p>
    <div
      v-else-if="run"
      class="mt-4 space-y-4 text-neutral-700 dark:text-neutral-300"
    >
      <SimProgressPanel
        v-if="run.status === 'running'"
        :build="build"
      />

      <div class="flex flex-wrap items-center gap-5 border-b border-neutral-200 pb-1 dark:border-neutral-800">
        <button
          class="border-b-2 px-1 py-2 text-sm font-medium transition-colors duration-150"
          :class="tab === 'overview' ? 'border-sky-600 text-sky-700 dark:text-sky-300' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
          @click="tab = 'overview'"
        >
          Overview
        </button>
        <button
          class="border-b-2 px-1 py-2 text-sm font-medium transition-colors duration-150"
          :class="tab === 'charts' ? 'border-sky-600 text-sky-700 dark:text-sky-300' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
          @click="tab = 'charts'"
        >
          Charts
        </button>
        <button
          class="border-b-2 px-1 py-2 text-sm font-medium transition-colors duration-150"
          :class="tab === 'players' ? 'border-sky-600 text-sky-700 dark:text-sky-300' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
          @click="tab = 'players'"
        >
          Players
        </button>
        <button
          class="border-b-2 px-1 py-2 text-sm font-medium transition-colors duration-150"
          :class="tab === 'godprogs' ? 'border-sky-600 text-sky-700 dark:text-sky-300' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
          @click="tab = 'godprogs'"
        >
          God Progs
        </button>
      </div>

      <section
        v-if="tab === 'overview'"
        class="space-y-4"
      >
        <div class="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold">
              Run Metadata
            </h2>
            <StatusBadge :status="run.status" />
          </div>
          <dl class="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt class="text-xs text-neutral-500">
                Script
              </dt>
              <dd>{{ run.script_version ?? "n/a" }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">
                Seed
              </dt>
              <dd>{{ run.seed ?? "n/a" }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">
                Runs
              </dt>
              <dd>{{ run.runs ?? "n/a" }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">
                Workers
              </dt>
              <dd>{{ run.n_workers ?? "auto" }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">
                Players
              </dt>
              <dd>{{ run.player_count ?? "n/a" }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">
                Teams
              </dt>
              <dd>{{ run.teams.length ? run.teams.join(", ") : "All teams" }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">
                Started
              </dt>
              <dd>{{ run.started_at ?? "n/a" }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">
                Completed
              </dt>
              <dd>{{ run.completed_at ?? "n/a" }}</dd>
            </div>
          </dl>
        </div>

        <div class="flex flex-wrap gap-2">
          <a
            :href="downloadUrl(run.build, 'analysis')"
            class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-sky-500"
          >
            Download Analysis (.xlsx)
          </a>
          <a
            :href="downloadUrl(run.build, 'csv')"
            class="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-neutral-600"
          >
            Download Raw CSV
          </a>
          <button
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-500"
            @click="removeRun"
          >
            Delete Run
          </button>
        </div>
        <p
          v-if="deleteError"
          class="text-sm text-red-600"
        >
          {{ deleteError }}
        </p>
      </section>

      <ChartGallery
        v-else-if="tab === 'charts'"
        :build="run.build"
      />
      <PlayerTable
        v-else-if="tab === 'players'"
        :build="run.build"
      />
      <GodProgList
        v-else
        :build="run.build"
      />
    </div>
  </div>
</template>
