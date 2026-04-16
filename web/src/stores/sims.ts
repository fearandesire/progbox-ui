import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchSims } from "../lib/api";
import type { RunMetadata } from "../lib/types";

export const useSimsStore = defineStore("sims", () => {
  const runs = ref<RunMetadata[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      runs.value = await fetchSims();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  return { runs, loading, error, load };
});
