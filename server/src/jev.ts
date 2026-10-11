import { toPosix } from "@fo/shared";
export interface JevLine {
  file: string; ts: number; cost: number; sid: string | null; cwd: string | null;
  kind: "deny" | "ask" | "override" | "other"; tool: string; head: string;
}

/** jevlog.py writes "+0700"; Date.parse wants "+07:00". */
export function parseJevTs(s: string): number {
  return Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

export function parseJevLine(file: string, raw: string): JevLine | null {
  let x: unknown;
  try { x = JSON.parse(raw); } catch { return null; }
  if (x === null || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const ts = typeof o.ts === "string" ? parseJevTs(o.ts) : NaN;
  if (!Number.isFinite(ts)) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    file, ts,
    cost: typeof o.cost === "number" && o.cost > 0 ? o.cost : 0,
    sid: s(o.session_id) || null, cwd: s(o.cwd) ? toPosix(s(o.cwd)) : null,
    kind: file === "gate" && o.decision === "deny" ? "deny" : file === "gate" && o.decision === "ask" ? "ask" : file === "overrides" ? "override" : "other",
    tool: s(o.tool), head: s(o.head),
  };
}
