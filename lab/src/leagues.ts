import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LEAGUES_DIR, REPO_DIR } from "./paths.ts";
import { boundaryFrom, type Boundary } from "./league.ts";
import { validateLeague, type Validation } from "./validate.ts";

/**
 * League catalog. Built-in leagues are fetched by URL and pinned by SHA-256
 * (their files are never committed); uploads are stored by content hash.
 */
export type LeagueInfo = {
  id: string;
  name: string;
  source: string;
  credit?: string;
  url?: string;
  sha256?: string;
  file: string;
  isDefault?: boolean;
  available: boolean;
};

const BUILTIN: Omit<LeagueInfo, "available">[] = [
  {
    id: "nba-2025-26",
    name: "Real NBA 2025-26, Opening Night (2024-25 stats)",
    source: "alexnoob/BasketBall-GM-Rosters release 2026.0.5",
    credit: "Real-player roster by alexnoob (github.com/alexnoob/BasketBall-GM-Rosters)",
    url: "https://github.com/alexnoob/BasketBall-GM-Rosters/releases/download/2026.0.5/2025-26.NBA.Roster.json",
    sha256: "3b06880e3aeaefa01ccb96f8ae38b51dc2069ad555146ebc5d61925a8c06256d",
    file: "nba-2025-26.json",
    isDefault: true,
  },
  {
    id: "progbox-2017",
    name: "progbox default export (2017 regular season)",
    source: "data/export.json in this repo",
    file: path.join(REPO_DIR, "data/export.json"),
  },
];

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const fileFor = (l: { file: string }) => (path.isAbsolute(l.file) ? l.file : path.join(LEAGUES_DIR, l.file));

export function listLeagues(): LeagueInfo[] {
  const builtin = BUILTIN.map((l) => ({ ...l, available: fs.existsSync(fileFor(l)) }));
  const uploadsIndex = path.join(LEAGUES_DIR, "uploads.json");
  const uploads: LeagueInfo[] = fs.existsSync(uploadsIndex) ? JSON.parse(fs.readFileSync(uploadsIndex, "utf8")) : [];
  return [...builtin, ...uploads.map((u) => ({ ...u, available: fs.existsSync(fileFor(u)) }))];
}

export const DEFAULT_LEAGUE = BUILTIN.find((l) => l.isDefault)!.id;

/** Download any missing built-in league and check its pin. */
export async function fetchLeagues(log: (s: string) => void = () => {}): Promise<void> {
  fs.mkdirSync(LEAGUES_DIR, { recursive: true });
  for (const l of BUILTIN) {
    if (!l.url || fs.existsSync(fileFor(l))) continue;
    log(`Downloading ${l.name} from ${l.url}`);
    const res = await fetch(l.url);
    if (!res.ok) throw new Error(`download failed for ${l.id}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== l.sha256) throw new Error(`${l.id} hash mismatch: expected ${l.sha256}, got ${sha(buf)}`);
    fs.writeFileSync(fileFor(l), buf);
  }
}

/** Store an uploaded export by content hash; same file twice gives the same id. */
export function addLeague(buf: Buffer, name: string): LeagueInfo {
  const digest = sha(buf);
  const id = `upload-${digest.slice(0, 12)}`;
  const index = path.join(LEAGUES_DIR, "uploads.json");
  const uploads: LeagueInfo[] = fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, "utf8")) : [];
  const found = uploads.find((u) => u.id === id);
  if (found) return { ...found, available: true };
  fs.mkdirSync(LEAGUES_DIR, { recursive: true });
  fs.writeFileSync(path.join(LEAGUES_DIR, `${id}.json`), buf);
  const entry: LeagueInfo = { id, name, source: "upload", sha256: digest, file: `${id}.json`, available: true };
  fs.writeFileSync(index, JSON.stringify([...uploads, entry], null, 2));
  return entry;
}

export type PreparedLeague = { info: LeagueInfo; boundary: Boundary; validation: Validation; data: Record<string, any> };

/** Resolve a league id or file path, validate it, apply fixes, and build the boundary. */
export function prepareLeague(ref: string): PreparedLeague {
  const known = listLeagues().find((l) => l.id === ref);
  const file = known ? fileFor(known) : path.resolve(ref);
  if (!fs.existsSync(file)) {
    throw new Error(known?.url ? `League ${ref} isn't downloaded yet. Run: pnpm lab leagues fetch` : `League not found: ${ref}`);
  }
  const buf = fs.readFileSync(file);
  const digest = sha(buf);
  if (known?.sha256 && digest !== known.sha256) throw new Error(`${ref} changed on disk (hash ${digest.slice(0, 12)}); delete it and run pnpm lab leagues fetch`);
  const data = JSON.parse(buf.toString("utf8"));
  const validation = validateLeague(data);
  const info: LeagueInfo = known ?? { id: `file-${digest.slice(0, 12)}`, name: path.basename(file), source: file, sha256: digest, file, available: true };
  if (!validation.ok) return { info, validation, data, boundary: undefined as unknown as Boundary };
  const boundary = boundaryFrom({ data, sha256: digest });
  return { info, boundary, validation, data };
}
