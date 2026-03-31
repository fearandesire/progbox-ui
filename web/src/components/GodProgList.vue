<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchGodprogs } from "../lib/api";
import type { GodProg } from "../lib/types";

const props = defineProps<{
  build: string;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const events = ref<GodProg[]>([]);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    events.value = await fetchGodprogs(props.build);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="space-y-4">
    <div
      v-if="loading"
      class="h-44 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800"
    />

    <div
      v-else-if="error"
      class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    >
      <p>{{ error }}</p>
      <button
        class="mt-2 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
        @click="load"
      >
        Retry
      </button>
    </div>

    <p
      v-else-if="events.length === 0"
      class="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
    >
      No god progs recorded.
    </p>

    <div
      v-else
      class="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <table class="min-w-full text-sm">
        <thead class="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
          <tr>
            <th class="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300">
              Name
            </th>
            <th class="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300">
              Age
            </th>
            <th class="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300">
              OVR
            </th>
            <th class="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300">
              Bonus
            </th>
            <th class="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300">
              Chance
            </th>
            <th class="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300">
              Run Seed
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="event in events"
            :key="`${event.name}-${event.run_seed}-${event.age}-${event.ovr}`"
            class="border-b border-neutral-100 last:border-b-0 dark:border-neutral-800"
          >
            <td class="px-3 py-2 text-neutral-700 dark:text-neutral-300">
              {{ event.name }}
            </td>
            <td class="px-3 py-2 text-neutral-700 dark:text-neutral-300">
              {{ event.age }}
            </td>
            <td class="px-3 py-2 text-neutral-700 dark:text-neutral-300">
              {{ event.ovr }}
            </td>
            <td class="px-3 py-2 text-neutral-700 dark:text-neutral-300">
              {{ event.bonus.toFixed(2) }}
            </td>
            <td class="px-3 py-2 text-neutral-700 dark:text-neutral-300">
              {{ event.chance.toFixed(4) }}
            </td>
            <td class="px-3 py-2 font-mono text-neutral-700 dark:text-neutral-300">
              {{ event.run_seed }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
