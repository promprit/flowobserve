import { describe, expect, it } from "vitest";
import type { Event, SessionState } from "@fo/shared";
import { initState } from "../src/reducer";
import { agentType, blankLedger, stepAgents } from "../src/agents";
import { ev } from "./events";
import { at } from "./helpers";

/** Drives stepAgents alone. An override simulates what reduce's apply changed for that event (stage, stageAt, cycleStart, reviewersDue, lastPre). */
function drive(steps: (Event | [Event, Partial<SessionState>])[]) {
  let s: SessionState = initState("s1", "/Users/p/projects/app", at(0));
  for (const x of steps) {
    const [e, o] = Array.isArray(x) ? x : [x, {}];
    const next = { ...structuredClone(s), ...o };
    stepAgents(s, next, e);
    s = next;
  }
  return s.agents!;
}
type M = "haiku" | "sonnet" | "opus" | "fable" | null;
const disp = (sec: number, subType = "executor", o: { model?: M; task?: string | null; agentId?: string | null; useId?: string | null } = {}) =>
  ev(sec, "AgentDispatch", { subType, model: o.model === undefined ? "sonnet" : o.model, task: o.task ?? null, agentId: o.agentId ?? null, useId: o.useId ?? null });
const bind = (sec: number, subId: string, useId: string) => ev(sec, "AgentBind", { subId, useId });
const start = (sec: number, id: string, agentType = "executor") => ev(sec, "SubStart", { subId: id, executor: agentType === "executor", agentType });
const stop = (sec: number, id: string, ok: boolean | null = true) => ev(sec, "SubDone", { subId: id, ok });
const pre = (sec: number, id: string, tool = "Edit") => ev(sec, "ToolPre", { tool, useId: `u${sec}`, agentId: id });
const post = (sec: number, id: string, tool = "Edit") => ev(sec, "ToolPost", { tool, useId: `u${sec}`, agentId: id });
const stageAt = (...secs: (number | null)[]) => [...secs.map((x) => (x === null ? null : at(x))), ...Array(7 - secs.length).fill(null)];

describe("agentType", () => {
  it.each([
    ["executor", false, "executor"], ["ruflo:executor", false, "executor"], ["executor", true, "interrogate"],
    ["ecc:code-reviewer", false, "reviewer"], ["caveman:cavecrew-reviewer", false, "reviewer"],
    ["Explore", false, "explore"], ["ruflo-core:researcher", false, "explore"], ["caveman:cavecrew-investigator", false, "explore"],
    ["Plan", false, "plan"], ["ecc:planner", false, "plan"], ["ruflo-swarm:architect", false, "plan"],
    ["general-purpose", false, "general"], ["claude", false, "general"], ["fork", false, "general"], ["", false, "general"],
    ["claude-code-guide", false, "other"],
  ] as const)("%s (interrogate=%s) → %s", (sub, i, want) => expect(agentType(sub, i)).toBe(want));
});

