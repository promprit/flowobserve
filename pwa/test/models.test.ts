import { beforeEach, expect, it } from "vitest";
import type { Kpi } from "@fo/shared";
import { store } from "../src/state";
import { renderModels } from "../src/ui/models";
import { METRICS, loadDom, reset } from "./helpers";

beforeEach(() => { reset(); loadDom(); });
const k = (o: Partial<Kpi> = {}): Kpi => ({ id: "ESC-M1", tile: "build", value: 0.24, unit: "pct", healthy: "<20%", window: "7d", n: 17, ready: true, warn: true, next: "read escalation reasons", ...o });
const tile = (i: number) => document.querySelectorAll("#models .mt")[i] as HTMLElement;

it("a ready KPI replaces the latency line; the glow follows its warn", () => {
  store.metrics = { ...METRICS, build: { ...METRICS.build, signal: "ESC-M1 24% · healthy <20% · 7d · n=17 · read escalation reasons", warn: true } };
  store.kpis = [k()];
  renderModels();
  expect(tile(1).querySelector(".l")!.textContent).toBe("ESC-M1 24%");
  expect(tile(1).classList.contains("hot")).toBe(true);
  expect(tile(1).title).toContain("read escalation reasons");
});

it("below its sample minimum the tile renders exactly as before", () => {
  store.metrics = METRICS;
  store.kpis = [];
  renderModels();
  const before = document.querySelector("#models")!.innerHTML;
  store.kpis = [k({ ready: false, warn: false, next: null })];
  renderModels();
  expect(document.querySelector("#models")!.innerHTML).toBe(before);
});

it("without Jev the strip drops Judge and Escalate and keeps the rest", () => {
  store.metrics = METRICS;
  store.jev = false;
  renderModels();
  expect([...document.querySelectorAll("#models .mt .r")].map((x) => x.textContent)).toEqual(["PLAN", "BUILD", "REVIEW"]);
  store.jev = true;
  renderModels();
  expect(document.querySelectorAll("#models .mt").length).toBe(5);
});
