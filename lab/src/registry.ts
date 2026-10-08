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
};
type Index = { entries: Entry[] };

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

export class Registry {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private get indexFile() {
    return path.join(this.dir, "index.json");
  }

  list(): Entry[] {
    if (!fs.existsSync(this.indexFile)) return [];
    return (JSON.parse(fs.readFileSync(this.indexFile, "utf8")) as Index).entries;
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
    const entries = this.list();
    const digest = sha(source);
    const notes: string[] = [];
    const existing = entries.find((e) => e.sha256 === digest || e.bumped?.originalSha256 === digest);
    if (existing) return { entry: existing, created: false, notes: [`Same code as ${existing.id}; reusing it.`] };

    const family = slug(opts.family ?? "net");
    const declared = opts.version ?? declaredVersion(source);
    const familyEntries = entries.filter((e) => e.family === family);
    const taken = new Set(familyEntries.map((e) => e.version));
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
    const entry: Entry = { id, family, version, role: opts.role ?? "draft", sha256: sha(stored), file, createdAt: new Date().toISOString(), source: opts.source ?? "upload", declared, note: opts.note, bumped };
    this.write([...entries, entry]);
    notes.unshift(`Saved as ${id}.`);
    return { entry, created: true, notes };
  }

  /** Change a version's role (draft → candidate → published). Code never changes. */
  promote(id: string, role: Role): Entry {
    const entries = this.list();
    const e = entries.find((x) => x.id === id);
    if (!e) throw new Error(`unknown script ${id}`);
    e.role = role;
    this.write(entries);
    return e;
  }

  private write(entries: Entry[]) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2));
    fs.renameSync(tmp, this.indexFile);
  }
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
