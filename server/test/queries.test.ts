import { describe, expect, it } from "vitest";
import { MetricsZ, SpendZ, type Kpi } from "@fo/shared";
import type { CallRow, TransitionRow } from "../src/reducer";
import { aggregateSpend, blockedMs, jevUsage, localMidnight, metrics, monthStart, quantile, rangeStart } from "../src/queries";

const local = (s: string) => new Date(s).getTime(); // TZ=Asia/Bangkok
const tr = (sid: string, ts: number, toStatus: TransitionRow["toStatus"]): TransitionRow =>
  ({ sid, ts, fromStage: 0, toStage: 0, fromStatus: "active", toStatus, cause: "t" });
const call = (role: CallRow["role"], model: string, ok: boolean | null, ms: number | null = 100): CallRow =>
  ({ ts: 0, sid: "a", role, model, ms, ok });

describe("dates (local time)", () => {
  it("midnight, month start and ranges", () => {
    const now = local("2026-10-03T10:30:00");
    expect(localMidnight(now)).toBe(local("2026-10-03T00:00:00"));
    expect(monthStart(now)).toBe(local("2026-10-01T00:00:00"));
    expect(rangeStart("7d", now)).toBe(local("2026-09-27T00:00:00"));
    expect(rangeStart("today", now)).toBe(local("2026-10-03T00:00:00"));
  });
});

describe("blockedMs", () => {
  it("sums blocked intervals, open ones run to now", () => {
    const rows = [tr("a", 0, "waiting"), tr("a", 60_000, "active"), tr("a", 120_000, "deny"), tr("b", 30_000, "handoff")];
    expect(blockedMs(rows, 0, 180_000)).toBe(60_000 + 60_000 + 150_000);
  });
  it("a wait across midnight splits at the window start", () => {
    const mid = local("2026-10-03T00:00:00");
    const rows = [tr("a", mid - 10 * 60_000, "waiting"), tr("a", mid + 10 * 60_000, "active")];
    expect(blockedMs(rows, mid, mid + 3600_000)).toBe(10 * 60_000);
  });
  it("escalated and idle are not blocked time", () => {
    expect(blockedMs([tr("a", 0, "escalated"), tr("a", 10, "idle")], 0, 100)).toBe(0);
  });
});

describe("metrics", () => {
  it("quantile uses nearest rank and handles empty input", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });
  it("tile signals come from ready Dryas KPIs only", () => {
    const k = (o: Partial<Kpi>): Kpi => ({ id: "ESC-M1", tile: "build", value: 0.24, unit: "pct", healthy: "<20%", window: "7d", n: 17, ready: true, warn: true, next: "read escalation reasons", ...o });
    const m = metrics([], [k({}), k({ id: "GOV-M2", tile: "judge", value: 0.1, healthy: "5–25%", warn: false, next: null }), k({ id: "REV-M1", tile: "review", ready: false, warn: false, next: null })]);
    expect(m.build).toMatchObject({ warn: true, signal: "ESC-M1 24% · healthy <20% · 7d · n=17 · read escalation reasons" });
    expect(m.judge).toMatchObject({ warn: false, signal: "GOV-M2 10% · healthy 5–25% · 7d · n=17" });
    expect(m.review).toMatchObject({ warn: false, signal: null });
    expect(m.plan).toMatchObject({ warn: false, signal: null });
    expect(MetricsZ.parse(m)).toEqual(m);
  });
  it("plan and review never warn and default their model", () => {
    const m = metrics([]);
    expect(m.plan).toEqual({ model: "opus", calls: 0, p50: null, p95: null, signal: null, warn: false });
    expect(m.judge.model).toBe("jev");
  });
});

describe("spend", () => {
  const row = (project: string, model: string, source: "claude" | "jev", usd: number, ts = 0) => ({ ts, sid: null, project, model, source, usd });
  it("aggregates by project, model and source, biggest first", () => {
    const s = aggregateSpend([row("app", "opus", "claude", 1), row("app", "opus", "claude", 2), row("web", "jev-1.13", "jev", 0.5)]);
    expect(SpendZ.parse(s)).toEqual(s);
    expect(s).toEqual({ rows: [
      { project: "app", model: "opus", source: "claude", usd: 3 },
      { project: "web", model: "jev-1.13", source: "jev", usd: 0.5 },
    ], totalUsd: 3.5 });
  });
  it("Jev meter sums Jev spend since the month started", () => {
    const now = local("2026-10-03T10:00:00");
    const u = jevUsage([row("a", "j", "jev", 1, local("2026-09-30T23:00:00")), row("a", "j", "jev", 0.25, local("2026-10-02T00:00:00")),
      row("a", "o", "claude", 9, local("2026-10-02T00:00:00"))], now, 5);
    expect(u).toEqual({ usedUsd: 0.25, budgetUsd: 5, monthStart: local("2026-10-01T00:00:00") });
  });
});
