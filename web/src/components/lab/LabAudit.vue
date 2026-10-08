<script setup lang="ts">
import { computed, ref } from "vue";
import { labFileUrl } from "../../lib/api";
import { copyText } from "../../lib/labFormat";
import type { LabResults } from "../../lib/labTypes";
import DeIcon from "../DeIcon.vue";

const props = defineProps<{ runId: string; results: LabResults }>();

const manifestText = computed(() => JSON.stringify(props.results.manifest, null, 2));
const reportText = computed(() => JSON.stringify(props.results.report, null, 2));
const status = ref("");

async function copy(label: string, text: string) {
  status.value = (await copyText(text)) ? `Copied ${label}` : "Copy blocked by the browser";
}
</script>

<template>
  <div class="lab-stack">
    <section class="panel">
      <h2 class="panel-title">
        Reproduce this run
      </h2>
      <p class="panel-sub">
        Re-runs the manifest's exact spec and checks the report is byte-identical.
      </p>
      <div
        class="lab-cmd"
        style="margin-top: 10px"
      >
        <code data-test="replay">{{ results.replayCommand }}</code>
        <button
          type="button"
          class="btn ghost"
          @click="copy('command', results.replayCommand)"
        >
          <DeIcon name="copy" />Copy
        </button>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title">
        Files
      </h2>
      <div
        class="lab-files"
        style="margin-top: 10px"
      >
        <a
          v-for="f in results.files"
          :key="f"
          class="btn ghost"
          :href="labFileUrl(runId, f)"
          download
        >
          <DeIcon name="download" />{{ f }}
        </a>
      </div>
    </section>

    <div class="lab-grid2">
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">
            manifest.json
          </h2>
          <button
            type="button"
            class="btn ghost"
            data-test="copy-manifest"
            @click="copy('manifest.json', manifestText)"
          >
            <DeIcon name="copy" />Copy
          </button>
        </div>
        <pre class="lab-pre">{{ manifestText }}</pre>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">
            report.json
          </h2>
          <button
            type="button"
            class="btn ghost"
            @click="copy('report.json', reportText)"
          >
            <DeIcon name="copy" />Copy
          </button>
        </div>
        <pre class="lab-pre">{{ reportText }}</pre>
      </section>
    </div>
    <span
      class="hint"
      role="status"
    >{{ status }}</span>
  </div>
</template>
