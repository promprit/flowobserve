import * as nodefs from "node:fs";
import { posix as path } from "node:path";
import { nameColor, toPosix } from "@fo/shared";

export { nameColor };

export interface FsLike {
  readdir(p: string): string[];
  isDir(p: string): boolean;
  exists(p: string): boolean;
  read(p: string): string | null;
  realpath(p: string): string | null;
}
export interface RunSpec { cmd: string[]; url: string | null }
export interface ScanFolder { abs: string; rel: string; worktree: string | null }
export interface ScanProject {
  key: string;
  name: string;
  group: string | null;
  color: string;
  peacock?: string;
  /** Colour without the user's pick; set only when a pick overrides it. */
  base?: string;
  abs: string;
  folders: ScanFolder[];
  run: RunSpec | null;
  plain?: boolean;
}
export interface Scan { rootMissing: boolean; projects: ScanProject[] }

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const realFs: FsLike = {
  readdir: (p) => safe(() => nodefs.readdirSync(p), []),
  isDir: (p) => safe(() => nodefs.statSync(p).isDirectory(), false),
  exists: (p) => safe(() => nodefs.existsSync(p), false),
  read: (p) => safe(() => nodefs.readFileSync(p, "utf8"), null),
  realpath: (p) => safe(() => nodefs.realpathSync(p), null),
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Strip JSONC outside strings: // and /* *\/ comments (an unclosed /* drops the rest) and trailing commas. */
function stripJsonc(src: string): string {
  const TOKEN = /"(?:[^"\\\n]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
  const noComments = src.replace(TOKEN, (t) => (t[0] === '"' ? t : ""));
  return noComments.replace(/"(?:[^"\\\n]|\\.)*"|,(?=\s*[}\]])/g, (t) => (t[0] === '"' ? t : ""));
}

/** Peacock colour from a VS Code settings.json body (JSONC tolerated). */
export function peacock(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = (JSON.parse(stripJsonc(json)) as Record<string, unknown> | null)?.["peacock.color"];
    return typeof v === "string" && HEX.test(v) ? v : null;
  } catch {
    return null;
  }
}

const URL_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}(\/\S*)?$/;

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** How to run a project: explicit .flowobserve/run, else package.json dev script by lockfile. */
export function runSpec(projectAbs: string, fs: FsLike = realFs): RunSpec | null {
  const explicit = fs.read(path.join(projectAbs, ".flowobserve", "run"));
  if (explicit !== null) {
    const j = parseJson(explicit) as { cmd?: unknown; url?: unknown } | undefined;
    if (!j || !Array.isArray(j.cmd) || j.cmd.length === 0) return null;
    if (!j.cmd.every((c) => typeof c === "string" && c.length > 0)) return null;
    const url = typeof j.url === "string" && URL_RE.test(j.url) ? j.url : null;
    return { cmd: j.cmd as string[], url };
  }
  const pkg = parseJson(fs.read(path.join(projectAbs, "package.json"))) as
    | { scripts?: { dev?: unknown } }
    | undefined;
  if (!pkg || typeof pkg.scripts?.dev !== "string") return null;
  if (fs.exists(path.join(projectAbs, "pnpm-lock.yaml"))) return { cmd: ["pnpm", "dev"], url: null };
  if (fs.exists(path.join(projectAbs, "package-lock.json"))) return { cmd: ["npm", "run", "dev"], url: null };
  return null;
}

const settingsColor = (abs: string, fs: FsLike) =>
  peacock(fs.read(path.join(abs, ".vscode", "settings.json")));

function worktreeFolders(root: string, abs: string, fs: FsLike): ScanFolder[] {
  const dir = path.join(abs, ".git", "worktrees");
  const out: ScanFolder[] = [];
  for (const name of fs.readdir(dir).sort()) {
    const raw = fs.read(path.join(dir, name, "gitdir"));
    if (!raw) continue;
    const gitfile = toPosix(raw.trim());
    if (!gitfile.endsWith("/.git")) continue;
    const wt = gitfile.slice(0, -"/.git".length);
    if (!wt.startsWith(root + "/") || !fs.isDir(wt)) continue;
    out.push({ abs: wt, rel: wt.slice(root.length + 1), worktree: path.basename(wt) });
  }
  return out;
}

