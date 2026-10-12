import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The Claude config dir flowobserve always knew; lines without acct belong to it. */
export const DEFAULT_ACCT = "~/.claude";
export const MAX_ACCOUNTS = 8;
export const MAX_LABEL = 32;

export interface Account { dir: string; label: string; dryas: boolean }
export type Exists = (p: string) => boolean;

/** Account key as the hook and the installer write it: "~/x" or an absolute path, no trailing slash. null when unusable. */
export function canonAcct(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.trim().replace(/\/+$/, "");
  if (!s || s.length > 256) return null;
  return s === "~" || s.startsWith("~/") || s.startsWith("/") ? s : null;
}

export function expandHome(dir: string, home: string = os.homedir()): string {
  return dir === "~" ? home : dir.startsWith("~/") ? path.join(home, dir.slice(2)) : dir;
}

/** Basename without its leading dot: ~/.claude-personal → claude-personal. */
export function defaultLabel(dir: string): string {
  const base = dir.split("/").filter(Boolean).pop() ?? "";
  const b = base.startsWith(".") ? base.slice(1) : base;
  return (b && b !== "~" ? b : "claude").slice(0, MAX_LABEL);
}

/** dryas = <dir>/jev/chain.json exists, checked once when the accounts load. */
export function makeAccount(dir: string, label: string | null, home: string, exists: Exists): Account {
  return { dir, label: label ?? defaultLabel(dir), dryas: exists(path.join(expandHome(dir, home), "jev", "chain.json")) };
}

/** accounts.json text (null = missing) → accounts in file order. Unusable file or no usable entry → the default account only. */
export function parseAccounts(text: string | null, home: string, exists: Exists): { accounts: Account[]; error: string | null } {
  const fallback = [makeAccount(DEFAULT_ACCT, null, home, exists)];
  if (text === null) return { accounts: fallback, error: null };
  let list: unknown;
  try { list = (JSON.parse(text) as { accounts?: unknown }).accounts; } catch (err) { return { accounts: fallback, error: `bad JSON (${(err as Error).message})` }; }
  if (!Array.isArray(list)) return { accounts: fallback, error: "no accounts array" };
  const out: Account[] = [];
  for (const x of list) {
    const o = (x && typeof x === "object" ? x : {}) as { dir?: unknown; label?: unknown };
    const dir = canonAcct(o.dir);
    if (!dir || out.some((a) => a.dir === dir)) continue;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, MAX_LABEL) : null;
    out.push(makeAccount(dir, label, home, exists));
    if (out.length === MAX_ACCOUNTS) break;
  }
  return { accounts: out.length ? out : fallback, error: null };
}

/** $FO_HOME/accounts.json, re-read when its mtime changes (checked on the server's 30 s tick). */
export class AccountsFile {
  private mtime = -2; // -1 = missing, -2 = never checked
  private list: Account[];
  constructor(private file: string, private home: string = os.homedir(), private exists: Exists = fs.existsSync) {
    this.list = parseAccounts(null, home, exists).accounts;
  }

  /** True when the account list changed. Unreadable or malformed file: default account only, one log line. */
  check(): boolean {
    let mt = -1;
    try { mt = fs.statSync(this.file).mtimeMs; } catch { /* missing */ }
    if (mt === this.mtime) return false;
    this.mtime = mt;
    let text: string | null = null;
    if (mt !== -1) {
      try { text = fs.readFileSync(this.file, "utf8"); } catch (err) { console.error(`fo-server: cannot read ${this.file}: ${(err as Error).message}`); }
    }
    const r = parseAccounts(text, this.home, this.exists);
    if (r.error) console.error(`fo-server: ${this.file}: ${r.error}; using ~/.claude only`);
    const changed = JSON.stringify(r.accounts) !== JSON.stringify(this.list);
    this.list = r.accounts;
    return changed;
  }

  accounts(): Account[] { return this.list; }
}
