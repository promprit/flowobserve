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

// UsageZ cases are appended by later tasks.
void UsageZ;
