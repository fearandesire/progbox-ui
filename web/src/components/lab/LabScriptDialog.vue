<script setup lang="ts">
/* Bumped script viewer: the stored script, and a Smart / Unified / Split diff against
   the original upload and against the version it collided with. Native <dialog>. */
import { computed, nextTick, ref, watch } from "vue";
import { fetchLabScriptDiff, fetchLabScriptSource, labErrorMessage } from "../../lib/api";
import { changeCount, smartDiff, splitRows, type DiffView, type ViewRow } from "../../lib/labDiff";
import { familyOf } from "../../lib/labScripts";
import type { LabDiff, LabScript } from "../../lib/labTypes";
import DeIcon from "../DeIcon.vue";

const props = defineProps<{ script: LabScript | null }>();
const emit = defineEmits<{ close: [] }>();

type Tab = "script" | "orig" | "taken";

const dlg = ref<HTMLDialogElement | null>(null);
const tab = ref<Tab>("script");
const view = ref<DiffView>("smart");
const source = ref<string | null>(null);
const diffs = ref<Partial<Record<"orig" | "taken", LabDiff>>>({});
const loading = ref(false);
const error = ref<string | null>(null);

const from = computed(() => props.script?.bumped?.from ?? null);
const takenId = computed(() =>
  props.script && from.value ? props.script.bumped?.collidedWith ?? `${familyOf(props.script)}@${from.value}` : null,
);

const tabs = computed(() => {
  const out: { id: Tab; label: string }[] = [{ id: "script", label: "Script" }];
  if (from.value) {
    out.push({ id: "orig", label: "vs your upload" });
    out.push({ id: "taken", label: `vs ${takenId.value}` });
  }
  return out;
});

let seq = 0;
async function load() {
  const s = props.script;
  if (!s) return;
  const mine = ++seq;
  error.value = null;
  const t = tab.value;
  if (t === "script" ? source.value !== null : diffs.value[t]) return;
  loading.value = true;
  try {
    if (t === "script") {
      const text = await fetchLabScriptSource(s.id);
      if (mine === seq) source.value = text;
    } else {
      const d = await fetchLabScriptDiff(s.id, t === "orig" ? "original" : takenId.value!);
      if (mine === seq) diffs.value = { ...diffs.value, [t]: d };
    }
  } catch (e) {
    if (mine === seq) error.value = labErrorMessage(e, "Could not load the script");
  } finally {
    if (mine === seq) loading.value = false;
  }
}

watch(
  () => props.script,
  async (s) => {
    tab.value = "script";
    view.value = "smart";
    source.value = null;
    diffs.value = {};
    error.value = null;
    if (!s) {
      if (dlg.value?.open) dlg.value.close();
      return;
    }
    await nextTick();
    const el = dlg.value;
    if (el && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    }
    void load();
  },
);
watch(tab, () => void load());

const diff = computed(() => (tab.value === "script" ? null : diffs.value[tab.value] ?? null));
const rows = computed<ViewRow[]>(() => {
  if (!diff.value) return [];
  return view.value === "smart" ? smartDiff(diff.value.rows) : diff.value.rows;
});
const split = computed(() => (view.value === "split" ? splitRows(rows.value) : []));
const sourceLines = computed(() => (source.value ?? "").replace(/\n$/, "").split("\n"));

const note = computed(() => {
  if (tab.value === "script") return "The stored script, exactly as runs use it. Download or Copy code from the row gives the same file.";
  const smart = view.value === "smart" ? " Smart view hides unchanged lines and whitespace-only edits." : "";
  if (tab.value === "orig") {
    const c = diff.value ? changeCount(diff.value.rows) : null;
    const what = c && c.added <= 1 && c.removed <= 1 ? " Only the header changed when it was bumped." : "";
    return `Your upload said v${from.value}.${what}${smart}`;
  }
  return `What this script changes compared with ${takenId.value}, the code that already held v${from.value}.${smart}`;
});

const mark = (op: string) => (op === "add" ? "+" : op === "del" ? "−" : op === "gap" ? "" : " ");

function onClose() {
  emit("close");
}
</script>

<template>
  <dialog
    ref="dlg"
    class="lab-dialog"
    aria-labelledby="lab-dlg-title"
    @close="onClose"
  >
    <div
      v-if="script"
      class="lab-dialog__head"
    >
      <h2
        id="lab-dlg-title"
        class="lab-dialog__title"
      >
        {{ script.id }}
      </h2>
      <div
        class="lab-segs"
        role="group"
        aria-label="Compare with"
      >
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          :aria-pressed="tab === t.id"
          :data-tab="t.id"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <div
        v-if="tab !== 'script'"
        class="lab-segs"
        role="group"
        aria-label="Diff view"
      >
        <button
          v-for="v in (['smart', 'unified', 'split'] as const)"
          :key="v"
          type="button"
          :aria-pressed="view === v"
          :data-view="v"
          @click="view = v"
        >
          {{ v === "smart" ? "Smart" : v === "unified" ? "Unified" : "Split" }}
        </button>
      </div>
      <button
        type="button"
        class="lab-icon"
        aria-label="Close"
        title="Close"
        @click="dlg?.close()"
      >
        <DeIcon
          name="x"
          :size="16"
        />
      </button>
    </div>
    <div
      v-if="script"
      class="lab-dialog__body"
    >
      <p
        class="lab-meta"
        data-test="dlg-note"
        style="margin: 0"
      >
        {{ note }}
      </p>
      <p
        v-if="error"
        role="alert"
        class="lab-error"
      >
        {{ error }}
      </p>
      <p
        v-else-if="loading"
        class="lab-meta"
      >
        Loading…
      </p>
      <div
        v-else-if="tab === 'script'"
        class="lab-diff"
        data-test="dlg-source"
      >
        <div
          v-for="(l, i) in sourceLines"
          :key="i"
          v-text="l"
        />
      </div>
      <div
        v-else-if="view === 'split'"
        class="lab-diff lab-diff--split"
        data-test="dlg-diff"
      >
        <template
          v-for="(p, i) in split"
          :key="i"
        >
          <div
            :class="p.left.op"
            v-text="p.left.text"
          />
          <div
            :class="p.right.op"
            v-text="p.right.text"
          />
        </template>
      </div>
      <div
        v-else
        class="lab-diff"
        data-test="dlg-diff"
      >
        <div
          v-for="(r, i) in rows"
          :key="i"
          :class="r.op"
          v-text="`${mark(r.op)} ${r.text}`"
        />
        <div
          v-if="diff && !rows.length"
          class="gap"
        >
          No differences.
        </div>
      </div>
    </div>
  </dialog>
</template>