describe("stepAgents", () => {
  it("pairs a dispatch with its start: type, model, task, spawning, tally", () => {
    const l = drive([disp(1, "executor", { model: "opus", task: "T1 tester" }), start(2, "a1")]);
    expect(l.list).toEqual([expect.objectContaining({ id: "a1", type: "executor", model: "opus", task: "T1 tester", state: "spawning", parentId: null, spawnedAt: at(2) })]);
    expect(l.pending).toEqual([]);
    expect(l.tally).toEqual({ spawned: 1, passed: 0, failed: 0, escalated: 0 });
  });
  it("pairs a parallel burst in order and keeps each model", () => {
    const l = drive([disp(1, "executor", { model: "sonnet", task: "A" }), disp(1, "executor", { model: "opus", task: "B" }), disp(1, "Explore", { model: null, task: "C" }),
      start(2, "x"), start(2, "e", "Explore"), start(2, "y")]);
    expect(l.list.map((a) => [a.id, a.type, a.model, a.task])).toEqual([["x", "executor", "sonnet", "A"], ["e", "explore", null, "C"], ["y", "executor", "opus", "B"]]);
    expect(l.pending).toEqual([]);
  });
  it("an orphan start gets its own type and null model/task/parent", () => {
    expect(drive([start(1, "o", "ecc:code-reviewer")]).list[0]).toMatchObject({ type: "reviewer", model: null, task: null, parentId: null });
  });
  it("drops a dispatch that never started after 60 s", () => {
    const l = drive([disp(1), start(62, "late")]);
    expect(l.list[0]).toMatchObject({ id: "late", task: null, model: null });
    expect(l.pending).toEqual([]);
  });
  it("tool calls set running and working, ToolPost counts", () => {
    expect(drive([disp(1), start(2, "a"), pre(3, "a", "Bash")]).list[0]).toMatchObject({ state: "working", running: { tool: "Bash", since: at(3) }, toolCalls: 0 });
    expect(drive([disp(1), start(2, "a"), pre(3, "a"), post(4, "a")]).list[0]).toMatchObject({ state: "working", running: null, toolCalls: 1, lastAt: at(4) });
  });
  it("ignores main-thread tools and unknown agents", () => {
    expect(drive([disp(1), start(2, "a"), ev(3, "ToolPre", { tool: "Read", useId: "m" }), pre(4, "zz")]).list[0]).toMatchObject({ state: "spawning", running: null });
  });
  it("waiting on a permission prompt, cleared by its next tool call", () => {
    const wait = ev(3, "Await", { why: "notification", text: "Bash", agentId: "a" });
    expect(drive([disp(1), start(2, "a"), wait]).list[0].state).toBe("waiting");
    expect(drive([disp(1), start(2, "a"), wait, post(4, "a")]).list[0].state).toBe("working");
  });
  it("blocked by a Jev deny on its last tool, cleared by the next prompt", () => {
    const lastPre = { lastPre: { tool: "Bash", agentId: "a", ts: at(3) } };
    const steps: (Event | [Event, Partial<SessionState>])[] = [disp(1), start(2, "a"), [pre(3, "a", "Bash"), lastPre], ev(3, "JevDeny", { tool: "Bash", command: "rm" })];
    expect(drive(steps).list[0].state).toBe("blocked");
    expect(drive([...steps, ev(9, "Prompt", {})]).list[0].state).toBe("working");
  });
  it("done and failed end the run and count; unknown result counts as done", () => {
    const l = drive([disp(1), disp(1), start(2, "a"), start(2, "b"), stop(5, "a", true), stop(6, "b", false)]);
    expect(l.list.map((a) => [a.state, a.endedAt])).toEqual([["done", at(5)], ["failed", at(6)]]);
    expect(l.tally).toEqual({ spawned: 2, passed: 1, failed: 1, escalated: 0 });
    expect(drive([disp(1), start(2, "c"), stop(3, "c", null)]).list[0].state).toBe("done");
  });
  it("drops a done agent 30 s after it ended, keeps failed and the tally", () => {
    const l = drive([disp(1), disp(1), start(2, "a"), start(2, "b"), stop(3, "a"), stop(3, "b", false), ev(40, "Say", { text: "x" })]);
    expect(l.list.map((a) => a.id)).toEqual(["b"]);
    expect(l.tally.passed).toBe(1);
  });
  it("escalation: the failed run becomes escalated, the re-dispatch carries escalatedFrom and the task", () => {
    const l = drive([disp(1, "executor", { model: "sonnet", task: "T2" }), start(2, "s"), stop(5, "s", false),
      [ev(6, "Escalation", { from: "sonnet", to: "opus", task: "T2 auth" }), { stage: 4, stageAt: stageAt(0, null, null, null, 6) }],
      disp(7, "executor", { model: "opus" }), start(8, "o")]);
    expect(l.list.map((a) => [a.id, a.state, a.model, a.escalatedFrom, a.task])).toEqual([
      ["s", "escalated", "sonnet", null, "T2"], ["o", "spawning", "opus", "sonnet", "T2 auth"]]);
    expect(l.tally).toEqual({ spawned: 2, passed: 0, failed: 1, escalated: 1 });
  });
  it("escalation after a run that reported done moves it from passed to failed", () => {
    const l = drive([disp(1), start(2, "s"), stop(5, "s", null), ev(6, "Escalation", { from: "sonnet", to: "opus", task: "T" })]);
    expect(l.tally).toMatchObject({ passed: 0, failed: 1 });
    expect(l.list[0].state).toBe("escalated");
  });
  it("chains sonnet → opus → fable", () => {
    const l = drive([disp(1), start(2, "s"), stop(3, "s", false), ev(4, "Escalation", { from: "sonnet", to: "opus", task: "T" }),
      disp(5, "executor", { model: "opus" }), start(6, "o"), stop(7, "o", false), ev(8, "Escalation", { from: "opus", to: "fable", task: "T" }),
      disp(9, "executor", { model: "fable" }), start(10, "f")]);
    expect(l.list.map((a) => [a.model, a.state, a.escalatedFrom])).toEqual([
      ["sonnet", "escalated", null], ["opus", "escalated", "sonnet"], ["fable", "spawning", "opus"]]);
    expect(l.tally).toEqual({ spawned: 3, passed: 0, failed: 2, escalated: 2 });
  });
  it("nests under the dispatching agent and re-parents depth 3 to level 2", () => {
    const l = drive([disp(1), start(2, "p"), disp(3, "Explore", { agentId: "p", model: null }), start(4, "c", "Explore"),
      disp(5, "general-purpose", { agentId: "c", model: null }), start(6, "g", "general-purpose")]);
    expect(l.list.map((a) => [a.id, a.parentId])).toEqual([["p", null], ["c", "p"], ["g", "p"]]);
  });
  it("interrogate panel executors are typed interrogate", () => {
    expect(drive([[disp(1), { reviewersDue: 2 }], start(2, "r")]).list[0].type).toBe("interrogate");
  });
  it("a failure stays through its own stage, leaves at the next stage change; a silent live agent becomes failed", () => {
    const l = drive([disp(1), disp(1), start(2, "quiet"), start(2, "bad"), stop(3, "bad", false),
      [ev(4, "Skill", { skill: "orchestrate" }), { stage: 1, stageAt: stageAt(0, 4) }],
      [ev(700, "Skill", { skill: "wreview" }), { stage: 5, stageAt: stageAt(0, 4, null, null, null, 700) }]]);
    expect(l.list.map((a) => [a.id, a.state])).toEqual([["quiet", "failed"]]);
    expect(l.tally.failed).toBe(2);
  });
  it("a live agent with recent activity survives a stage change", () => {
    expect(drive([disp(1), start(2, "a"), pre(650, "a"), [ev(700, "Skill", { skill: "wreview" }), { stage: 5 }]]).list[0].state).toBe("working");
  });
  it("never marks stale on a timer alone", () => {
    expect(drive([disp(1), start(2, "a"), ev(5000, "Say", { text: "x" })]).list[0].state).toBe("spawning");
  });
  it("SessionEnd applies the stale rule", () => {
    expect(drive([disp(1), start(2, "a"), ev(700, "End", {})]).list[0].state).toBe("failed");
  });
  it("a new cycle resets the ledger and tally", () => {
    expect(drive([disp(1), start(2, "a"), [ev(9, "Prompt", {}), { cycleStart: at(9) }]])).toEqual(blankLedger());
  });
  it("creates the ledger for a session saved without one", () => {
    expect(drive([start(1, "a")]).tally.spawned).toBe(1);
  });
  it("ignores a duplicate start", () => {
    expect(drive([disp(1), start(2, "a"), start(2, "a")]).list).toHaveLength(1);
  });
});

