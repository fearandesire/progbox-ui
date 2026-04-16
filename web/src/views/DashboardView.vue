<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink } from "vue-router";
import StatusBadge from "../components/StatusBadge.vue";
import { deleteSim } from "../lib/api";
import { useSimsStore } from "../stores/sims";

const sims = useSimsStore();

onMounted(() => {
  void sims.load();
});

async function removeRun(build: string) {
  if (!window.confirm(`Delete run ${build}?`)) return;
  await deleteSim(build);
  await sims.load();
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8">
    <div class="mb-6 flex items-center justify-between gap-4">
      <h1 class="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Runs
      </h1>
      <RouterLink
        to="/new"
        class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-sky-500"
      >
        New simulation
      </RouterLink>
    </div>
    <p
      v-if="sims.loading"
      class="text-neutral-500"
    >
      Loading…
    </p>
    <p
      v-else-if="sims.error"
      class="text-red-600"
    >
      {{ sims.error }}
    </p>
    <p
      v-else-if="sims.runs.length === 0"
      class="rounded-xl border border-dashed border-neutral-300 bg-white/80 p-6 text-sm text-neutral-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-300"
    >
      No runs yet. Start the API and launch a simulation to populate this dashboard.
    </p>
    <ul
      v-else
      class="space-y-3"
    >
      <li
        v-for="run in sims.runs"
        :key="run.build"
      >
        <div class="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow duration-150 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-start justify-between gap-4">
            <RouterLink
              :to="`/runs/${run.build}`"
              class="block flex-1 hover:underline"
            >
              <p class="font-mono text-sm">
                {{ run.build }}
              </p>
              <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <StatusBadge :status="run.status" />
                <span>runs: {{ run.runs ?? "n/a" }}</span>
                <span>players: {{ run.player_count ?? "n/a" }}</span>
                <span>started: {{ run.started_at ?? "n/a" }}</span>
              </div>
            </RouterLink>
            <button
              class="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors duration-150 hover:bg-red-500"
              @click="removeRun(run.build)"
            >
              Delete
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
