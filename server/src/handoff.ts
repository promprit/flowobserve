import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Handoff file state (spec §9.5). Read-only: mtime of the Jev handoff file, never its contents. Key = handoff_paths.py rule. */
export const RESTORE_MS = 30 * 60_000;

export function handoffKey(root: string): string {
  const base = path.basename(root.replace(/\/+$/, "")).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "root";
  return `${base}-${crypto.createHash("sha256").update(root, "utf8").digest("hex").slice(0, 12)}`;
}

/** Main repo root via git (worktrees map to their main repo); cached per realpath(cwd), at most `max` entries. */
export class RootCache {
  private m = new Map<string, string>();
  constructor(private run: (cwd: string) => Promise<string | null> = gitRoot, private max = 64) {}
  async get(cwd: string): Promise<string> {
    let real: string;
    try { real = fs.realpathSync(cwd); } catch { real = cwd; }
    const hit = this.m.get(real);
    if (hit !== undefined) { this.m.delete(real); this.m.set(real, hit); return hit; }
    const root = (await this.run(real).catch(() => null)) ?? real;
    this.m.set(real, root);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    return root;
  }
}

export function gitRoot(cwd: string): Promise<string | null> {
  return new Promise((resolve) => execFile("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { timeout: 2000 }, (err, out) => {
    const common = String(out ?? "").trim().replace(/\/+$/, "");
    if (err || !common || path.basename(common) !== ".git") return resolve(null);
    try { resolve(fs.realpathSync(path.dirname(common))); } catch { resolve(path.dirname(common)); }
  }));
}

export function handoffSavedAt(dir: string, root: string, now: number): number | null {
  try {
    const m = fs.statSync(path.join(dir, handoffKey(root) + ".md")).mtimeMs;
    return now - m < RESTORE_MS ? m : null;
  } catch { return null; }
}
