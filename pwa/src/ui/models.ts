import { kpiShort } from "@fo/shared";
import { store } from "../state";
import { $, esc, fmtMs } from "../util";

const ROLES = ["plan", "build", "judge", "escalate", "review"] as const;

export function renderModels(): void {
  const el = $("#models")!, M = store.metrics;
  if (!M) { el.innerHTML = ""; return; }
  const roles = store.jev ? ROLES : ROLES.filter((k) => k !== "judge" && k !== "escalate");
  el.innerHTML = roles.map((k) => {
    const m = M[k];
    const kpi = store.kpis.find((x) => x.tile === k && x.ready && x.value !== null);
    const hint = m.signal ?? `${m.calls} calls · p50 ${fmtMs(m.p50)} · p95 ${fmtMs(m.p95)}`;
    const line = kpi ? kpiShort(kpi) : m.warn && m.p95 ? "p95 " + fmtMs(m.p95) : fmtMs(m.p50);
    return `<div class="mt${m.warn ? " hot" : ""}" title="${esc(hint)}"><span class="r">${k.toUpperCase()}</span>` +
      `<b class="c">${m.calls.toLocaleString()}</b><i class="l">${esc(line)}</i></div>`;
  }).join("");
}
