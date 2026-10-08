<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import "../components/lab/lab.css";
import { fetchLabRuns, labErrorMessage } from "../lib/api";
import { timeAgo } from "../lib/format";
import { secondsText, verdictClass } from "../lib/labFormat";
import type { LabRunSummary } from "../lib/labTypes";

const runs = ref<LabRunSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    runs.value = await fetchLabRuns();
  } catch (e) {
    error.value = labErrorMessage(e, "Could not load the history");
  } finally {
    loading.value = false;
  }
});

const rows = computed(() =>
  runs.value.map((r) => ({
    ...r,
    key: r.runId ?? r.queueId ?? "",
    when: timeAgo(r.startedAt ?? r.createdAt ?? null) || "–",
  })),
);
</script>

<template>
  <div class="page">
    <nav
      class="lab-subnav"
      aria-label="Lab"
    >
      <RouterLink
        to="/lab"
        class="chip"
      >
        New test
      </RouterLink>
      <RouterLink
        to="/lab/history"
        class="chip active"
      >
        History
      </RouterLink>
    </nav>
    <div class="section-head">
      <div>
        <h1 class="page-title">
          Lab history
        </h1>
        <p class="page-desc">
          Every NET Lab run on this server, newest first.
        </p>
      </div>
    </div>

    <p
      v-if="error"
      role="alert"
      class="lab-error"
    >
      {{ error }}
    </p>
    <p
      v-else-if="loading"
      class="page-desc"
    >
      Loading…
    </p>
    <div
      v-else-if="!rows.length"
      class="empty"
    >
      No lab runs yet. <RouterLink to="/lab">
        Test a script
      </RouterLink>
    </div>
    <section
      v-else
      class="panel table-panel"
    >
      <div class="table-scroll">
        <table
          class="de-table lab-table"
          data-test="history"
        >
          <thead>
            <tr>
              <th class="no-sort">
                When
              </th>
              <th class="no-sort">
                Script
              </th>
              <th class="no-sort">
                vs
              </th>
              <th class="no-sort">
                Mode
              </th>
              <th class="no-sort">
                League
              </th>
              <th class="no-sort">
                Result
              </th>
              <th class="no-sort">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.key"
            >
              <td>
                <RouterLink :to="`/lab/runs/${r.key}`">
                  {{ r.when }}
                </RouterLink>
              </td>
              <td class="cell-mono">
                {{ r.script }}
              </td>
              <td class="cell-mono">
                {{ r.baseline ?? "–" }}
              </td>
              <td>{{ r.mode }}</td>
              <td>{{ r.league ?? "–" }}</td>
              <td>
                <span
                  v-if="r.state === 'done'"
                  class="lab-pill"
                  :class="verdictClass(r.verdict)"
                >{{ r.verdict }}</span>
                <span
                  v-else
                  class="badge"
                  :class="r.state === 'failed' ? 'failed' : r.state === 'running' ? 'running' : 'queued'"
                >{{ r.state }}</span>
              </td>
              <td class="cell-mono">
                {{ r.state === "done" ? secondsText(r.seconds) : "–" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
