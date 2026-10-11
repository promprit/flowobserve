import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/config";
import { kpis, type KpiInput } from "../src/kpi";
import type { CallRow } from "../src/reducer";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const MIN = 60_000;
const ago = (d: number) => NOW - d * DAY_MS;
const empty = (): KpiInput => ({ escalations: [], cycles: [], calls: [], spend: [] });
const row = (role: CallRow["role"], ts: number, ms: number | null, ok: boolean | null = true): CallRow => ({ ts, sid: "a", role, model: "you", ms, ok });
const get = (i: KpiInput, id: string) => kpis(i, NOW).find((k) => k.id === id)!;

describe("flowobserve KPIs", () => {
  it("gate wait is the median of gate rows in 7 days", () => {
    const i = empty();
    i.calls = [10, 20, 40].map((m) => row("gate", ago(1), m * MIN));
    i.calls.push(row("gate", ago(9), 500 * MIN)); // outside 7 d
    expect(get(i, "FO-GATE")).toMatchObject({ value: 20 * MIN, unit: "ms", healthy: "< 30 min", tile: "you", window: "7d", n: 3, ready: true, warn: false, next: null });
    i.calls = [40, 50, 60].map((m) => row("gate", ago(1), m * MIN));
    expect(get(i, "FO-GATE")).toMatchObject({ value: 50 * MIN, ready: true, warn: true, next: "read specs and plans sooner; turn on push notifications" });
  });

  it("ship wait is the median of ship rows in 7 days", () => {
    const i = empty();
    i.calls = [30, 60, 120].map((m) => row("ship", ago(2), m * MIN));
    i.calls.push(row("ship", ago(9), 900 * MIN));
    expect(get(i, "FO-SHIP")).toMatchObject({ value: 60 * MIN, unit: "ms", healthy: "< 2 h", tile: "you", window: "7d", n: 3, ready: true, warn: false, next: null });
    i.calls = [180, 200, 240].map((m) => row("ship", ago(2), m * MIN));
    expect(get(i, "FO-SHIP")).toMatchObject({ value: 200 * MIN, warn: true, next: "finished work waits untested; use Try it" });
  });

  it("try problem share is the ok:false share of try rows in 30 days", () => {
    const i = empty();
    i.calls = [row("try", ago(20), null, true), row("try", ago(20), null, true), row("try", ago(20), null, true), row("try", ago(20), null, false), row("try", ago(31), null, false)];
    expect(get(i, "FO-TRY")).toMatchObject({ value: 0.25, unit: "pct", healthy: "< 30%", tile: "you", window: "30d", n: 4, ready: true, warn: false, next: null });
    i.calls = [row("try", ago(5), null, false), row("try", ago(5), null, false), row("try", ago(5), null, true)];
    expect(get(i, "FO-TRY")).toMatchObject({ warn: true, next: "reviews miss problems; tighten done criteria" });
  });

  it("empty history gives null, not ready, no warning", () => {
    for (const id of ["FO-GATE", "FO-SHIP", "FO-TRY"]) {
      expect(get(empty(), id)).toMatchObject({ value: null, ready: false, warn: false });
    }
  });

  it("fewer than three rows is not ready and does not warn", () => {
    const i = empty();
    i.calls = [row("gate", ago(1), 90 * MIN), row("gate", ago(1), 90 * MIN)];
    expect(get(i, "FO-GATE")).toMatchObject({ ready: false, warn: false });
  });
});
