import fs from "node:fs";
import path from "node:path";

export interface RegEntry { pid: number; sessionId: string; kind: string }

/** pid, sessionId and kind of one registry file; anything else in it is never read on. */
export function parseEntry(raw: string): RegEntry | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.pid !== "number" || !Number.isInteger(j.pid) || typeof j.sessionId !== "string" || !j.sessionId) return null;
    return { pid: j.pid, sessionId: j.sessionId, kind: typeof j.kind === "string" ? j.kind : "" };
  } catch { return null; }
}

/** Every entry in the registry dir, or null when the dir does not exist (feature off). */
export function readRegistry(dir: string): Map<string, RegEntry> | null {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const out = new Map<string, RegEntry>();
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const e = parseEntry(fs.readFileSync(path.join(dir, n), "utf8"));
      if (e) out.set(e.sessionId, e);
    } catch { /* unreadable file: skip */ }
  }
  return out;
}

/** EPERM = alive but not ours; ESRCH = gone. */
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Every account's registry merged; null only when no dir exists (feature off). */
export function readRegistries(dirs: string[]): Map<string, RegEntry> | null {
  let any = false;
  const out = new Map<string, RegEntry>();
  for (const d of dirs) {
    const r = readRegistry(d);
    if (!r) continue;
    any = true;
    for (const [k, v] of r) out.set(k, v);
  }
  return any ? out : null;
}
