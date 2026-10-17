import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Script registry with forced versioning. Every script that enters NET Lab gets
 * a family name and an immutable version id, e.g. `net@4.4.0-draft.3`:
 * - identical code (same SHA-256) always resolves to the version it already has;
 * - a version id never points at different code;
 * - a header like `| v4.4.0` names the version; without one, the script becomes
 *   the next draft of the family's latest version;
 * - when the named version already holds other code, the version is forced up to
 *   the next free patch (v4.3.0 → v4.3.1). The stored copy's header is rewritten to
 *   match, the upload is kept unchanged beside it, and the entry records both.
 */
export type Role = "draft" | "candidate" | "published";
export type Entry = {
  id: string;
  family: string;
  version: string;
  role: Role;
  sha256: string;
  file: string;
  createdAt: string;
  source: string;
  declared: string | null;
  note?: string;
  /** Set when the header's version was taken by other code and was forced up. */
  bumped?: { from: string; to: string; originalSha256: string; originalFile: string };
  /** Set when a deleted id came back (restore, or the same code uploaded again). */
  restoredAt?: string;
};
/** A deleted draft: its files sit in the trash until `until`, then they're purged. */
export type TrashItem = { entry: Entry; deletedAt: string; until: string; runs: string[] };
/** A deleted id. It is never given to different code; the same code brings it back. */
export type Tombstone = { id: string; sha256: string; originalSha256: string | null; deletedAt: string; entry: Entry };
type Index = { entries: Entry[]; trash?: TrashItem[]; tombstones?: Tombstone[] };

export const TRASH_DAYS = 7;

/** Registry errors carry an HTTP-like status so the CLI and API can tell "locked" from "missing". */
export class RegistryError extends Error {
  readonly status: 404 | 409 | 422;
  constructor(message: string, status: 404 | 409 | 422) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const VERSION_RE = [/(?:\|\s*|\bversion\s*)v?(\d+\.\d+(?:\.\d+)?)/i, /\bv(\d+\.\d+(?:\.\d+)?)\b/];

function versionMatch(source: string): { text: string; at: number } | null {
  const head = source.slice(0, 2000);
  for (const re of VERSION_RE) {
    const m = head.match(re);
    if (m) return { text: m[1]!, at: m.index! + m[0].lastIndexOf(m[1]!) };
  }
  return null;
}

/** `| v4.3.0`, `v4.3`, `version 4.4.1` in the first comment block. */
export function declaredVersion(source: string): string | null {
  const m = versionMatch(source);
  if (!m) return null;
  const parts = m.text.split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}

/** The source with its header version replaced, or a header line added when it has none. */
export function withVersion(source: string, version: string): string {
  const m = versionMatch(source);
  if (!m) return `// NET Lab version: v${version}\n${source}`;
  return source.slice(0, m.at) + version + source.slice(m.at + m.text.length);
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/\.(m?js|txt)$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "script";
}

const semverKey = (v: string) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? x.padStart(6, "0") : x)).join(".");

export type RegistryOptions = {
  /** Where deleted drafts wait before they're purged (default: <dir>/.trash). */
  trashDir?: string;
  /** Run folders, so a delete can take a script's runs with it (each holds status.json). */
  runsDir?: string;
  now?: () => Date;
};

export class Registry {
  readonly dir: string;
  readonly trashDir: string;
  readonly runsDir: string | undefined;
  private readonly now: () => Date;
  constructor(dir: string, opts: RegistryOptions = {}) {
    this.dir = dir;
    this.trashDir = opts.trashDir ?? path.join(dir, ".trash");
    this.runsDir = opts.runsDir;
    this.now = opts.now ?? (() => new Date());
  }

  private get indexFile() {
    return path.join(this.dir, "index.json");
  }

  private index(): Required<Index> {
    if (!fs.existsSync(this.indexFile)) return { entries: [], trash: [], tombstones: [] };
    const idx = JSON.parse(fs.readFileSync(this.indexFile, "utf8")) as Index;
    return { entries: idx.entries, trash: idx.trash ?? [], tombstones: idx.tombstones ?? [] };
  }

  list(): Entry[] {
    return this.index().entries;
  }

  trashed(): TrashItem[] {
    return this.index().trash;
  }

  tombstones(): Tombstone[] {
    return this.index().tombstones;
  }

  get(id: string): Entry | undefined {
    return this.list().find((e) => e.id === id);
  }

  read(e: Entry): string {
    return fs.readFileSync(path.join(this.dir, e.file), "utf8");
  }

