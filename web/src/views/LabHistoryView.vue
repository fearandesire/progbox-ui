<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import LabSubnav from "../components/lab/LabSubnav.vue";
import "../components/lab/lab.css";
import { fetchLabRuns, labErrorMessage } from "../lib/api";
import { timeAgo } from "../lib/format";
import { labVersionText } from "../lib/labChecks";
import { modeLabel, secondsText, verdictClass } from "../lib/labFormat";
import type { LabRunSummary } from "../lib/labTypes";

const route = useRoute();
/** Scripts tab links here with ?script=<id> to show that version's runs. */
const scriptFilter = computed(() => (typeof route.query.script === "string" && route.query.script ? route.query.script : null));

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
  runs.value
    .filter((r) => !scriptFilter.value || r.script === scriptFilter.value || r.baseline === scriptFilter.value)
    .map((r) => ({
      ...r,
      key: r.runId ?? r.queueId ?? "",
      when: timeAgo(r.startedAt ?? r.createdAt ?? null) || "–",
      labv: labVersionText(r.lab),
      again: { script: r.script, baseline: r.baseline ?? "none", ...(r.league ? { league: r.league } : {}), mode: r.mode },
    })),
);
</script>

<template>
  <div class="page">
    <LabSubnav current="history" />
    <div class="section-head">
      <div>
        <h1 class="page-title">
          Lab history
        </h1>
        <p class="page-desc">
          <template v-if="scriptFilter">
            Runs of {{ scriptFilter }}, newest first. <RouterLink to="/lab/history">
              Show all
            </RouterLink>
          </template>
          <template v-else>
            Every NET Lab run on this server, newest first.
          </template>
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
              <th class="no-sort">
                Lab
              </th>
              <th class="no-sort">
                <span class="sr-only">Actions</span>
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
              <td>{{ modeLabel(r.mode) }}</td>
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
              <td
                class="cell-mono"
                :title="r.labv.title"
                data-test="lab-version"
              >
                {{ r.labv.text }}
              </td>
              <td>
                <RouterLink
                  class="lab-icon"
                  :to="{ path: '/lab', query: r.again }"
                  title="Run again with the same settings"
                  :aria-label="`Run again: ${r.script}`"
                  data-test="run-again"
                >
                  <DeIcon
                    name="rotate"
                    :size="16"
                  />
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
