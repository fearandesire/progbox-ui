import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchConfig } from "../lib/api";

export const useConfigStore = defineStore("config", () => {
  const constants = ref<Record<string, unknown> | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      constants.value = await fetchConfig();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  return { constants, loading, error, load };
});