  /**
   * Add a script. `family` defaults to "net". Returns the entry plus whether it
   * was new; identical code returns the existing entry unchanged.
   */
  add(source: string, opts: { family?: string; role?: Role; source?: string; note?: string; version?: string } = {}): { entry: Entry; created: boolean; notes: string[] } {
    const idx = this.index();
    const entries = idx.entries;
    const digest = sha(source);
    const notes: string[] = [];
    const same = (e: Entry) => e.sha256 === digest || e.bumped?.originalSha256 === digest;
    const existing = entries.find(same);
    if (existing) return { entry: existing, created: false, notes: [`Same code as ${existing.id}; reusing it.`] };
    const inTrash = idx.trash.find((t) => same(t.entry));
    if (inTrash) {
      const { entry } = this.restore(inTrash.entry.id);
      return { entry, created: false, notes: [`Same code as ${entry.id}, which was in the trash; restored it.`] };
    }
    const tomb = idx.tombstones.find((t) => same(t.entry));
    if (tomb) return { entry: this.revive(tomb, source), created: false, notes: [`Same code as the deleted ${tomb.id}; it gets that id back.`] };

    const family = slug(opts.family ?? "net");
    const declared = opts.version ?? declaredVersion(source);
    const familyEntries = entries.filter((e) => e.family === family);
    // Deleted ids stay taken so they never point at different code.
    const retired = [...idx.trash.map((t) => t.entry), ...idx.tombstones.map((t) => t.entry)].filter((e) => e.family === family);
    const taken = new Set([...familyEntries, ...retired].map((e) => e.version));
    const takenBases = new Set(familyEntries.map((e) => baseOf(e.version)));
    const draft = !(opts.role === "published" || opts.role === "candidate");
    let version: string;
    let stored = source;
    let bumpedTo: string | undefined;
    if (declared) {
      let base = declared;
      if (takenBases.has(base)) {
        while (takenBases.has(base)) base = nextPatch(base);
        bumpedTo = base;
        stored = withVersion(source, base);
      }
      version = draft ? nextDraft(base, taken) : base;
    } else {
      version = nextDraft(latestBase(family, entries) ?? "0.0.0", taken);
    }
    const id = `${family}@${version}`;
    const file = path.join(family, `${version}.js`);
    fs.mkdirSync(path.join(this.dir, family), { recursive: true });
    fs.writeFileSync(path.join(this.dir, file), stored, { flag: "wx" });
    let bumped: Entry["bumped"];
    if (bumpedTo && declared) {
      const originalFile = path.join(family, `${version}.original.js`);
      fs.writeFileSync(path.join(this.dir, originalFile), source, { flag: "wx" });
      bumped = { from: declared, to: bumpedTo, originalSha256: digest, originalFile };
      notes.push(`Version forced up: the header said v${declared}, but ${family}@${declared} already holds different code. This script is now v${bumpedTo}; its header was rewritten to match and your original upload is kept at ${originalFile}.`);
    }
    const entry: Entry = { id, family, version, role: opts.role ?? "draft", sha256: sha(stored), file, createdAt: this.now().toISOString(), source: opts.source ?? "upload", declared, note: opts.note, bumped };
    this.write({ ...idx, entries: [...entries, entry] });
    notes.unshift(`Saved as ${id}.`);
    return { entry, created: true, notes };
  }

  /** Change a version's role (draft → candidate → published). Code never changes. */
  promote(id: string, role: Role): Entry {
    const idx = this.index();
    const e = idx.entries.find((x) => x.id === id);
    if (!e) throw new RegistryError(`Unknown script ${id}.`, 404);
    if (e.source.startsWith("builtin:")) throw new RegistryError(`${id} is built in; its status is fixed.`, 409);
    e.role = role;
    this.write(idx);
    return e;
  }

  /** Runs whose tested script is `id` (status.json `script`), newest first. */
  runsOf(id: string): string[] {
    if (!this.runsDir || !fs.existsSync(this.runsDir)) return [];
    const out: string[] = [];
    for (const d of fs.readdirSync(this.runsDir)) {
      try {
        if (JSON.parse(fs.readFileSync(path.join(this.runsDir, d, "status.json"), "utf8")).script === id) out.push(d);
      } catch {
        /* not a run folder */
      }
    }
    return out.sort().reverse();
  }

  /**
   * Move a draft to the trash for TRASH_DAYS days. Candidate, published and built-in
   * scripts are locked (change their status first). The id is never reused for other code.
   */
  delete(id: string, opts: { runs?: boolean } = {}): { id: string; trashedUntil: string; runs: string[] } {
    const idx = this.index();
    const entry = idx.entries.find((e) => e.id === id);
    if (!entry) throw new RegistryError(idx.trash.some((t) => t.entry.id === id) ? `${id} is already in the trash.` : `Unknown script ${id}.`, 404);
    if (entry.source.startsWith("builtin:")) throw new RegistryError(`${id} is built in and can't be deleted.`, 409);
    if (entry.role !== "draft") throw new RegistryError(`${id} is ${entry.role === "candidate" ? "the next release" : "published"}; only drafts can be deleted. Change its status first.`, 409);
    for (const f of filesOf(entry)) move(path.join(this.dir, f), path.join(this.trashDir, "scripts", f));
    const runs = opts.runs && this.runsDir ? this.runsOf(id) : [];
    for (const r of runs) move(path.join(this.runsDir!, r), path.join(this.trashDir, "runs", r));
    const now = this.now();
    const until = new Date(now.getTime() + TRASH_DAYS * 86_400_000).toISOString();
    idx.entries = idx.entries.filter((e) => e !== entry);
    idx.trash.push({ entry, deletedAt: now.toISOString(), until, runs });
    idx.tombstones = idx.tombstones.filter((t) => t.id !== id);
    idx.tombstones.push({ id, sha256: entry.sha256, originalSha256: entry.bumped?.originalSha256 ?? null, deletedAt: now.toISOString(), entry });
    this.write(idx);
    return { id, trashedUntil: until, runs };
  }

