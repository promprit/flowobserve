import { describe, expect, it } from "vitest";
import { toWire } from "../src/towire";
import type { SessionState } from "../src/types";
import { SessionZ, UsageZ } from "../src/wire";

const session = {
  id: "s1", name: "app", stage: 3, status: "active", tasksDone: 1, tasksTotal: 4,
  builders: ["working", "done", "idle"], deny: null, esc: false, msg: null, action: null,
  say: null, openUrl: "vscode://file/Users/p/app", startedAt: 1, since: 1, lastEventAt: 2,
  nodes: [], stageAt: [1, null, null, null, null, null, null], log: [],
};
const state: SessionState = {
  id: "s1", name: "app", cwd: "/Users/p/app", worktree: null, title: null, stage: 0, status: "active",
  tasksDone: 0, tasksTotal: 0, builders: ["idle", "idle", "idle"], slots: {}, overflow: [],
  pendingModels: [], subModel: {}, subStartedAt: {}, reviewersDue: 0, pendingReview: [], reviewSubs: {}, deny: null,
  waiting: null, esc: null, handoff: null, shippedAt: null,
  specThisCycle: false, planThisCycle: false, cycleStart: 100, stageAt: [100, null, null, null, null, null, null],
  cycleHadHandoff: false, cycleEscalations: 0, planSkillAt: null, reviewSkillAt: null, judgeAt: null, lastPre: null,
  lastCostUsd: null, say: null, log: [], startedAt: 100, since: 100, lastEventAt: 100, retired: false,
  open: {}, wrote: null, fromClear: false, ctx: null, handoffAt: null, acct: "~/.claude-personal",
};

describe("SessionZ account", () => {
  it("accepts a session without and with an account", () => {
    expect(SessionZ.parse(session)).toEqual(session);
    const s = { ...session, account: { label: "Pro", dryas: false } };
    expect(SessionZ.parse(s)).toEqual(s);
  });
  it("rejects extra keys and empty or long labels", () => {
    expect(SessionZ.safeParse({ ...session, account: { label: "Pro", dryas: false, dir: "~/.claude" } }).success).toBe(false);
    expect(SessionZ.safeParse({ ...session, account: { label: "", dryas: true } }).success).toBe(false);
    expect(SessionZ.safeParse({ ...session, account: { label: "x".repeat(33), dryas: true } }).success).toBe(false);
  });
});

describe("toWire account", () => {
  it("adds account only when the engine passes one; acct itself never goes on the wire", () => {
    expect("account" in toWire(state)).toBe(false);
    expect(JSON.stringify(toWire(state))).not.toContain("claude-personal");
    expect(toWire(state, { account: { label: "Pro", dryas: false } }).account).toEqual({ label: "Pro", dryas: false });
  });
});

const usage = { session: { used: 0.4, startedAt: 0, windowMs: 18_000_000 }, weekly: { used: 0.2, resetsAt: 9 }, jev: null, at: 5 };
const row = { label: "Pro", session: usage.session, weekly: usage.weekly, at: 5 };

describe("UsageZ accounts", () => {
  it("accepts the old shape and the per-account shape", () => {
    expect(UsageZ.parse(usage)).toEqual(usage);
    expect(UsageZ.parse({ ...usage, accounts: [{ ...row, label: "Team", primary: true }, row] }).accounts).toHaveLength(2);
  });
  it("accepts an account row whose weekly is null", () => {
    const r = { ...row, weekly: null };
    expect(UsageZ.parse({ ...usage, accounts: [r] }).accounts![0].weekly).toBeNull();
  });
  it("rejects an account row with no weekly key or weekly used above 1", () => {
    const { weekly: _omit, ...noWeekly } = row;
    expect(UsageZ.safeParse({ ...usage, accounts: [noWeekly] }).success).toBe(false);
    expect(UsageZ.safeParse({ ...usage, accounts: [{ ...row, weekly: { used: 1.2, resetsAt: 9 } }] }).success).toBe(false);
  });
  it("accepts a per-account fable (or null) and rejects one out of bounds", () => {
    expect(UsageZ.parse({ ...usage, accounts: [{ ...row, fable: { used: 0.3, resetsAt: 9 } }, { ...row, fable: null }] }).accounts![0].fable).toEqual({ used: 0.3, resetsAt: 9 });
    expect(UsageZ.safeParse({ ...usage, accounts: [{ ...row, fable: { used: 1.5, resetsAt: 9 } }] }).success).toBe(false);
  });
  it("rejects more than 8 accounts and unknown row keys", () => {
    expect(UsageZ.safeParse({ ...usage, accounts: Array(9).fill(row) }).success).toBe(false);
    expect(UsageZ.safeParse({ ...usage, accounts: [{ ...row, dir: "~/.claude" }] }).success).toBe(false);
  });
});

describe("UsageZ switch", () => {
  it("accepts a hint, null or none; near on a row; used stays 0..1", () => {
    expect(UsageZ.parse({ ...usage, switch: { from: "Team", to: "Pro", used: 0.92 } }).switch).toEqual({ from: "Team", to: "Pro", used: 0.92 });
    expect(UsageZ.parse({ ...usage, switch: null }).switch).toBeNull();
    expect(UsageZ.parse({ ...usage, accounts: [{ ...row, near: true }] }).accounts![0].near).toBe(true);
    expect(UsageZ.safeParse({ ...usage, switch: { from: "Team", to: "Pro", used: 1.2 } }).success).toBe(false);
  });
});
