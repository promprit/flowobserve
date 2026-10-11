import { beforeEach, expect, it } from "vitest";
import type { Kpi } from "@fo/shared";
import { store } from "../src/state";
import { renderModels } from "../src/ui/models";
import { renderUsage } from "../src/ui/usage";
import { METRICS, T0, loadDom, reset } from "./helpers";

beforeEach(() => { reset(); loadDom(); });
const fo = (id: string): Kpi => ({ id, tile: "you", value: 3_600_000, unit: "ms", healthy: "< 30 min", window: "7d", n: 5, ready: true, warn: true, next: "read specs and plans sooner" }) as unknown as Kpi;
const html = (sel: string) => document.querySelector(sel)!.innerHTML;

it("the three flowobserve KPIs do not change the models tiles or the usage tile", () => {
  store.metrics = METRICS;
  store.usage = { session: { used: 0.5, startedAt: T0 - 3600e3, windowMs: 5 * 3600e3 }, weekly: { used: 0.3, resetsAt: T0 + 3 * 86400e3 }, jev: { usedUsd: 1, budgetUsd: 5, monthStart: T0 - 86400e3 }, at: T0 };
  store.kpis = [];
  renderModels(); renderUsage();
  const before = [html("#models"), html("#usage")];
  store.kpis = [fo("FO-GATE"), fo("FO-SHIP"), fo("FO-TRY")];
  renderModels(); renderUsage();
  expect([html("#models"), html("#usage")]).toEqual(before);
});
