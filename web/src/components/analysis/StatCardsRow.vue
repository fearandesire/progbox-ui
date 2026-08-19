<script setup lang="ts">
import type { StatCard } from "../../lib/analysisTypes";

defineProps<{
  cards: StatCard[];
}>();
</script>

<template>
  <div class="stat-cards">
    <div
      v-for="card in cards"
      :key="card.label"
      class="stat-cards__card"
    >
      <div class="stat-cards__lbl">
        {{ card.label }}
      </div>
      <div
        class="stat-cards__val"
        :style="card.color ? { color: card.color } : undefined"
      >
        {{ card.value }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 22px;
}
.stat-cards__card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
  padding: 12px 16px;
}
.stat-cards__lbl {
  font-size: var(--t-label, 11.5px);
  text-transform: uppercase;
  letter-spacing: var(--tr-label, 0.06em);
  color: var(--fg-mute);
  margin-bottom: 4px;
}
.stat-cards__val {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--fg);
  letter-spacing: var(--tr-snug, -0.02em);
}
</style>