function buildProject(root: string, abs: string, group: string | null, groupColor: string | null, fs: FsLike): ScanProject {
  fs.readdir(abs);
  const name = path.basename(abs);
  const rel = abs.slice(root.length + 1);
  const own = settingsColor(abs, fs);
  return {
    key: rel,
    name,
    group,
    color: own ?? groupColor ?? nameColor(name),
    ...(own ? { peacock: own } : {}),
    abs,
    folders: [{ abs, rel, worktree: null }, ...worktreeFolders(root, abs, fs)],
    run: runSpec(abs, fs),
  };
}

/** Apply user picks (spec D4): pick > Peacock > group pick > group Peacock > name hash. Pure. */
export function withPicks(projects: ScanProject[], picks: Record<string, string>): ScanProject[] {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  return projects.map((p) => {
    const g = p.group && p.group !== p.key ? byKey.get(p.group) : undefined;
    const base = p.peacock ?? (g ? picks[g.key] ?? g.peacock : undefined) ?? nameColor(p.name);
    const color = picks[p.key] ?? base;
    const { base: _drop, ...rest } = p;
    return color === p.color && !p.base && color === base ? p : { ...rest, color, ...(color !== base ? { base } : {}) };
  });
}

const skipped = (n: string) => n.startsWith(".") || n.startsWith("_");

/** True when any non-symlink folder below dir, up to depth levels, holds a .git. */
function holdsRepoBelow(dir: string, fs: FsLike, depth = 3): boolean {
  if (depth === 0) return false;
  for (const c of fs.readdir(dir)) {
    if (skipped(c)) continue;
    const child = path.join(dir, c);
    if (!fs.isDir(child) || toPosix(fs.realpath(child) ?? "") !== child /* realpath is native on Windows */) continue;
    if (fs.exists(path.join(child, ".git")) || holdsRepoBelow(child, fs, depth - 1)) return true;
  }
  return false;
}

export function scanProjects(rootIn: string, fs: FsLike = realFs, opts: { direct?: boolean } = {}): Scan {
  const trimmed = toPosix(rootIn.length > 1 ? rootIn.replace(/\/+$/, "") : rootIn);
  if (!fs.isDir(trimmed)) return { rootMissing: true, projects: [] };
  const root = toPosix(fs.realpath(trimmed) ?? trimmed); // realpath is native on Windows
  const projects: ScanProject[] = [];
  const names = safe(() => fs.readdir(root), [] as string[]);
  for (const n of names) {
    if (skipped(n)) continue;
    const abs = path.join(root, n);
    try {
      if (!fs.isDir(abs)) continue;
      if (fs.exists(path.join(abs, ".git"))) {
        projects.push(buildProject(root, abs, null, null, fs));
        continue;
      }
      if (opts.direct) {
        if (holdsRepoBelow(abs, fs)) continue;
        projects.push({ ...buildProject(root, abs, null, null, fs), plain: true });
        continue;
      }
      const gc = settingsColor(abs, fs);
      let members = 0;
      for (const m of fs.readdir(abs)) {
        if (skipped(m)) continue;
        const child = path.join(abs, m);
        if (!fs.isDir(child) || !fs.exists(path.join(child, ".git"))) continue;
        try {
          projects.push(buildProject(root, child, n, gc, fs));
          members++;
        } catch {
        }
      }
      if (members > 0) {
        projects.push({
          key: n,
          name: n,
          group: n,
          color: gc ?? nameColor(n),
          ...(gc ? { peacock: gc } : {}),
          abs,
          folders: [{ abs, rel: n, worktree: null }],
          run: runSpec(abs, fs),
        });
      } else if (!holdsRepoBelow(abs, fs)) {
        projects.push({ ...buildProject(root, abs, null, null, fs), plain: true });
      }
    } catch {
    }
  }
  projects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rootMissing: false, projects };
}
