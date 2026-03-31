<script setup lang="ts">
import {
  FlexRender,
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useVueTable,
  type SortingState,
} from "@tanstack/vue-table";
import { computed, onMounted, ref } from "vue";
import { fetchPlayers } from "../lib/api";
import type { PlayerSummary } from "../lib/types";
import { usePlayerFilter } from "../composables/usePlayerFilter";

interface PlayerRow extends PlayerSummary {
  team: string;
  age: number;
}

const props = defineProps<{
  build: string;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const rawRows = ref<PlayerSummary[]>([]);
const sorting = ref<SortingState>([{ id: "P50", desc: true }]);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    rawRows.value = await fetchPlayers(props.build);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

const rows = computed<PlayerRow[]>(() =>
  rawRows.value.map((row) => ({
    ...row,
    team: row.Team,
    age: Number(row.Age),
  })),
);

const { team, ageMin, ageMax, filtered } = usePlayerFilter(() => rows.value);

const columnHelper = createColumnHelper<PlayerRow>();
const columns = [
  columnHelper.accessor("Name", {
    header: "Name",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("Team", {
    header: "Team",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("Age", {
    header: "Age",
    cell: (info) => info.getValue().toString(),
  }),
  columnHelper.accessor("Baseline", {
    header: "Baseline",
    cell: (info) => info.getValue().toFixed(2),
  }),
  columnHelper.accessor("MeanDelta", {
    header: "MeanΔ",
    cell: (info) => info.getValue().toFixed(2),
  }),
  columnHelper.accessor("StdDelta", {
    header: "StdΔ",
    cell: (info) => info.getValue().toFixed(2),
  }),
  columnHelper.accessor("P50", {
    header: "P50",
    cell: (info) => info.getValue().toFixed(2),
  }),
  columnHelper.accessor("P95", {
    header: "P95",
    cell: (info) => info.getValue().toFixed(2),
  }),
];

const table = useVueTable({
  get data() {
    return filtered.value;
  },
  columns,
  state: {
    get sorting() {
      return sorting.value;
    },
  },
  onSortingChange: (updater) => {
    sorting.value = typeof updater === "function" ? updater(sorting.value) : updater;
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
});

const teams = computed(() => {
  return [...new Set(rows.value.map((row) => row.team))].sort();
});

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="space-y-4">
    <div class="grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-3 dark:border-neutral-800 dark:bg-neutral-900">
      <label class="text-sm">
        <span class="mb-1 block text-xs font-medium text-neutral-500">Team</span>
        <select
          v-model="team"
          class="w-full rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option :value="null">
            All
          </option>
          <option
            v-for="code in teams"
            :key="code"
            :value="code"
          >
            {{ code }}
          </option>
        </select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-xs font-medium text-neutral-500">Min age</span>
        <input
          :value="ageMin ?? ''"
          type="number"
          class="w-full rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-950"
          @input="ageMin = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null"
        >
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-xs font-medium text-neutral-500">Max age</span>
        <input
          :value="ageMax ?? ''"
          type="number"
          class="w-full rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-950"
          @input="ageMax = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null"
        >
      </label>
    </div>

    <div
      v-if="loading"
      class="h-48 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800"
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
      v-else-if="table.getRowModel().rows.length === 0"
      class="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
    >
      No players yet.
    </p>

    <div
      v-else
      class="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    >
      <table class="min-w-full text-sm">
        <thead class="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
          <tr
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              class="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300"
            >
              <button
                v-if="header.column.getCanSort()"
                class="inline-flex items-center gap-1 transition-colors duration-150 hover:text-sky-600"
                @click="header.column.toggleSorting()"
              >
                <FlexRender
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
                <span class="text-xs text-neutral-500">
                  {{ header.column.getIsSorted() === "desc" ? "▼" : header.column.getIsSorted() === "asc" ? "▲" : "" }}
                </span>
              </button>
              <FlexRender
                v-else
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in table.getRowModel().rows"
            :key="row.id"
            class="border-b border-neutral-100 last:border-b-0 dark:border-neutral-800"
          >
            <td
              v-for="cell in row.getVisibleCells()"
              :key="cell.id"
              class="px-3 py-2 text-neutral-700 dark:text-neutral-300"
            >
              <FlexRender
                :render="cell.column.columnDef.cell"
                :props="cell.getContext()"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
