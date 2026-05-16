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

const props = defineProps<{ build: string }>();

const rawRows = ref<PlayerSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    rawRows.value = await fetchPlayers(props.build);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Failed to load players";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// Keep Team in original case; add `team` + `age` for filter composable
const rows = computed(() =>
  rawRows.value.map((p) => ({
    ...p,
    team: p.Team,
    age: p.Age,
  }))
);

const { team, ageMin, ageMax, filtered } = usePlayerFilter(() => rows.value);

const teams = computed(() =>
  [...new Set(rawRows.value.map((p) => p.Team))].sort()
);

const columnHelper = createColumnHelper<PlayerSummary>();

const columns = [
  columnHelper.accessor("Name", { header: "Player" }),
  columnHelper.accessor("Team", { header: "Tm" }),
  columnHelper.accessor("Age", { header: "Age" }),
  columnHelper.accessor("Baseline", {
    header: "Baseline",
    cell: (info) => info.getValue().toFixed(1),
  }),
  columnHelper.accessor("MeanDelta", {
    header: "MeanΔ",
    cell: (info) => {
      const v = info.getValue();
      return v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
    },
  }),
  columnHelper.accessor("StdDelta", {
    header: "StdΔ",
    cell: (info) => info.getValue().toFixed(2),
  }),
  columnHelper.accessor("P50", {
    header: "P50",
    cell: (info) => info.getValue().toFixed(1),
  }),
  columnHelper.accessor("P95", {
    header: "P95",
    cell: (info) => info.getValue().toFixed(1),
  }),
];

const sorting = ref<SortingState>([{ id: "P50", desc: true }]);

const table = useVueTable({
  get data() {
    return filtered.value as PlayerSummary[];
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

function cellStyle(colId: string, raw: unknown): Record<string, string> {
  if (colId === "MeanDelta") {
    const v = raw as number;
    if (v > 0) return { color: "var(--em-700)" };
    if (v < 0) return { color: "var(--rd-700)" };
  }
  if (colId === "StdDelta" && (raw as number) >= 2) {
    return { color: "var(--am-700)" };
  }
  return {};
}

function cellClass(colId: string): string {
  if (colId === "Name") return "cell-name";
  if (colId === "Team") return "cell-mono";
  return "";
}
</script>

<template>
  <section class="panel table-panel">
    <div class="table-head">
      <h3 class="panel-title">
        Players · sorted by P50
      </h3>
      <p class="panel-sub">
        {{ filtered.length }} of {{ rows.length }} shown
      </p>
    </div>

    <div
      v-if="loading"
      class="empty"
    >
      Loading players…
    </div>

    <div
      v-else-if="error"
      class="empty"
    >
      <p>{{ error }}</p>
      <button
        type="button"
        class="btn ghost"
        @click="load"
      >
        Retry
      </button>
    </div>

    <template v-else>
      <div class="table-toolbar">
        <div class="field">
          <label class="label">Team</label>
          <select
            v-model="team"
            class="select"
          >
            <option value="">
              All
            </option>
            <option
              v-for="t in teams"
              :key="t"
              :value="t"
            >
              {{ t }}
            </option>
          </select>
        </div>
        <div class="field">
          <label class="label">Min age</label>
          <input
            v-model.number="ageMin"
            type="number"
            class="input mono"
            placeholder="—"
          >
        </div>
        <div class="field">
          <label class="label">Max age</label>
          <input
            v-model.number="ageMax"
            type="number"
            class="input mono"
            placeholder="—"
          >
        </div>
      </div>

      <div
        v-if="table.getRowModel().rows.length === 0"
        class="empty"
      >
        No players match these filters.
      </div>

      <table
        v-else
        class="de-table"
      >
        <thead>
          <tr>
            <th
              v-for="header in table.getFlatHeaders()"
              :key="header.id"
            >
              <button
                type="button"
                class="th-sort"
                @click="header.column.getCanSort() && header.column.toggleSorting()"
              >
                <FlexRender
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
                <span class="sort-ind">{{
                  header.column.getIsSorted() === "desc"
                    ? "▼"
                    : header.column.getIsSorted() === "asc"
                      ? "▲"
                      : ""
                }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in table.getRowModel().rows"
            :key="row.id"
          >
            <td
              v-for="cell in row.getVisibleCells()"
              :key="cell.id"
              :class="cellClass(cell.column.id)"
              :style="cellStyle(cell.column.id, cell.getValue())"
            >
              <FlexRender
                :render="cell.column.columnDef.cell"
                :props="cell.getContext()"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
