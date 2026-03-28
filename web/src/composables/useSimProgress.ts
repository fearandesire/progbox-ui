import { onUnmounted, ref } from "vue";

import { getApiBaseUrl } from "../lib/api";

export interface SimProgressPayload {
  phase: string;
  pct: number;
  message: string;
  done: boolean;
}

/** SSE client for `GET /api/sims/:build/progress`. */
export function useSimProgress(build: string) {
  const phase = ref<string | null>(null);
  const pct = ref(0);
  const message = ref<string | null>(null);
  const done = ref(false);

  let es: EventSource | null = null;

  function connect() {
    if (!build) return;
    const path = `${getApiBaseUrl()}/sims/${encodeURIComponent(build)}/progress`;
    const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;
    es = new EventSource(url);

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const data = JSON.parse(ev.data) as SimProgressPayload;
        phase.value = data.phase;
        pct.value = data.pct;
        message.value = data.message;
        done.value = Boolean(data.done);
        if (data.done) {
          es?.close();
          es = null;
        }
      } catch {
        /* ignore malformed chunks */
      }
    };

    es.onerror = () => {
      es?.close();
      es = null;
    };
  }

  connect();

  onUnmounted(() => {
    es?.close();
    es = null;
  });

  return { phase, pct, message, done };
}
