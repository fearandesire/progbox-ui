import { onUnmounted, ref } from "vue";

/** SSE hook for `/api/sims/:build/progress` (Block 4–5). */
export function useSimProgress(build: string) {
  void build;
  const phase = ref<string | null>(null);
  const pct = ref(0);
  const message = ref<string | null>(null);

  onUnmounted(() => {
    // Close EventSource when implemented
  });

  return { phase, pct, message };
}
