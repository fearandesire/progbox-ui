import { computed, ref } from "vue";

/** Team / age filters for player tables (Block 6). */
export function usePlayerFilter<T extends { team?: string; age?: number }>(
  rows: () => T[],
) {
  const team = ref<string | null>(null);
  const ageMin = ref<number | null>(null);
  const ageMax = ref<number | null>(null);

  const filtered = computed(() => {
    return rows().filter((r) => {
      if (team.value && r.team !== team.value) return false;
      if (ageMin.value != null && (r.age ?? 0) < ageMin.value) return false;
      if (ageMax.value != null && (r.age ?? 0) > ageMax.value) return false;
      return true;
    });
  });

  return { team, ageMin, ageMax, filtered };
}
