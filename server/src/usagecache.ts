import type { Limit } from "@fo/shared";

const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

function limit(x: unknown): Limit | null {
  const o = obj(x);
  if (typeof o.utilization !== "number" || !Number.isFinite(o.utilization)) return null;
  if (typeof o.resets_at !== "string") return null;
  const resetsAt = Date.parse(o.resets_at);
  return Number.isFinite(resetsAt) ? { pct: o.utilization, resetsAt } : null;
}

export type ClaudeUsage = { fiveHour: Limit; sevenDay: Limit | null; fable?: Limit | null; at: number };

function fableLimit(limits: unknown): Limit | null {
  if (!Array.isArray(limits)) return null;
  for (const item of limits) {
    const o = obj(item);
    const name = obj(obj(o.scope).model).display_name;
    if (typeof name !== "string" || name.toLowerCase() !== "fable") continue;
    if (typeof o.percent !== "number" || !Number.isFinite(o.percent)) continue;
    if (typeof o.resets_at !== "string") continue;
    const resetsAt = Date.parse(o.resets_at);
    if (Number.isFinite(resetsAt)) return { pct: o.percent, resetsAt };
  }
  return null;
}

export function parseUsageCache(text: string): ClaudeUsage | null {
  let root: unknown;
  try { root = JSON.parse(text); } catch { return null; }
  const o = obj(root);
  if (typeof o.fetchedAt !== "number" || !Number.isFinite(o.fetchedAt)) return null;
  const d = obj(o.data);
  const fiveHour = limit(d.five_hour);
  const sevenDay = limit(d.seven_day);
  return fiveHour ? { fiveHour, sevenDay, fable: fableLimit(d.limits), at: o.fetchedAt } : null;
}
