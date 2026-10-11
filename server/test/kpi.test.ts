import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/config";
import { kpis, type KpiInput } from "../src/kpi";
import type { CallRow, CycleRow, EscalationRow, SpendRow } from "../src/reducer";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const ago = (d: number) => NOW - d * DAY_MS;
const empty = (): KpiInput => ({ escalations: [], cycles: [], calls: [], spend: [] });
const cyc = (sid: string, started: number, ended: number | null, tasks: number, o: Partial<CycleRow> = {}): CycleRow =>
  ({ sid, started, ended, lastStage: 6, tasks, escalations: 0, reviews: 1, planTasks: tasks, outcome: "shipped", ...o });
const esc = (sid: string, ts: number, from: EscalationRow["from"], to: EscalationRow["to"]): EscalationRow => ({ ts, sid, task: "T", from, to });
const call = (role: CallRow["role"], ts: number): CallRow => ({ ts, sid: "a", role, model: "x", ms: null, ok: null });
const spend = (source: SpendRow["source"], usd: number, ts: number, sid: string | null = "a"): SpendRow => ({ ts, sid, project: "p", model: "m", source, usd });
const get = (i: KpiInput, id: string) => kpis(i, NOW).find((k) => k.id === id)!;

describe("kpis", () => {
  it("returns nine KPIs, none warning, on empty history", () => {
    const all = kpis(empty(), NOW);
    expect(all.map((k) => k.id)).toEqual(["ESC-M1", "GOV-M2", "ESC-M2", "REV-M1", "EXE-M2", "EXE-M3", "FO-GATE", "FO-SHIP", "FO-TRY"]);
    expect(all.filter((k) => k.warn)).toEqual([]);
    expect(all.find((k) => k.id === "ESC-M1")).toMatchObject({ value: null, ready: false, n: 0, tile: "build", window: "7d" });
    expect(all.find((k) => k.id === "ESC-M2")).toMatchObject({ value: 0, ready: true, warn: false, tile: "escalate" });
  });

  it("ESC-M1 counts Sonnet→Opus inside closed cycles only, over their tasks", () => {
    const i = empty();
    i.cycles = [cyc("a", ago(2), ago(1), 5)];
    i.escalations = [esc("a", ago(1.5), "sonnet", "opus"), esc("a", ago(1.5), "opus", "fable"),
      esc("b", ago(1.5), "sonnet", "opus") /* no closed cycle for b: ignored */];
    expect(get(i, "ESC-M1")).toMatchObject({ value: 0.2, n: 5, ready: true, warn: false, next: null });
    i.escalations.push(esc("a", ago(1.2), "sonnet", "opus"));
    expect(get(i, "ESC-M1")).toMatchObject({ value: 0.4, warn: true, next: "read escalation reasons; split plan tasks smaller" });
  });

  it("ESC-M1 window edge: a cycle that ended just over 7 d ago is out", () => {
    const i = empty();
    i.cycles = [cyc("a", ago(8), ago(7) - 1, 5), cyc("b", ago(8), ago(7), 5)];
    expect(get(i, "ESC-M1").n).toBe(5);
  });

  it("GOV-M2 needs 20 judge calls and warns on both sides of 5–25%", () => {
    const i = empty();
    i.calls = [...Array.from({ length: 19 }, () => call("judge", ago(1))), ...Array.from({ length: 10 }, () => call("override", ago(1)))];
    expect(get(i, "GOV-M2")).toMatchObject({ ready: false, warn: false, next: null });
    i.calls.push(call("judge", ago(1)));
    expect(get(i, "GOV-M2")).toMatchObject({ value: 0.5, ready: true, warn: true, next: "/tune: raise dispatch.min_confidence" });
    i.calls = Array.from({ length: 40 }, () => call("judge", ago(1)));
    expect(get(i, "GOV-M2")).toMatchObject({ value: 0, warn: true, next: "/tune: lower dispatch.min_confidence" });
    i.calls.push(call("judge", ago(8)), call("override", ago(8))); // outside 7 d
    expect(get(i, "GOV-M2").n).toBe(40);
  });

  it("ESC-M2 flags any Fable dispatch that did not follow an Opus failure", () => {
    const i = empty();
    i.escalations = [esc("a", ago(1), "opus", "fable")];
    expect(get(i, "ESC-M2")).toMatchObject({ value: 0, warn: false });
    i.escalations.push(esc("a", ago(1), "sonnet", "fable"));
    expect(get(i, "ESC-M2")).toMatchObject({ value: 1, warn: true, next: "compliance: Fable dispatched before Opus failed" });
  });

  it("REV-M1 is the median of (reviews − 1) over 5+ shipped cycles in 30 d", () => {
    const i = empty();
    i.cycles = [1, 1, 1, 3, 4].map((r, n) => cyc(`c${n}`, ago(20), ago(10), 2, { reviews: r }));
    expect(get(i, "REV-M1")).toMatchObject({ value: 0, n: 5, ready: true, warn: false, window: "30d" });
    i.cycles = [3, 3, 3, 1, 1].map((r, n) => cyc(`c${n}`, ago(20), ago(10), 2, { reviews: r }));
    expect(get(i, "REV-M1")).toMatchObject({ value: 2, warn: true, next: "tighten the task's done criteria in the plan" });
    i.cycles.push(cyc("x", ago(20), ago(10), 2, { reviews: 9, outcome: "abandoned" }));
    expect(get(i, "REV-M1").n).toBe(5);
  });

  it("EXE-M2 is Jev ÷ Claude spend over 7 d; null without Claude spend", () => {
    const i = empty();
    i.spend = [spend("jev", 1, ago(1))];
    expect(get(i, "EXE-M2")).toMatchObject({ value: null, ready: false, warn: false });
    i.spend.push(spend("claude", 10, ago(1)));
    expect(get(i, "EXE-M2")).toMatchObject({ value: 0.1, ready: true, warn: true, next: "judge asked too often; check judged share in /tune" });
  });

  it("EXE-M3 is Claude spend inside shipped cycles ÷ their tasks, and never warns", () => {
    const i = empty();
    i.cycles = [cyc("a", ago(5), ago(4), 4), cyc("b", ago(5), ago(4), 0)];
    i.spend = [spend("claude", 6, ago(4.5)), spend("claude", 100, ago(3)) /* after the cycle */,
      spend("jev", 50, ago(4.5)), spend("claude", 7, ago(4.5), "b") /* b has 0 tasks */];
    expect(get(i, "EXE-M3")).toMatchObject({ value: 1.5, n: 1, ready: true, warn: false, unit: "usd", tile: "usage" });
  });
  it("REV-M1 is a true median: even n averages the two middle values", () => {
    const i = empty();
    i.cycles = [1, 1, 1, 3, 3, 3].map((r, n) => cyc(`c${n}`, ago(20), ago(10), 2, { reviews: r }));
    expect(get(i, "REV-M1")).toMatchObject({ value: 1, n: 6, ready: true, warn: false });
  });

  it("REV-M1 ignores cycles whose reviews are null (unmeasured) or 0", () => {
    const i = empty();
    i.cycles = [2, 2, 2, 2, 2].map((r, n) => cyc(`c${n}`, ago(20), ago(10), 2, { reviews: r }));
    i.cycles.push(cyc("n", ago(20), ago(10), 2, { reviews: null }), cyc("z", ago(20), ago(10), 2, { reviews: 0 }));
    expect(get(i, "REV-M1")).toMatchObject({ value: 1, n: 5 });
  });

  it("EXE-M2 with only $0.02 of Claude spend is not ready and does not warn", () => {
    const i = empty();
    i.spend = [spend("jev", 0.01, ago(1)), spend("claude", 0.02, ago(1))];
    expect(get(i, "EXE-M2")).toMatchObject({ ready: false, warn: false });
  });

  it("EXE-M2 n counts Claude spend rows in the window", () => {
    const i = empty();
    i.spend = [spend("claude", 0.6, ago(1)), spend("claude", 0.6, ago(2)), spend("jev", 0.1, ago(1)), spend("claude", 9, ago(9))];
    expect(get(i, "EXE-M2")).toMatchObject({ n: 2, ready: true });
  });

  it("ESC-M1 and EXE-M3 divide by plan tasks, not finished tasks; cycles without planTasks are excluded", () => {
    const i = empty();
    i.cycles = [cyc("a", ago(5), ago(4), 1, { planTasks: 4 }), cyc("b", ago(5), ago(4), 9, { planTasks: null }), cyc("c", ago(5), ago(4), 9, { planTasks: 0 })];
    i.escalations = [esc("a", ago(4.5), "sonnet", "opus"), esc("b", ago(4.5), "sonnet", "opus"), esc("c", ago(4.5), "sonnet", "opus")];
    i.spend = [spend("claude", 8, ago(4.5), "a"), spend("claude", 50, ago(4.5), "b"), spend("claude", 50, ago(4.5), "c")];
    expect(get(i, "ESC-M1")).toMatchObject({ value: 0.25, n: 4 });
    expect(get(i, "EXE-M3")).toMatchObject({ value: 2, n: 1 });
  });
});
