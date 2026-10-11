import { describe, expect, it } from "vitest";
import { toNodes, toWire } from "../src/towire";
import { NodeZ, SessionZ } from "../src/wire";
import type { ExecModel, SessionState } from "../src/types";

const base: SessionState = {
  id: "s1", name: "app", cwd: "/Users/p/app", worktree: null, title: null, stage: 0, status: "active",
  tasksDone: 0, tasksTotal: 3, builders: ["idle", "idle", "idle"], slots: {}, overflow: [],
  pendingModels: [], subModel: {}, subStartedAt: {}, reviewersDue: 0, pendingReview: [], reviewSubs: {}, deny: null,
  waiting: null, esc: null, handoff: null, shippedAt: null,
  specThisCycle: false, planThisCycle: false, cycleStart: 100, stageAt: [100, null, null, null, null, null, null],
  cycleHadHandoff: false, cycleEscalations: 0, planSkillAt: null, reviewSkillAt: null, judgeAt: null, lastPre: null,
  lastCostUsd: null, say: null, log: [], startedAt: 100, since: 100, lastEventAt: 100, retired: false,
  open: {}, wrote: null, fromClear: false, ctx: null, handoffAt: null,
};
const st = (p: Partial<SessionState>): SessionState => ({ ...base, ...p });
const N = { model: null, startedAt: null, task: null, waiting: null };

describe("toNodes", () => {
  it("a quiet session at stage 0 has nothing to inspect", () => {
    expect(toNodes(base)).toEqual([]);
  });
  it("you appears only while waiting, with the waiting text and since", () => {
    const s = st({ status: "waiting", since: 400, waiting: { kind: "answer", text: "Which DB?" } });
    expect(toNodes(s)).toEqual([{ ...N, key: "you", state: "waiting", startedAt: 400, waiting: "Which DB?" }]);
    expect(toNodes(st({ status: "waiting", waiting: { kind: "plan", text: "" } }))[0].waiting).toBeNull();
  });
  it("builders take model and run start from their slot; idle without a sub is omitted", () => {
    const s = st({ stage: 3, builders: ["working", "done", "idle"], slots: { a1: 0 }, subModel: { a1: "sonnet" }, subStartedAt: { a1: 500 } });
    expect(toNodes(s)).toEqual([
      { ...N, key: "b0", state: "working", model: "sonnet", startedAt: 500 },
      { ...N, key: "b1", state: "done" },
    ]);
  });
  it("the escalated builder carries the task; fable appears only when the chain ends in fable", () => {
    const esc = { builder: 2, subId: "f1", chain: ["sonnet", "opus", "fable"] as ExecModel[], failures: 3, task: "Task 2" };
    const s = st({ stage: 4, status: "escalated", builders: ["done", "done", "working"], slots: { f1: 2 }, subModel: { f1: "fable" }, subStartedAt: { f1: 900 }, esc });
    expect(toNodes(s)).toEqual([
      { ...N, key: "b0", state: "done" },
      { ...N, key: "b1", state: "done" },
      { ...N, key: "b2", state: "working", model: "fable", startedAt: 900, task: "Task 2" },
      { ...N, key: "fable", state: "escalated", model: "fable", startedAt: 900, task: "Task 2" },
    ]);
    expect(toNodes({ ...s, esc: { ...esc, chain: ["sonnet", "opus"] } }).some((n) => n.key === "fable")).toBe(false);
  });
  it("plan, review and main appear only as the current stage", () => {
    const at = [100, 200, 300, 400, null, 600, 700];
    expect(toNodes(st({ stage: 1, stageAt: at }))).toEqual([{ ...N, key: "plan", state: "current", startedAt: 200 }]);
    expect(toNodes(st({ stage: 5, stageAt: at }))).toEqual([{ ...N, key: "review", state: "current", startedAt: 600 }]);
    expect(toNodes(st({ stage: 6, stageAt: at }))).toEqual([{ ...N, key: "main", state: "current", startedAt: 700 }]);
    expect(toNodes(st({ stage: 2, stageAt: at }))).toEqual([]);
  });
  it("clips task and waiting text to the wire limits", () => {
    const long = "x".repeat(400);
    expect(toNodes(st({ status: "waiting", waiting: { kind: "answer", text: long } }))[0].waiting!.length).toBe(280);
    const s = st({ stage: 4, builders: ["working", "idle", "idle"], slots: { a: 0 }, subModel: { a: "opus" }, subStartedAt: { a: 1 },
      esc: { builder: 0, subId: "a", chain: ["sonnet", "opus"], failures: 2, task: long } });
    expect(toNodes(s)[0].task!.length).toBe(160);
  });
});

describe("toWire", () => {
  it("emits nodes and a copy of stageAt, and parses strictly", () => {
    const s = st({ stage: 1, stageAt: [100, 200, null, null, null, null, null] });
    const w = toWire(s);
    expect(w.nodes).toEqual([{ ...N, key: "plan", state: "current", startedAt: 200 }]);
    expect(w.stageAt).toEqual(s.stageAt);
    expect(w.stageAt).not.toBe(s.stageAt);
    expect(SessionZ.parse(w)).toEqual(w);
  });
  it("running is the oldest open tool call and parses", () => {
    const s = st({ open: { x: { tool: "Bash", since: 5, agent: null } } });
    expect(toWire(s).running).toEqual({ tool: "Bash", since: 5 });
    expect(() => SessionZ.parse(toWire(s))).not.toThrow();
  });
});

describe("NodeZ", () => {
  it("rejects unknown keys, extra fields and over-long text", () => {
    const n = { ...N, key: "b0", state: "working" };
    expect(NodeZ.safeParse(n).success).toBe(true);
    expect(NodeZ.safeParse({ ...n, key: "b3" }).success).toBe(false);
    expect(NodeZ.safeParse({ ...n, extra: 1 }).success).toBe(false);
    expect(NodeZ.safeParse({ ...n, task: "x".repeat(161) }).success).toBe(false);
  });
});