describe("stepAgents exact binding, resumes, escalation target, stale, escNext", () => {
  const E = (sec: number) => ev(sec, "End", {});
  it("bind swaps two crossed agents: task, model and escalatedFrom follow the useId", () => {
    const l = drive([disp(1, "executor", { model: "sonnet", task: "A", useId: "u1" }),
      ev(1, "Escalation", { from: "sonnet", to: "opus", task: "B" }),
      disp(1, "executor", { model: "opus", task: "B", useId: "u2" }),
      start(2, "x"), start(2, "y"), bind(3, "x", "u2"), bind(3, "y", "u1")]);
    expect(l.list.map((a) => [a.id, a.model, a.task, a.escalatedFrom, a.useId])).toEqual([
      ["x", "opus", "B", "sonnet", "u2"], ["y", "sonnet", "A", null, "u1"]]);
    expect(l.tally).toEqual({ spawned: 2, passed: 0, failed: 0, escalated: 1 });
  });
  it("bind before start pairs by useId even when FIFO would pick another", () => {
    const l = drive([disp(1, "executor", { model: "sonnet", task: "A", useId: "u1" }), disp(1, "executor", { model: "opus", task: "B", useId: "u2" }),
      bind(2, "x", "u2"), start(3, "x"), start(3, "y")]);
    expect(l.list.map((a) => [a.id, a.model, a.task])).toEqual([["x", "opus", "B"], ["y", "sonnet", "A"]]);
    expect(l.pending).toEqual([]);
    expect(l.tally).toEqual({ spawned: 2, passed: 0, failed: 0, escalated: 0 });
  });
  it("bind to a pending entry re-keys: the agent takes it and its old dispatch goes back to pending", () => {
    const l = drive([disp(1, "executor", { model: "sonnet", task: "A", useId: "u1" }), disp(2, "executor", { model: "opus", task: "B", useId: "u2" }),
      start(3, "x"), bind(4, "x", "u2")]);
    expect(l.list).toEqual([expect.objectContaining({ id: "x", model: "opus", task: "B", useId: "u2" })]);
    expect(l.pending).toEqual([expect.objectContaining({ model: "sonnet", task: "A", useId: "u1", at: at(1) })]);
  });
  it("a resumed agent within 30 s reopens and its second stop counts once", () => {
    const l = drive([disp(1), start(2, "a"), stop(5, "a"), start(10, "a")]);
    expect(l.list).toEqual([expect.objectContaining({ id: "a", endedAt: null, state: "working", running: null, lastAt: at(10) })]);
    expect(l.tally).toEqual({ spawned: 1, passed: 0, failed: 0, escalated: 0 });
    const l2 = drive([disp(1), start(2, "a"), stop(5, "a"), start(10, "a"), stop(12, "a")]);
    expect(l2.list).toHaveLength(1);
    expect(l2.tally).toEqual({ spawned: 1, passed: 1, failed: 0, escalated: 0 });
  });
  it("a resumed failed agent undoes the failure", () => {
    const l = drive([disp(1), start(2, "a"), stop(5, "a", false), start(10, "a")]);
    expect(l.tally).toEqual({ spawned: 1, passed: 0, failed: 0, escalated: 0 });
    expect(l.list[0].state).toBe("working");
  });
  it("resumed after the done agent was dropped: re-created, no pending stolen, no double count", () => {
    const l = drive([disp(1, "executor", { task: "T" }), start(2, "a"), stop(3, "a"), disp(40, "executor", { task: "other" }), start(41, "a")]);
    expect(l.list).toEqual([expect.objectContaining({ id: "a", type: "executor", model: "sonnet", task: "T", endedAt: null, state: "working" })]);
    expect(l.pending).toEqual([expect.objectContaining({ task: "other" })]);
    expect(l.tally).toEqual({ spawned: 1, passed: 0, failed: 0, escalated: 0 });
    expect(drive([disp(1), start(2, "a"), stop(3, "a"), disp(40), start(41, "a"), stop(45, "a")]).tally).toEqual({ spawned: 1, passed: 1, failed: 0, escalated: 0 });
  });
  it("a resumed agent dropped after done keeps its task, model, useId and parent", () => {
    const l = drive([disp(0, "executor", { task: "P" }), start(1, "p"),
      disp(2, "executor", { model: "opus", task: "T", agentId: "p", useId: "u1" }), start(3, "a"), stop(4, "a"),
      ev(40, "Say", { text: "x" }), start(41, "a")]);
    expect(l.list.find((x) => x.id === "a")).toMatchObject({ type: "executor", model: "opus", task: "T", useId: "u1", parentId: "p", endedAt: null, state: "working" });
    expect(l.tally).toEqual({ spawned: 2, passed: 0, failed: 0, escalated: 0 });
  });
  it("a dropped failed-and-escalated agent resumes with its escalatedFrom and the tally stays whole", () => {
    const l = drive([disp(1, "executor", { model: "sonnet", task: "A" }), start(2, "s"), stop(3, "s", false),
      ev(4, "Escalation", { from: "sonnet", to: "opus", task: "A" }), disp(5, "executor", { model: "opus", useId: "u2" }), start(6, "o"), stop(7, "o"),
      ev(50, "Say", { text: "x" }), start(51, "o")]);
    expect(l.list.find((x) => x.id === "o")).toMatchObject({ model: "opus", task: "A", escalatedFrom: "sonnet", useId: "u2" });
    expect(l.tally).toEqual({ spawned: 2, passed: 0, failed: 1, escalated: 1 });
  });
  it("escalation: an older failed run on another task loses to the done run whose task matches", () => {
    const l = drive([disp(1, "executor", { task: "T1" }), disp(1, "executor", { task: "T2" }), start(2, "a"), start(2, "b"), stop(3, "a", false), stop(4, "b"),
      ev(5, "Escalation", { from: "sonnet", to: "opus", task: "T2" })]);
    expect(l.list.map((a) => [a.id, a.state])).toEqual([["a", "failed"], ["b", "escalated"]]);
    expect(l.tally).toEqual({ spawned: 2, passed: 0, failed: 2, escalated: 0 });
  });
  it("a bind never makes an agent its own parent", () => {
    const l = drive([disp(1, "executor", { agentId: "x", useId: "u1" }), start(2, "x"), bind(3, "x", "u1")]);
    expect(l.list[0].parentId).toBeNull();
    const m = drive([disp(1, "executor", { useId: "u1" }), start(2, "x"), disp(3, "executor", { agentId: "x", useId: "u2" }), bind(4, "x", "u2")]);
    expect(m.list[0].parentId).not.toBe("x");
  });
  it("escalation prefers the failed sibling over a later done sibling", () => {
    const l = drive([disp(1), disp(1), start(2, "a"), start(2, "b"), stop(3, "a", false), stop(4, "b", true), ev(5, "Escalation", { from: "sonnet", to: "opus", task: "T" })]);
    expect(l.list.map((a) => [a.id, a.state])).toEqual([["a", "escalated"], ["b", "done"]]);
    expect(l.tally).toEqual({ spawned: 2, passed: 1, failed: 1, escalated: 0 });
  });
  it("escalation falls back to the sibling whose task matches, then the latest done", () => {
    const l = drive([disp(1, "executor", { task: "T1" }), disp(1, "executor", { task: "T2" }), start(2, "a"), start(2, "b"), stop(3, "a"), stop(4, "b"),
      ev(5, "Escalation", { from: "sonnet", to: "opus", task: "T1" })]);
    expect(l.list.map((a) => [a.id, a.state])).toEqual([["a", "escalated"], ["b", "done"]]);
    expect(l.tally).toEqual({ spawned: 2, passed: 1, failed: 1, escalated: 0 });
    const m = drive([disp(1, "executor", { task: "T1" }), disp(1, "executor", { task: "T2" }), start(2, "a"), start(2, "b"), stop(3, "a"), stop(4, "b"),
      ev(5, "Escalation", { from: "sonnet", to: "opus", task: "zzz" })]);
    expect(m.list.map((a) => [a.id, a.state])).toEqual([["a", "done"], ["b", "escalated"]]);
  });
  it("the stale rule spares a running agent and a waiting agent but still fails a silent one", () => {
    const wait = ev(3, "Await", { why: "notification", text: "Bash", agentId: "w" });
    const l = drive([disp(1), disp(1), disp(1), start(2, "r"), start(2, "w"), start(2, "q"), pre(3, "r", "Bash"), wait, E(700)]);
    expect(l.list.map((a) => [a.id, a.state])).toEqual([["r", "working"], ["w", "waiting"], ["q", "failed"]]);
    expect(l.tally).toEqual({ spawned: 3, passed: 0, failed: 1, escalated: 0 });
  });
  it("an escNext older than 10 min is ignored and cleared", () => {
    const l = drive([ev(6, "Escalation", { from: "sonnet", to: "opus", task: "T" }), disp(700, "executor", { model: "opus" }), start(701, "o")]);
    expect(l.list[0]).toMatchObject({ model: "opus", task: null, escalatedFrom: null });
    expect(l.escNext).toBeNull();
    expect(l.tally.escalated).toBe(0);
  });
  it("a ledger saved before binds/outcome existed still binds and resumes", () => {
    const old = { list: [], pending: [], tally: { spawned: 0, passed: 0, failed: 0, escalated: 0 }, escNext: null } as unknown as SessionState["agents"];
    const l = drive([[disp(1, "executor", { task: "A", useId: "u1" }), { agents: old }], bind(2, "zz", "u1"), start(3, "zz"), stop(4, "zz"), start(5, "zz")]);
    expect(l.list).toEqual([expect.objectContaining({ id: "zz", task: "A", state: "working", endedAt: null })]);
    expect(l.tally).toEqual({ spawned: 1, passed: 0, failed: 0, escalated: 0 });
  });
  it("a failed haiku run re-dispatched on sonnet marks the haiku run escalated and tags the sonnet run", () => {
    const l = drive([disp(1, "executor", { model: "haiku" }), start(2, "h"), stop(3, "h", false),
      ev(4, "Escalation", { from: "haiku", to: "sonnet", task: "T" }), disp(5), start(6, "s")]);
    expect(l.list.map((a) => [a.id, a.state, a.model, a.escalatedFrom])).toEqual([["h", "escalated", "haiku", null], ["s", "spawning", "sonnet", "haiku"]]);
    expect(l.tally).toEqual({ spawned: 2, passed: 0, failed: 1, escalated: 1 });
  });
  it("a skip-up from haiku with no haiku run arms nothing and marks nothing", () => {
    const l = drive([ev(1, "Escalation", { from: "haiku", to: "sonnet", task: "T" }), disp(2), start(3, "s")]);
    expect(l.escNext).toBeNull();
    expect(l.list.map((a) => [a.id, a.model, a.escalatedFrom])).toEqual([["s", "sonnet", null]]);
    expect(l.tally.escalated).toBe(0);
  });});
