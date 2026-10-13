import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The Claude config dir flowobserve always knew; lines without acct belong to it. */
export const DEFAULT_ACCT = "~/.claude";
export const MAX_ACCOUNTS = 8;
export const MAX_LABEL = 32;

export interface Account { dir: string; label: string; dryas: boolean }
export type Exists = (p: string) => boolean;

const WIN_ABS = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/;
const isWin = (p: string): boolean => WIN_ABS.test(p);

/**
 * Account key as the hook and the installer write it: "~/x" or an absolute path, no trailing separator. A Windows
 * absolute path (C:\x, C:/x, \\host\share) is kept in backslash form, as the Windows hook writes it; `~\x` becomes `~/x`.
 * null when unusable.
 */
export function canonAcct(x: unknown): string | null {
  if (typeof x !== "string") return null;
  let s = x.trim();
  if (isWin(s)) s = s.replace(/\//g, "\\").replace(/\\+$/, "");
  else if (s.startsWith("~\\")) s = s.replace(/\\/g, "/").replace(/\/+$/, "");
  else s = s.replace(/\/+$/, "");
  if (!s || s.length > 256 || /^[A-Za-z]:$/.test(s)) return null;
  return s === "~" || s.startsWith("~/") || s.startsWith("/") || isWin(s) ? s : null;
}

export function expandHome(dir: string, home: string = os.homedir()): string {
  if (dir !== "~" && !dir.startsWith("~/") && !dir.startsWith("~\\")) return dir;
  if (dir === "~") return home;
  return isWin(home) ? path.win32.join(home, dir.slice(2).replace(/\//g, "\\")) : path.join(home, dir.slice(2));
}

/** Basename without its leading dot: ~/.claude-personal → claude-personal. */
export function defaultLabel(dir: string): string {
  const base = dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const b = base.startsWith(".") ? base.slice(1) : base;
  return (b && b !== "~" ? b : "claude").slice(0, MAX_LABEL);
}

/**
 * dryas = Dryas lists the dir in its accounts.json (dryasListed), or the dir holds a Dryas record, probed when the
 * accounts load and again every FLAG_REFRESH_MS: .dryas-plugin.json (v1 plugin install) or jev/chain.json (v0 copy install).
 */
export function makeAccount(dir: string, label: string | null, home: string, exists: Exists, dryasListed = false): Account {
  const d = expandHome(dir, home);
  return { dir, label: label ?? defaultLabel(dir), dryas: dryasListed || exists(path.join(d, ".dryas-plugin.json")) || exists(path.join(d, "jev", "chain.json")) };
}

/**
 * An absolute dir under the home dir in its ~ form, so /Users/dev/.claude-x and ~/.claude-x are one account.
 * A Windows home compares with either separator and ignoring case (drive letter included).
 */
export function foldHome(dir: string | null, home: string): string | null {
  const win = isWin(home);
  const norm = (p: string) => (win ? p.replace(/\\/g, "/").replace(/\/+$/, "") : p.replace(/\/+$/, ""));
  const h = norm(home);
  if (!dir || !h) return dir;
  if (win && !isWin(dir)) return dir;
  const d = norm(dir), lc = (p: string) => (win ? p.toLowerCase() : p);
  return lc(d) === lc(h) ? "~" : lc(d).startsWith(lc(h) + "/") ? "~" + d.slice(h.length) : dir;
}

/**
 * FlowObserve accounts.json text (null = missing) → entries in file order (dir folded to its ~ key, label or null).
 * Missing, unusable or empty → []; onBad gets the reason for an unusable file.
 */
export function parseAccounts(text: string | null, home: string, onBad?: (why: string) => void): { dir: string; label: string | null }[] {
  if (text === null) return [];
  let list: unknown;
  try { list = (JSON.parse(text) as { accounts?: unknown } | null)?.accounts; } catch (err) { onBad?.(`bad JSON (${(err as Error).message})`); return []; }
  if (!Array.isArray(list)) { onBad?.("no accounts array"); return []; }
  const out: { dir: string; label: string | null }[] = [];
  for (const x of list) {
    const o = (x && typeof x === "object" ? x : {}) as { dir?: unknown; label?: unknown };
    const dir = foldHome(canonAcct(o.dir), home);
    if (!dir || out.some((a) => a.dir === dir)) continue;
    out.push({ dir, label: typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, MAX_LABEL) : null });
    if (out.length === MAX_ACCOUNTS) break;
  }
  return out;
}

/**
 * Dryas's accounts.json ({"claude_dirs": [...]}, read-only) → `~`-folded account keys. Missing (null text) → [];
 * corrupt or misshaped → null (the caller keeps what it had).
 */
export function parseDryasDirs(text: string | null, home: string): string[] | null {
  if (text === null) return [];
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (j === null || typeof j !== "object" || Array.isArray(j)) return null;
  const dirs = (j as Record<string, unknown>).claude_dirs;
  if (!Array.isArray(dirs)) return null;
  const out: string[] = [];
  for (const d of dirs) {
    const k = foldHome(canonAcct(d), home);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * FlowObserve's accounts first, then Dryas's dirs; one entry per `~`-folded key, at most MAX_ACCOUNTS. The server's own
 * dirs (baseDirs) are board accounts only when both lists are empty; otherwise they are only watched (AccountsFile.watchDirs).
 */
export function mergeAccounts(fo: { dir: string; label: string | null }[], dryasDirs: string[], baseDirs: string[], home: string, exists: Exists): Account[] {
  const listed = new Set(dryasDirs);
  const out: Account[] = [];
  const add = (dir: string, label: string | null) => {
    if (out.length >= MAX_ACCOUNTS || out.some((a) => a.dir === dir)) return;
    out.push(makeAccount(dir, label, home, exists, listed.has(dir)));
  };
  for (const a of fo) add(a.dir, a.label);
  for (const d of dryasDirs) add(d, null);
  if (!out.length) for (const d of baseDirs) add(d, null);
  return out.length ? out : [makeAccount(DEFAULT_ACCT, null, home, exists, listed.has(DEFAULT_ACCT))];
}

const keyOf = (p: string): string => {
  let r: string;
  try { r = fs.realpathSync(p); } catch { r = path.resolve(p); }
  return process.platform === "win32" ? r.toLowerCase() : r;
};

/** First spelling of each dir, in order, deduped by resolved path (symlinks, `..`, trailing separators). */
export function uniqueDirs(dirs: string[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const d of dirs) {
    const k = keyOf(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(path.resolve(d));
  }
  return out;
}

/** Dryas flags are file probes, not file stamps: re-evaluated this often. */
export const FLAG_REFRESH_MS = 30_000;

const stampOf = (file: string): string => {
  try { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; } catch { return "missing"; }
};

/**
 * The account list: $FO_HOME/accounts.json (labels) merged with Dryas's <data root>/accounts.json and the server's
 * own dirs (baseDirs, absolute). Both files are re-read when their mtime or size changes (checked on the server's tick).
 */
export class AccountsFile {
  private stamp = ["", ""];
  private fo: { dir: string; label: string | null }[] = [];
  private dryasDirs: string[] = [];
  private base: string[];
  private list: Account[];
  private flagsAt: number;
  constructor(private file: string, private dryasFile: string, baseDirs: string[], private home: string = os.homedir(), private exists: Exists = fs.existsSync, private now: () => number = Date.now) {
    this.base = baseDirs.map((d) => foldHome(canonAcct(d), home)).filter((d): d is string => d !== null);
    this.list = mergeAccounts([], [], this.base, home, exists);
    this.flagsAt = now();
  }

  private read(file: string): string | null | undefined {
    try { return fs.readFileSync(file, "utf8"); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      console.error(`fo-server: cannot read ${file}: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * True when the account list changed, including an account's Dryas flag (re-probed every FLAG_REFRESH_MS). A missing file contributes nothing (the base dirs still supply ~/.claude).
   * A malformed FlowObserve file is ignored, one log line; a corrupt Dryas file keeps the previous Dryas dirs.
   */
  check(): boolean {
    const s = [stampOf(this.file), stampOf(this.dryasFile)];
    const t = this.now(), flagsDue = t - this.flagsAt >= FLAG_REFRESH_MS;
    if (s[0] === this.stamp[0] && s[1] === this.stamp[1] && !flagsDue) return false;
    this.flagsAt = t;
    if (s[0] !== this.stamp[0]) {
      const text = s[0] === "missing" ? null : this.read(this.file);
      this.stamp[0] = s[0]; // also when the read failed: logged once, retried when the file changes
      if (text !== undefined) this.fo = parseAccounts(text, this.home, (why) => console.error(`fo-server: ${this.file}: ${why}; ignored`));
    }
    if (s[1] !== this.stamp[1]) {
      const text = s[1] === "missing" ? null : this.read(this.dryasFile);
      this.stamp[1] = s[1];
      if (text !== undefined) {
        const dirs = parseDryasDirs(text, this.home);
        if (dirs === null) console.error(`fo-server: ${this.dryasFile}: unreadable; keeping the previous Dryas accounts`);
        else this.dryasDirs = dirs;
      }
    }
    const next = mergeAccounts(this.fo, this.dryasDirs, this.base, this.home, this.exists);
    const changed = JSON.stringify(next) !== JSON.stringify(this.list);
    this.list = next;
    return changed;
  }

  accounts(): Account[] { return this.list; }

  /** Dirs whose transcripts and sessions are read: the board accounts plus the server's own dirs, deduped by key. */
  watchDirs(): string[] { return [...new Set([...this.list.map((a) => a.dir), ...this.base])]; }
}

/**
 * Where an account's transcripts ("projects") or session registry ("sessions") live. A FO_* override replaces all
 * accounts' dirs. Deduped by resolved path, so two spellings of one dir are read once.
 */
export function accountRoots(accounts: readonly { dir: string }[], sub: "projects" | "sessions", override: string | null, home: string = os.homedir()): string[] {
  return uniqueDirs(override ? [override] : accounts.map((a) => path.join(expandHome(a.dir, home), sub)));
}
