import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Script registry with forced versioning. Every script that enters NET Lab gets
 * a family name and an immutable version id, e.g. `net@4.4.0-draft.3`:
 * - identical code (same SHA-256) always resolves to the version it already has;
 * - a version id never points at different code;
 * - a header like `| v4.4.0` names the version; without one, or when that
 *   version already holds other code, the script becomes the next draft.
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
};
type Index = { entries: Entry[] };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** `| v4.3.0`, `v4.3`, `version 4.4.1` in the first comment block. */
export function declaredVersion(source: string): string | null {
  const head = source.slice(0, 2000);
  const m = head.match(/(?:\|\s*|\bversion\s*)v?(\d+\.\d+(?:\.\d+)?)/i) ?? head.match(/\bv(\d+\.\d+(?:\.\d+)?)\b/);
  if (!m) return null;
  const parts = m[1]!.split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
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
    const existing = entries.find((e) => e.sha256 === digest);
    if (existing) return { entry: existing, created: false, notes: [`Same code as ${existing.id}; reusing it.`] };

    const family = slug(opts.family ?? "net");
    const declared = opts.version ?? declaredVersion(source);
    const taken = new Set(entries.filter((e) => e.family === family).map((e) => e.version));
    let version: string;
    if (declared && !taken.has(declared)) {
      version = opts.role === "published" || opts.role === "candidate" ? declared : `${declared}-draft.1`;
      if (taken.has(version)) version = nextDraft(declared, taken);
    } else {
      const base = declared ?? latestBase(family, entries) ?? "0.0.0";
      if (declared) notes.push(`Header says v${declared}, but that version already holds different code, so this is a draft of it.`);
      version = nextDraft(base, taken);
    }
    const id = `${family}@${version}`;
    const file = path.join(family, `${version}.js`);
    fs.mkdirSync(path.join(this.dir, family), { recursive: true });
    fs.writeFileSync(path.join(this.dir, file), source, { flag: "wx" });
    const entry: Entry = { id, family, version, role: opts.role ?? "draft", sha256: digest, file, createdAt: new Date().toISOString(), source: opts.source ?? "upload", declared, note: opts.note };
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

function nextDraft(base: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${base}-draft.${n}`)) n++;
  return `${base}-draft.${n}`;
}

function latestBase(family: string, entries: Entry[]): string | undefined {
  const bases = entries.filter((e) => e.family === family).map((e) => e.version.replace(/-draft\.\d+$/, ""));
  return bases.sort((a, b) => semverKey(a).localeCompare(semverKey(b))).at(-1);
}
