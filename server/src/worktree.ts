import fs from "node:fs";
import path from "node:path";
import { toPosix } from "@fo/shared";

/** Spec §4.2: which project and worktree a cwd belongs to. Read-only, cached, never throws. */
export interface Where { project: string; worktree: string | null }
const WT_RE = /^(.*?)\/\.(?:claude\/)?worktrees\/([^/]+)(?:\/.*)?$/;
const GITDIR_RE = /^gitdir:\s*(.+?)\/\.git\/worktrees\/([^/\s]+)\s*$/m;
const P = path.posix;
const cache = new Map<string, Where>();
export type Probe = { kind: "dir" } | { kind: "file"; text: string } | null;
/** What `.git` is at p: a directory (normal repo), a file (worktree/submodule), or nothing. Never throws. */
const probeFs = (p: string): Probe => {
  try {
    if (fs.statSync(p).isDirectory()) return { kind: "dir" };
    return { kind: "file", text: fs.readFileSync(p, "utf8") };
  } catch { return null; }
};

export function clearWorktreeCache(): void { cache.clear(); }

export function worktreeOf(cwd: string, probe: (p: string) => Probe = probeFs): Where {
  const clean = toPosix(cwd).replace(/\/+$/, "") || "/";
  const hit = cache.get(clean);
  if (hit) return hit;
  let out: Where = { project: clean, worktree: null };
  const m = WT_RE.exec(clean);
  if (m) out = { project: m[1], worktree: m[2] };
  else {
    try {
      for (let dir = clean; ; ) {
        const g = probe(P.join(dir, ".git"));
        if (g !== null) {
          const w = g.kind === "file" ? GITDIR_RE.exec(g.text) : null;
          out = w ? { project: toPosix(w[1]), worktree: w[2] } : { project: dir, worktree: null };
          break;
        }
        const up = P.dirname(dir);
        if (up === dir || up === ".") break;
        dir = up;
      }
    } catch { /* unreadable: plain project */ }
  }
  cache.set(clean, out);
  return out;
}