  /** Undo a delete while the files are still in the trash. */
  restore(id: string): { entry: Entry; runs: string[] } {
    const idx = this.index();
    const item = idx.trash.find((t) => t.entry.id === id);
    if (!item) throw new RegistryError(idx.entries.some((e) => e.id === id) ? `${id} isn't deleted.` : `${id} isn't in the trash (it may have been purged; upload the same code to get the id back).`, 404);
    for (const f of filesOf(item.entry)) move(path.join(this.trashDir, "scripts", f), path.join(this.dir, f));
    const runs = this.runsDir ? item.runs.filter((r) => fs.existsSync(path.join(this.trashDir, "runs", r))) : [];
    for (const r of runs) move(path.join(this.trashDir, "runs", r), path.join(this.runsDir!, r));
    const entry = { ...item.entry, restoredAt: this.now().toISOString() };
    idx.trash = idx.trash.filter((t) => t !== item);
    idx.tombstones = idx.tombstones.filter((t) => t.id !== id);
    idx.entries.push(entry);
    this.write(idx);
    return { entry, runs };
  }

  /** Delete trash older than TRASH_DAYS for good. The ids stay tombstoned. */
  purge(): string[] {
    const idx = this.index();
    const now = this.now().getTime();
    const expired = idx.trash.filter((t) => Date.parse(t.until) <= now);
    if (!expired.length) return [];
    for (const t of expired) {
      for (const f of filesOf(t.entry)) fs.rmSync(path.join(this.trashDir, "scripts", f), { force: true });
      for (const r of t.runs) fs.rmSync(path.join(this.trashDir, "runs", r), { recursive: true, force: true });
    }
    idx.trash = idx.trash.filter((t) => !expired.includes(t));
    this.write(idx);
    return expired.map((t) => t.entry.id);
  }

  /** The exact stored file, or the original upload of a bumped version. */
  exportSource(id: string, original = false): { filename: string; text: string } {
    const e = this.get(id);
    if (!e) throw new RegistryError(`Unknown script ${id}.`, 404);
    if (!original) return { filename: `${id}.js`, text: this.read(e) };
    if (!e.bumped) throw new RegistryError(`${id} wasn't bumped, so the stored file is the upload.`, 404);
    return { filename: `${id}.original.js`, text: fs.readFileSync(path.join(this.dir, e.bumped.originalFile), "utf8") };
  }

  /** Bring a purged id back for the same code it held. */
  private revive(tomb: Tombstone, source: string): Entry {
    const idx = this.index();
    const e = tomb.entry;
    const stored = sha(source) === e.sha256 ? source : withVersion(source, e.bumped!.to);
    fs.mkdirSync(path.dirname(path.join(this.dir, e.file)), { recursive: true });
    fs.writeFileSync(path.join(this.dir, e.file), stored);
    if (e.bumped) fs.writeFileSync(path.join(this.dir, e.bumped.originalFile), sha(source) === e.bumped.originalSha256 ? source : stored);
    const entry = { ...e, restoredAt: this.now().toISOString() };
    idx.tombstones = idx.tombstones.filter((t) => t !== tomb && t.id !== tomb.id);
    idx.entries.push(entry);
    this.write(idx);
    return entry;
  }

  private write(idx: Index) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexFile}.${process.pid}.tmp`;
    const body: Index = { entries: idx.entries };
    if (idx.trash?.length) body.trash = idx.trash;
    if (idx.tombstones?.length) body.tombstones = idx.tombstones;
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
    fs.renameSync(tmp, this.indexFile);
  }
}

const filesOf = (e: Entry) => [e.file, ...(e.bumped ? [e.bumped.originalFile] : [])];

function move(from: string, to: string) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
}

const baseOf = (version: string) => version.replace(/-draft\.\d+$/, "");

function nextPatch(version: string): string {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch! + 1}`;
}

function nextDraft(base: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${base}-draft.${n}`)) n++;
  return `${base}-draft.${n}`;
}

function latestBase(family: string, entries: Entry[]): string | undefined {
  const bases = entries.filter((e) => e.family === family).map((e) => baseOf(e.version));
  return bases.sort((a, b) => semverKey(a).localeCompare(semverKey(b))).at(-1);
}
