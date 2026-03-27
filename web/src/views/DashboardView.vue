<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink } from "vue-router";
import { useSimsStore } from "../stores/sims";

const sims = useSimsStore();

onMounted(() => {
  void sims.load();
});
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8">
    <div class="mb-6 flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Runs
      </h1>
      <RouterLink
        to="/new"
        class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
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
      class="text-neutral-500"
    >
      No runs yet. Start the API and add outputs, or create a new simulation.
    </p>
    <ul
      v-else
      class="space-y-3"
    >
      <li
        v-for="run in sims.runs"
        :key="run.build"
      >
        <RouterLink
          :to="`/runs/${run.build}`"
          class="block rounded-lg border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          <span class="font-mono text-sm">{{ run.build }}</span>
          <span class="ml-2 text-xs text-neutral-500">{{ run.status }}</span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
