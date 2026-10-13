import { describe, expect, it } from "vitest";
import { HostZ, MsgZ, SessionZ, UsageZ } from "../src/wire";

const session = {
  id: "s1", name: "app", stage: 3, status: "active", tasksDone: 1, tasksTotal: 4,
  builders: ["working", "done", "idle"], deny: null, esc: false, msg: null, action: null,
  say: { t: 1, text: "Bash git status" }, openUrl: "vscode://file/Users/p/app",
  startedAt: 1, since: 1, lastEventAt: 2,
  nodes: [], stageAt: [1, null, null, null, null, null, null],
  log: [{ t: 1, text: "Bash git status" }],
};
const metric = { model: "opus", calls: 0, p50: null, p95: null, signal: null, warn: false };
const metrics = { plan: metric, build: metric, judge: metric, escalate: metric, review: metric };
const usage = {
  session: { used: 0.4, startedAt: 0, windowMs: 18_000_000 },
  weekly: { used: 0.2, resetsAt: 9 },
  jev: { usedUsd: 1.2, budgetUsd: 5, monthStart: 0 },
  at: 5,
};

describe("wire schema", () => {
  it("accepts a prototype-shaped session", () => {
    expect(SessionZ.parse(session)).toEqual(session);
  });
  it("requires stageAt of exactly 7 and at most 8 nodes", () => {
    expect(SessionZ.safeParse({ ...session, stageAt: [1, null] }).success).toBe(false);
    const n = { key: "b0", state: "idle", model: null, startedAt: null, task: null, waiting: null };
    expect(SessionZ.safeParse({ ...session, nodes: Array(9).fill(n) }).success).toBe(false);
  });
  it("requires log, max 6 entries, strict entries", () => {
    const { log: _omit, ...noLog } = session;
    expect(SessionZ.safeParse(noLog).success).toBe(false);
    const e = { t: 1, text: "x" };
    expect(SessionZ.safeParse({ ...session, log: Array(6).fill(e) }).success).toBe(true);
    expect(SessionZ.safeParse({ ...session, log: Array(7).fill(e) }).success).toBe(false);
    expect(SessionZ.safeParse({ ...session, log: [{ ...e, extra: 1 }] }).success).toBe(false);
  });
  it("rejects builders that are not exactly 3", () => {
    expect(SessionZ.safeParse({ ...session, builders: ["idle", "idle"] }).success).toBe(false);
  });
  it("rejects STALE as a status (it is a PWA flag, not a status)", () => {
    expect(SessionZ.safeParse({ ...session, status: "STALE" }).success).toBe(false);
  });
  it("rejects usage above 1", () => {
    expect(UsageZ.safeParse({ ...usage, weekly: { used: 1.2, resetsAt: 9 } }).success).toBe(false);
  });
  it("accepts usage with weekly null (no weekly limit reported)", () => {
    expect(UsageZ.parse({ ...usage, weekly: null }).weekly).toBeNull();
  });
  it("rejects usage with no weekly key or weekly used above 1", () => {
    const { weekly: _omit, ...noWeekly } = usage;
    expect(UsageZ.safeParse(noWeekly).success).toBe(false);
    expect(UsageZ.safeParse({ ...usage, weekly: { used: 1.2, resetsAt: 9 } }).success).toBe(false);
  });
  it("accepts usage with fable, without fable, and with fable null", () => {
    const f = { used: 0.31, resetsAt: 7 };
    expect(UsageZ.parse({ ...usage, fable: f }).fable).toEqual(f);
    expect(UsageZ.safeParse(usage).success).toBe(true);
    expect(UsageZ.parse({ ...usage, fable: null }).fable).toBeNull();
    expect(UsageZ.safeParse({ ...usage, fable: { used: 1.5, resetsAt: 7 } }).success).toBe(false);
  });
  it("accepts every message type", () => {
    for (const m of [
      { type: "snapshot", sessions: [session], usage: null, metrics, blockedMs: 0, blockedWindowMs: 0 },
      { type: "session", session },
      { type: "usage", usage },
      { type: "metrics", metrics, blockedMs: 60000, blockedWindowMs: 0 },
    ]) expect(MsgZ.safeParse(m).success).toBe(true);
  });
});

const host = {
  at: 5, cpu: 0.18, gpu: null, mem: { used: 0.52, pressure: "normal" },
  disks: [{ label: "System", path: "/", used: 0.41, freeBytes: 412e9 }, { label: "External", path: "/Volumes/External", used: null, freeBytes: null }],
};

describe("host wire", () => {
  it("accepts a host sample with GPU null and an offline disk", () => {
    expect(HostZ.parse(host)).toEqual(host);
  });
  it("rejects values above 1, unknown pressure, more than 4 disks and extra keys", () => {
    expect(HostZ.safeParse({ ...host, cpu: 1.2 }).success).toBe(false);
    expect(HostZ.safeParse({ ...host, mem: { used: 0.5, pressure: "high" } }).success).toBe(false);
    expect(HostZ.safeParse({ ...host, disks: Array(5).fill(host.disks[0]) }).success).toBe(false);
    expect(HostZ.safeParse({ ...host, temp: 40 }).success).toBe(false);
  });
  it("accepts a host message and a snapshot with or without host", () => {
    const base = { type: "snapshot", sessions: [session], usage: null, metrics, blockedMs: 0, blockedWindowMs: 0 };
    expect(MsgZ.safeParse({ type: "host", host }).success).toBe(true);
    expect(MsgZ.safeParse(base).success).toBe(true);
    expect(MsgZ.safeParse({ ...base, host }).success).toBe(true);
  });
});

describe("session context fields (spec §9.6)", () => {
  const ctx = { pct: 0.42, tokens: 84_000, window: 200_000, level: "ok" };
  it("accepts ctx, running, handoff and fromClear, and old sessions without them", () => {
    expect(SessionZ.safeParse({ ...session, ctx, running: { tool: "Bash", since: 1 }, handoff: { savedAt: 2 }, fromClear: true }).success).toBe(true);
    expect(SessionZ.safeParse({ ...session, ctx: null, running: null, handoff: null, fromClear: false }).success).toBe(true);
    expect(SessionZ.safeParse(session).success).toBe(true);
  });
  it("rejects a bad level, pct above 1 and extra keys", () => {
    expect(SessionZ.safeParse({ ...session, ctx: { ...ctx, level: "high" } }).success).toBe(false);
    expect(SessionZ.safeParse({ ...session, ctx: { ...ctx, pct: 1.2 } }).success).toBe(false);
    expect(SessionZ.safeParse({ ...session, running: { tool: "Bash", since: 1, x: 1 } }).success).toBe(false);
  });
});
