import { computed, onUnmounted, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";

import { getApiBaseUrl } from "../lib/api";
import type { SimProgress } from "../lib/types";

/** SSE client for `GET /api/sims/:build/progress`. */
export function useSimProgress(build: MaybeRefOrGetter<string | null | undefined>) {
  const phase = ref<string | null>(null);
  const pct = ref(0);
  const message = ref<string | null>(null);
  const done = ref(false);

  let es: EventSource | null = null;

  function closeStream() {
    es?.close();
    es = null;
  }

  function connect(buildId: string) {
    if (!buildId) return;
    closeStream();
    const path = `${getApiBaseUrl()}/sims/${encodeURIComponent(buildId)}/progress`;
    const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;
    es = new EventSource(url);

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const data = JSON.parse(ev.data) as SimProgress;
        phase.value = data.phase;
        pct.value = data.pct;
        message.value = data.message;
        done.value = Boolean(data.done);
        if (data.done) {
          closeStream();
        }
      } catch {
        /* ignore malformed chunks */
      }
    };

    es.onerror = () => {
      closeStream();
    };
  }

  const buildId = computed(() => toValue(build) ?? "");

  watch(
    buildId,
    (nextBuild) => {
      phase.value = null;
      pct.value = 0;
      message.value = null;
      done.value = false;
      if (!nextBuild) {
        closeStream();
        return;
      }
      connect(nextBuild);
    },
    { immediate: true },
  );

  onUnmounted(() => {
    closeStream();
  });

  return { phase, pct, message, done };
}
