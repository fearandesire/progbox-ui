<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import SimProgressPanel from "../components/SimProgressPanel.vue";
import { fetchSim } from "../lib/api";
import type { RunMetadata } from "../lib/types";

const route = useRoute();
const build = computed(() => String(route.params.build ?? ""));

const run = ref<RunMetadata | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const notFound = ref(false);

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
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8">
    <RouterLink
      to="/"
      class="mb-6 inline-block text-sm text-violet-600 hover:underline"
    >
      ← Dashboard
    </RouterLink>

    <h1 class="font-mono text-xl font-semibold text-neutral-900 dark:text-neutral-100">
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
      class="mt-4 space-y-2 text-neutral-700 dark:text-neutral-300"
    >
      <p>
        <span class="text-neutral-500">Status:</span>
        {{ run.status }}
      </p>
      <p v-if="run.script_version">
        <span class="text-neutral-500">Script:</span>
        {{ run.script_version }}
      </p>
      <SimProgressPanel
        v-if="run.status === 'running'"
        :build="build"
      />
      <p class="text-neutral-600 dark:text-neutral-400">
        Charts, players, and exports: use the API or extend this view.
      </p>
    </div>
  </div>
</template>
