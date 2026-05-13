import type { SimProgressPayload } from "../types.js";

/** In-memory progress for SSE (mirrors services/runner.py PROGRESS) */
export const PROGRESS = new Map<string, SimProgressPayload>();

export function setProgress(
  build: string,
  phase: string,
  pct: number,
  message: string,
  done = false,
): void {
  const clamped = Math.max(0, Math.min(100, pct));
  PROGRESS.set(build, { phase, pct: clamped, message, done });
}

export function clearProgress(build: string): void {
  PROGRESS.delete(build);
}
