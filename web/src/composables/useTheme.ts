import { ref } from "vue";

export type Theme = "light" | "dark";

const STORAGE_KEY = "pb-theme";

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

// Module-level singleton so every consumer shares one reactive theme.
const theme = ref<Theme>(readStored());

function apply(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable — DOM state still applies */
  }
}

/** Initialize the theme on app start (call once from main.ts). */
export function initTheme(): void {
  apply(theme.value);
}

export function useTheme() {
  function toggle() {
    theme.value = theme.value === "light" ? "dark" : "light";
    apply(theme.value);
  }
  return { theme, toggle };
}
