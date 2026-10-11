import { describe, expect, it } from "vitest";
import { MsgZ, kpiDetail, kpiShort, kpiValue, type Kpi } from "../src";

const k = (o: Partial<Kpi> = {}): Kpi => ({ id: "ESC-M1", tile: "build", value: 0.24, unit: "pct", healthy: "<20%", window: "7d", n: 17, ready: true, warn: true, next: "read escalation reasons", ...o });
const M = { model: "opus", calls: 0, p50: null, p95: null, signal: null, warn: false };
const metrics = { plan: M, build: M, judge: M, escalate: M, review: M };

describe("kpi formatting", () => {
  it("formats each unit", () => {
    expect(kpiValue(k())).toBe("24%");
    expect(kpiValue(k({ unit: "rounds", value: 0.9 }))).toBe("0.9");
    expect(kpiValue(k({ unit: "count", value: 0 }))).toBe("0");
    expect(kpiValue(k({ unit: "usd", value: 1.8 }))).toBe("$1.80");
    expect(kpiValue(k({ value: null }))).toBe("—");
  });
  it("short and detail lines", () => {
    expect(kpiShort(k())).toBe("ESC-M1 24%");
    expect(kpiDetail(k())).toBe("ESC-M1 24% · healthy <20% · 7d · n=17 · read escalation reasons");
    expect(kpiDetail(k({ next: null }))).toBe("ESC-M1 24% · healthy <20% · 7d · n=17");
  });
});

describe("wire", () => {
  it("snapshot and metrics accept kpis, and default them to [] when absent", () => {
    const snap = { type: "snapshot", sessions: [], usage: null, metrics, blockedMs: 0, blockedWindowMs: 0 };
    expect((MsgZ.parse(snap) as { kpis: Kpi[] }).kpis).toEqual([]);
    expect((MsgZ.parse({ ...snap, kpis: [k()] }) as { kpis: Kpi[] }).kpis).toEqual([k()]);
    expect((MsgZ.parse({ type: "metrics", metrics, blockedMs: 0, blockedWindowMs: 0 }) as { kpis: Kpi[] }).kpis).toEqual([]);
    expect(MsgZ.safeParse({ ...snap, kpis: [{ ...k(), unit: "eur" }] }).success).toBe(false);
  });
});
