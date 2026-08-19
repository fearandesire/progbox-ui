<script setup lang="ts">
import type {
  ChartRef,
  ExplorerPayload,
  ExtractedSection,
  ParsedScorecard,
  PlotlyFigureJson,
} from "../../lib/analysisTypes";
import PlayerExplorer from "./PlayerExplorer.vue";
import PlotlyChart from "./PlotlyChart.vue";
import ScorecardTable from "./ScorecardTable.vue";

const props = defineProps<{
  section: ExtractedSection;
  figures: Record<string, PlotlyFigureJson>;
  playerExplorer?: ExplorerPayload | null;
  /** Comparison mode: replaces the `scorecard` section's go.Table figure. */
  scorecard?: ParsedScorecard | null;
}>();

const isScorecardSection = props.section.id === "scorecard" && props.scorecard != null;

function figureFor(ref: ChartRef): PlotlyFigureJson | null {
  if (ref.kind !== "figure") return null;
  return props.figures[ref.payloadId] ?? null;
}
</script>

<template>
  <section
    :id="section.id"
    class="a-section"
  >
    <h2 class="a-section__title">
      {{ section.title }}
    </h2>
    <p class="a-section__intro">
      {{ section.intro }}
    </p>

    <template v-if="isScorecardSection">
      <div class="a-section__card">
        <ScorecardTable :scorecard="scorecard!" />
      </div>
    </template>
    <template v-else>
      <template
        v-for="(ref, i) in section.charts"
        :key="i"
      >
        <div
          v-if="ref.kind === 'figure' && figureFor(ref)"
          class="a-section__card"
        >
          <PlotlyChart
            :figure="figureFor(ref)!"
            :min-height="ref.minHeight"
          />
        </div>
        <div
          v-else-if="ref.kind === 'player-explorer' && playerExplorer"
          class="a-section__card"
        >
          <PlayerExplorer :payload="playerExplorer" />
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.a-section {
  padding: 28px 0 8px;
  border-top: 1px solid var(--line);
  scroll-margin-top: 90px;
}
.a-section__title {
  font-family: var(--display, inherit);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: var(--tr-snug, -0.02em);
  color: var(--fg);
  margin: 0 0 8px;
}
.a-section__intro {
  color: var(--fg-mute);
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 18px;
  max-width: 860px;
}
.a-section__card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg, 12px);
  padding: 18px;
  margin-bottom: 16px;
}
</style>
