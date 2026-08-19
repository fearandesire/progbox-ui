<script setup lang="ts">
import type { ExtractedDashboard, ParsedScorecard } from "../../lib/analysisTypes";
import AnalysisSection from "./AnalysisSection.vue";
import StatCardsRow from "./StatCardsRow.vue";

// Mode-agnostic native rendering of an extracted analysis.py dashboard:
// stat cards, sticky anchor nav, one AnalysisSection per section — same
// structure as the generated HTML, restyled with Deep Engine tokens.

defineProps<{
  data: ExtractedDashboard;
  /** Comparison mode: native table for the `scorecard` section. */
  scorecard?: ParsedScorecard | null;
}>();
</script>

<template>
  <div class="a-dash">
    <div class="a-dash__hero">
      <h2 class="a-dash__h1">
        {{ data.hero.title }}
      </h2>
      <p class="a-dash__sub">
        {{ data.hero.subtitle }}
      </p>
    </div>

    <StatCardsRow :cards="data.statCards" />

    <nav
      class="a-dash__nav"
      aria-label="Dashboard sections"
    >
      <a
        v-for="section in data.sections"
        :key="section.id"
        :href="`#${section.id}`"
        class="a-dash__nav-link"
      >{{ section.title }}</a>
    </nav>

    <AnalysisSection
      v-for="section in data.sections"
      :key="section.id"
      :section="section"
      :figures="data.figures"
      :player-explorer="data.playerExplorer"
      :scorecard="scorecard"
    />
  </div>
</template>

<style scoped>
.a-dash__hero {
  margin-bottom: 16px;
}
.a-dash__h1 {
  font-family: var(--display, inherit);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: var(--tr-tight, -0.03em);
  color: var(--fg);
  margin: 0 0 4px;
}
.a-dash__sub {
  color: var(--fg-mute);
  font-size: 13px;
  margin: 0;
}
.a-dash__nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 0;
  margin-bottom: 8px;
  background: color-mix(in oklab, var(--bg) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.a-dash__nav-link {
  color: var(--fg-mute);
  text-decoration: none;
  font-size: 12px;
  padding: 5px 9px;
  border-radius: var(--r-md, 8px);
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.a-dash__nav-link:hover {
  background: var(--surface-2);
  color: var(--fg);
}
</style>
