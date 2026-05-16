<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchGodprogs } from "../lib/api";
import type { GodProg } from "../lib/types";

const props = defineProps<{ build: string }>();

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
  <section class="panel table-panel">
    <div class="table-head">
      <h3 class="panel-title">
        God Progs · seed-level outliers
      </h3>
      <p class="panel-sub">
        {{ events.length }} flagged
      </p>
    </div>

    <div
      v-if="loading"
      class="empty"
      style="margin: 22px"
    >
      Loading god progs…
    </div>
    <div
      v-else-if="error"
      class="empty"
      style="margin: 22px; color: var(--rd-600); border-color: color-mix(in oklab, var(--rd-600) 35%, transparent)"
    >
      {{ error }}
      <div style="margin-top: 10px">
        <button
          class="btn ghost"
          type="button"
          @click="load"
        >
          Retry
        </button>
      </div>
    </div>
    <div
      v-else-if="events.length === 0"
      class="empty"
      style="margin: 22px"
    >
      No god progs recorded.
    </div>

    <div
      v-else
      class="table-scroll"
    >
      <table class="de-table">
        <thead>
          <tr>
            <th class="no-sort cell-name">
              Player
            </th>
            <th class="no-sort">
              Age
            </th>
            <th class="no-sort">
              OVR
            </th>
            <th class="no-sort">
              Bonus
            </th>
            <th class="no-sort">
              Chance
            </th>
            <th class="no-sort">
              Run seed
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="event in events"
            :key="`${event.name}-${event.run_seed}-${event.age}-${event.ovr}`"
          >
            <td class="cell-name">
              {{ event.name }}
            </td>
            <td>{{ event.age }}</td>
            <td>{{ event.ovr }}</td>
            <td style="color: var(--em-600)">
              +{{ event.bonus.toFixed(2) }}
            </td>
            <td>{{ event.chance.toFixed(4) }}</td>
            <td class="cell-seed">
              {{ event.run_seed }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
