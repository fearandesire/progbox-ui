<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import DeIcon from "../components/DeIcon.vue";
import Toast from "../components/Toast.vue";
import LabScriptDialog from "../components/lab/LabScriptDialog.vue";
import LabSubnav from "../components/lab/LabSubnav.vue";
import "../components/lab/lab.css";
import {
  addLabScript,
  deleteLabScript,
  fetchLabScriptSource,
  fetchLabScripts,
  labErrorMessage,
  labScriptSourceUrl,
  restoreLabScript,
} from "../lib/api";
import { copyText } from "../lib/labFormat";
import {
  ROLE_NAME,
  ROLE_TIP,
  bumpTip,
  familyLabel,
  familyOf,
  isBuiltin,
  isProgScript,
  matchesScript,
  runsText,
  tableOrder,
  uploadedAt,
  uploadedText,
  type StatusFilter,
} from "../lib/labScripts";
import type { LabScript } from "../lib/labTypes";

const router = useRouter();

const scripts = ref<LabScript[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const query = ref("");
const status = ref<StatusFilter>("all");
const selected = ref<Set<string>>(new Set());
const openId = ref<string | null>(null);
const confirmId = ref<string | null>(null);
const alsoRuns = ref(false);
const deleting = ref(false);
const uploading = ref(false);
const dialogScript = ref<LabScript | null>(null);

const toast = ref<{ message: string; undo?: () => void } | null>(null);
const toastShow = ref(false);
function say(message: string, undo?: () => void) {
  toastShow.value = false;
  toast.value = { message, undo };
  // Re-trigger the Toast timer even when a toast is already up.
  queueMicrotask(() => (toastShow.value = true));
}

async function load() {
  try {
    scripts.value = await fetchLabScripts();
    error.value = null;
  } catch (e) {
    error.value = labErrorMessage(e, "Could not load the scripts");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const ordered = computed(() => tableOrder(scripts.value));
const familyCounts = computed(() => {
  const m = new Map<string, number>();
  for (const s of scripts.value) m.set(familyOf(s), (m.get(familyOf(s)) ?? 0) + 1);
  return m;
});
const visible = computed(() => ordered.value.filter((s) => matchesScript(s, query.value, status.value)));

type Line = { kind: "fam"; family: string; label: string } | { kind: "row"; s: LabScript };
const lines = computed<Line[]>(() => {
  const out: Line[] = [];
  let fam: string | null = null;
  for (const s of visible.value) {
    const f = familyOf(s);
    if (f !== fam) {
      fam = f;
      out.push({ kind: "fam", family: f, label: familyLabel(f, familyCounts.value.get(f) ?? 0) });
    }
    out.push({ kind: "row", s });
  }
  return out;
});

const canDelete = (s: LabScript) => s.role === "draft" && !isBuiltin(s);
const lockedWhy = (s: LabScript) => (isBuiltin(s) ? "Built-in scripts can't be deleted" : "Change its status to Draft before deleting");
const roleTip = (s: LabScript) =>
  s.role === "candidate" ? `The pending release: the ${s.id.split("@")[1] ?? s.id} prerelease on GitHub, next in line to ship. Locked.` : ROLE_TIP[s.role];
const runsOf = (s: LabScript) => s.runs ?? 0;

const visibleDrafts = computed(() => visible.value.filter(canDelete).map((s) => s.id));
const allChecked = computed(() => visibleDrafts.value.length > 0 && visibleDrafts.value.every((id) => selected.value.has(id)));
function toggle(id: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(id);
  else next.delete(id);
  selected.value = next;
}
function toggleAll(on: boolean) {
  const next = new Set(selected.value);
  for (const id of visibleDrafts.value) {
    if (on) next.add(id);
    else next.delete(id);
  }
  selected.value = next;
}

function runTest(s: LabScript) {
  if (s.role === "draft") void router.push({ path: "/lab", query: { script: s.id } });
  else void router.push({ path: "/lab", query: { baseline: s.id } });
}
const runTip = (s: LabScript) => (s.role === "draft" ? "Run test with this script" : "Run a test compared against this release");

async function copyCode(s: LabScript) {
  try {
    const text = await fetchLabScriptSource(s.id);
    say((await copyText(text)) ? `Code of ${s.id} copied.` : "Couldn't reach the clipboard. Download the file instead.");
  } catch (e) {
    say(labErrorMessage(e, "Could not load the script"));
  }
}
async function copyId(id: string) {
  say((await copyText(id)) ? `${id} copied.` : "Couldn't reach the clipboard. Select the id instead.");
}

function askDelete(id: string) {
  confirmId.value = confirmId.value === id ? null : id;
  alsoRuns.value = false;
}

async function remove(ids: string[], withRuns: boolean) {
  if (!ids.length) return;
  deleting.value = true;
  const done: string[] = [];
  try {
    for (const id of ids) {
      await deleteLabScript(id, withRuns);
      done.push(id);
    }
  } catch (e) {
    say(labErrorMessage(e, "Could not delete the script"));
  } finally {
    deleting.value = false;
  }
  if (!done.length) return;
  scripts.value = scripts.value.filter((s) => !done.includes(s.id));
  const next = new Set(selected.value);
  done.forEach((id) => next.delete(id));
  selected.value = next;
  confirmId.value = null;
  if (done.includes(openId.value ?? "")) openId.value = null;
  const msg = done.length > 1 ? `Deleted ${done.length} drafts. They stay in the trash for 7 days.` : `Deleted ${done[0]}. It stays in the trash for 7 days.`;
  say(msg, () => void undo(done));
}

async function undo(ids: string[]) {
  toastShow.value = false;
  try {
    for (const id of ids) await restoreLabScript(id);
    await load();
    say(ids.length > 1 ? `Restored ${ids.length} drafts.` : `Restored ${ids[0]}.`);
  } catch (e) {
    await load();
    say(labErrorMessage(e, "Could not restore"));
  }
}

const fileInput = ref<HTMLInputElement | null>(null);
async function onUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = "";
  if (!f) return;
  uploading.value = true;
  try {
    const res = await addLabScript({ source: await f.text(), filename: f.name, family: "net" });
    await load();
    const bumped = res.notes.some((n) => n.startsWith("Version forced up"));
    say(!res.created ? `Same code as ${res.entry.id}, so that id is reused.` : bumped ? `Saved as ${res.entry.id}. Its version was bumped.` : `Saved as ${res.entry.id}.`);
  } catch (err) {
    say(labErrorMessage(err, "Could not upload the script"));
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="page lab-scripts">
    <LabSubnav current="scripts" />

    <div class="section-head lab-head">
      <div>
        <h1 class="page-title">
          Scripts
        </h1>
        <p class="page-desc">
          Manage your scripts and versions.
        </p>
      </div>
      <button
        type="button"
        class="btn primary lab-press"
        data-test="upload"
        :disabled="uploading"
        @click="fileInput?.click()"
      >
        <DeIcon name="upload" />
        {{ uploading ? "Uploading…" : "Upload script" }}
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".js,.mjs,.txt"
        hidden
        data-test="upload-input"
        @change="onUpload"
      >
    </div>

    <p
      v-if="error"
      role="alert"
      class="lab-error"
    >
      {{ error }}
    </p>
    <p
      v-else-if="loading"
      class="page-desc"
    >
      Loading…
    </p>

    <section
      v-else
      class="panel table-panel"
      aria-label="Script versions"
    >
      <div class="table-toolbar">
        <input
          v-model="query"
          class="input"
          type="search"
          placeholder="Search version or file name"
          aria-label="Search scripts"
          data-test="search"
        >
        <select
          v-model="status"
          class="select input"
          aria-label="Filter by status"
          data-test="status"
        >
          <option value="all">
            All statuses
          </option>
          <option value="draft">
            Drafts only
          </option>
          <option value="official">
            Published and next release
          </option>
        </select>
      </div>
      <div
        v-if="selected.size"
        class="lab-bulk"
        data-test="bulk"
      >
        <span>{{ selected.size }} draft{{ selected.size === 1 ? "" : "s" }} selected</span>
        <button
          type="button"
          class="btn danger solid lab-press"
          :disabled="deleting"
          data-test="bulk-delete"
          @click="remove([...selected], false)"
        >
          Delete selected
        </button>
        <button
          type="button"
          class="btn ghost lab-press"
          @click="selected = new Set()"
        >
          Clear
        </button>
      </div>
      <div class="table-scroll">
        <table
          class="lab-stbl"
          data-test="scripts"
        >
          <thead>
            <tr>
              <th style="width: 32px">
                <input
                  type="checkbox"
                  aria-label="Select all drafts"
                  :checked="allChecked"
                  :disabled="!visibleDrafts.length"
                  data-test="select-all"
                  @change="toggleAll(($event.target as HTMLInputElement).checked)"
                >
              </th>
              <th>Version</th>
              <th>Status</th>
              <th class="lab-col-up">
                Uploaded
              </th>
              <th class="num">
                Runs
              </th>
              <th style="text-align: right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!lines.length">
              <td
                colspan="6"
                class="lab-empty-row"
              >
                No versions match. Clear the search, or upload a script.
              </td>
            </tr>
            <template
              v-for="l in lines"
              :key="l.kind === 'fam' ? `fam:${l.family}` : l.s.id"
            >
              <tr
                v-if="l.kind === 'fam'"
                class="fam"
              >
                <td colspan="6">
                  {{ l.label }}
                </td>
              </tr>
              <template v-else>
                <tr
                  class="row"
                  :data-id="l.s.id"
                >
                  <td>
                    <input
                      v-if="canDelete(l.s)"
                      type="checkbox"
                      :checked="selected.has(l.s.id)"
                      :aria-label="`Select ${l.s.id}`"
                      data-test="select"
                      @change="toggle(l.s.id, ($event.target as HTMLInputElement).checked)"
                    >
                  </td>
                  <td>
                    <div class="lab-sid">
                      {{ l.s.id }}
                    </div>
                    <button
                      v-if="l.s.bumped"
                      type="button"
                      class="lab-bumped"
                      :title="bumpTip(l.s)"
                      data-test="bumped"
                      @click="dialogScript = l.s"
                    >
                      <DeIcon
                        name="arrow-up"
                        :size="13"
                      /> Bumped
                    </button>
                  </td>
                  <td>
                    <span
                      class="lab-st"
                      :class="l.s.role"
                      :title="roleTip(l.s)"
                      data-test="status-cell"
                    >{{ ROLE_NAME[l.s.role] }}</span>
                  </td>
                  <td class="lab-meta lab-col-up">
                    {{ uploadedText(uploadedAt(l.s)) }}
                  </td>
                  <td class="num">
                    {{ runsOf(l.s) }}
                  </td>
                  <td>
                    <div class="lab-acts">
                      <button
                        type="button"
                        class="lab-icon"
                        :title="isProgScript(l.s) ? runTip(l.s) : 'The hook runs with every test'"
                        :aria-label="`${isProgScript(l.s) ? runTip(l.s) : 'Run test'}: ${l.s.id}`"
                        :disabled="!isProgScript(l.s)"
                        data-test="run"
                        @click="runTest(l.s)"
                      >
                        <DeIcon
                          name="play"
                          :size="16"
                        />
                      </button>
                      <a
                        class="lab-icon"
                        :href="labScriptSourceUrl(l.s.id)"
                        :download="`${l.s.id}.js`"
                        title="Download .js"
                        :aria-label="`Download ${l.s.id}`"
                      >
                        <DeIcon
                          name="download"
                          :size="16"
                        />
                      </a>
                      <button
                        type="button"
                        class="lab-icon"
                        title="Copy code"
                        :aria-label="`Copy code of ${l.s.id}`"
                        data-test="copy"
                        @click="copyCode(l.s)"
                      >
                        <DeIcon
                          name="copy"
                          :size="16"
                        />
                      </button>
                      <button
                        v-if="canDelete(l.s)"
                        type="button"
                        class="lab-icon del"
                        title="Delete"
                        :aria-label="`Delete ${l.s.id}`"
                        :aria-expanded="confirmId === l.s.id"
                        data-test="delete"
                        @click="askDelete(l.s.id)"
                      >
                        <DeIcon
                          name="trash"
                          :size="16"
                        />
                      </button>
                      <button
                        v-else
                        type="button"
                        class="lab-icon"
                        disabled
                        :title="lockedWhy(l.s)"
                        :aria-label="lockedWhy(l.s)"
                        data-test="locked"
                      >
                        <DeIcon
                          name="lock"
                          :size="16"
                        />
                      </button>
                      <button
                        type="button"
                        class="lab-icon"
                        title="Details"
                        :aria-label="`Details for ${l.s.id}`"
                        :aria-expanded="openId === l.s.id"
                        data-test="details"
                        @click="openId = openId === l.s.id ? null : l.s.id"
                      >
                        <DeIcon
                          name="chevron-down"
                          :size="16"
                        />
                      </button>
                    </div>
                  </td>
                </tr>
                <tr
                  v-if="confirmId === l.s.id"
                  class="confirm"
                  data-test="confirm"
                >
                  <td />
                  <td colspan="5">
                    <div class="lab-confirm">
                      <b>Delete {{ l.s.id }}?</b>
                      <span>
                        It moves to the trash for 7 days, and the id is never reused for other code.
                        {{ runsOf(l.s) ? `Its ${runsText(runsOf(l.s))} keep their reports.` : "It has no runs." }}
                      </span>
                      <label
                        v-if="runsOf(l.s)"
                        class="lab-inline"
                      >
                        <input
                          v-model="alsoRuns"
                          type="checkbox"
                          data-test="also-runs"
                        >
                        Also delete its {{ runsText(runsOf(l.s)) }}
                      </label>
                      <div class="lab-row-actions">
                        <button
                          type="button"
                          class="btn danger solid lab-press"
                          :disabled="deleting"
                          data-test="confirm-delete"
                          @click="remove([l.s.id], alsoRuns)"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          class="btn ghost lab-press"
                          @click="confirmId = null"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr
                  v-if="openId === l.s.id"
                  class="detail"
                  data-test="detail"
                >
                  <td />
                  <td colspan="5">
                    <div class="lab-dgrid">
                      <dl class="lab-kv mono">
                        <dt>Id</dt>
                        <dd>{{ l.s.id }}</dd>
                        <dt>SHA-256</dt>
                        <dd :title="l.s.sha256">
                          {{ l.s.sha256.slice(0, 8) }}…
                        </dd>
                        <template v-if="isBuiltin(l.s)">
                          <dt>Source</dt>
                          <dd>{{ l.s.source }}</dd>
                        </template>
                        <template v-else>
                          <dt>Uploaded file</dt>
                          <dd>{{ l.s.uploadedFile ?? "–" }}</dd>
                        </template>
                        <template v-if="l.s.bumped">
                          <dt>Bumped</dt>
                          <dd class="lab-detail-text">
                            {{ l.s.uploadedFile ?? "The upload" }} said v{{ l.s.bumped.from }}, which already holds other code.
                            <button
                              type="button"
                              class="btn ghost lab-press"
                              @click="dialogScript = l.s"
                            >
                              See script and diff
                            </button>
                          </dd>
                          <dt>Original upload</dt>
                          <dd>
                            <a
                              class="btn ghost lab-press"
                              :href="labScriptSourceUrl(l.s.id, true)"
                              :download="l.s.uploadedFile ?? `${l.s.id}.original.js`"
                            >
                              <DeIcon name="download" /> Download original
                            </a>
                          </dd>
                        </template>
                        <dt>Runs</dt>
                        <dd>
                          <RouterLink
                            v-if="runsOf(l.s)"
                            :to="{ path: '/lab/history', query: { script: l.s.id } }"
                          >
                            {{ runsText(runsOf(l.s)) }} in History
                          </RouterLink>
                          <template v-else>
                            none yet
                          </template>
                        </dd>
                        <dt>Copy id</dt>
                        <dd>
                          <button
                            type="button"
                            class="btn ghost lab-press"
                            @click="copyId(l.s.id)"
                          >
                            <DeIcon name="copy" /> {{ l.s.id }}
                          </button>
                        </dd>
                      </dl>
                      <pre v-if="l.s.header">{{ l.s.header }}
…</pre>
                    </div>
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <LabScriptDialog
      :script="dialogScript"
      @close="dialogScript = null"
    />
    <Toast
      :message="toast?.message ?? ''"
      :show="toastShow"
      :duration="toast?.undo ? 10000 : 2600"
      :action="toast?.undo ? 'Undo' : undefined"
      @close="toastShow = false"
      @action="toast?.undo?.()"
    />
  </div>
</template>
