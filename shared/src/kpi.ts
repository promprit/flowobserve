import type { Kpi } from "./wire";

export function kpiValue(k: Kpi): string {
  if (k.value === null) return "—";
  switch (k.unit) {
    case "pct": return `${Math.round(k.value * 100)}%`;
    case "rounds": return k.value.toFixed(1);
    case "usd": return `$${k.value.toFixed(2)}`;
    default: return String(Math.round(k.value));
  }
}

export const kpiShort = (k: Kpi): string => `${k.id} ${kpiValue(k)}`;

export const kpiDetail = (k: Kpi): string =>
  [kpiShort(k), `healthy ${k.healthy}`, k.window, `n=${k.n}`, ...(k.next ? [k.next] : [])].join(" · ");
