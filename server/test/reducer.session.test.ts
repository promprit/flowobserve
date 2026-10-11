import { describe, expect, it } from "vitest";
import { toWire } from "@fo/shared";
import { reduce } from "../src/reducer";
import { ev, run } from "./events";
import { at } from "./helpers";

describe("open tools (running)", () => {
  it("Pre opens, Post closes, oldest open tool is running", () => {
    const { s } = run([ev(1, "ToolPre", { tool: "Bash", useId: "a" }), ev(2, "ToolPre", { tool: "Read", useId: "b" })]);
    expect(toWire(s).running).toEqual({ tool: "Bash", since: at(1) });
    const s2 = reduce(s, ev(3, "ToolPost", { tool: "Bash", useId: "a" })).state;
    expect(toWire(s2).running).toEqual({ tool: "Read", since: at(2) });
  });
  it("a subagent's long tool survives the main thread's Stop and your next prompt; SessionEnd clears all", () => {
    const { s } = run([
      ev(1, "ToolPre", { tool: "Bash", useId: "sub", agentId: "ag1" }),
      ev(2, "ToolPre", { tool: "Read", useId: "main" }),
      ev(3, "Await", { why: "stop", text: "" }),
    ]);
    expect(toWire(s).running).toEqual({ tool: "Bash", since: at(1) });
    const s2 = reduce(reduce(s, ev(4, "ToolPre", { tool: "Grep", useId: "main2" })).state, ev(5, "Prompt", {})).state;
    expect(Object.keys(s2.open)).toEqual(["sub"]);
    expect(toWire(reduce(s, ev(4, "End", {})).state).running).toBeNull();
  });
  it("a subagent's open tools close when that subagent stops, executor or not", () => {
    const { s } = run([
      ev(1, "SubStart", { subId: "ag1", executor: false }),
      ev(2, "ToolPre", { tool: "Bash", useId: "a", agentId: "ag1" }),
      ev(3, "ToolPre", { tool: "Read", useId: "b", agentId: "ag2" }),
      ev(4, "SubDone", { subId: "ag1", ok: null }),
    ]);
    expect(Object.keys(s.open)).toEqual(["b"]);
  });
  it("tool events without an id change nothing; entries older than 24 h are dropped", () => {
    const { s } = run([ev(1, "ToolPre", { tool: "Bash" }), ev(2, "ToolPre", { tool: "Grep", useId: "g" })]);
    expect(Object.keys(s.open)).toEqual(["g"]);
    const later = reduce(s, ev(90_000, "Say", { text: "x" })).state;
    expect(toWire(later).running).toBeNull();
  });
});

describe("chip kind", () => {
  it("plan kind only until your next prompt; a later question is ANSWER", () => {
    const { s } = run([ev(1, "PlanWritten", { path: "p", tasks: 3 }), ev(2, "Await", { why: "stop", text: "" })]);
    expect(toWire(s).action).toBe("APPROVE PLAN");
    const s2 = reduce(reduce(s, ev(3, "Prompt", {})).state, ev(4, "Await", { why: "stop", text: "Go with A?" })).state;
    expect(toWire(s2).action).toBe("ANSWER");
  });
});

describe("/clear start (RESUME)", () => {
  it("a session started by /clear is fromClear until the first prompt", () => {
    const { s } = run([ev(1, "SessionSeen", { source: "clear" })]);
    expect(toWire(s).fromClear).toBe(true);
    expect(toWire(reduce(s, ev(2, "Prompt", {})).state).fromClear).toBe(false);
    expect(toWire(run([ev(1, "SessionSeen", { source: "startup" })]).s).fromClear).toBe(false);
  });
});

describe("passive Ctx and Handoff events", () => {
  it("set state without counting as activity", () => {
    const { s } = run([ev(5, "Say", { text: "hi" })]);
    const ctx = { pct: 0.42, tokens: 84_000, window: 200_000, level: "ok" as const };
    const s2 = reduce(reduce(s, ev(50, "Ctx", { ctx })).state, ev(60, "Handoff", { savedAt: at(55) })).state;
    expect(s2.lastEventAt).toBe(at(5));
    expect(toWire(s2)).toMatchObject({ ctx, handoff: { savedAt: at(55) } });
    expect(toWire(reduce(s2, ev(61, "Handoff", { savedAt: null })).state).handoff).toBeNull();
  });
});

describe("Dryas KPI inputs", () => {
  it("an Escalation emits one escalation row", () => {
    const { emit } = run([ev(1, "Escalation", { from: "sonnet", to: "opus", task: "Task 2: parser" })]);
    expect(emit.escalations).toEqual([{ ts: at(1), sid: "s1", task: "Task 2: parser", from: "sonnet", to: "opus" }]);
  });

  it("each finished review skill run counts toward the cycle's reviews; interrogate does not", () => {
    const { s } = run([
      ev(1, "Skill", { skill: "superpowers:wreview" }), ev(2, "Await", { why: "stop", text: "" }),
      ev(3, "Skill", { skill: "wreview" }), ev(4, "Await", { why: "stop", text: "" }),
      ev(5, "Skill", { skill: "interrogate" }), ev(6, "Await", { why: "stop", text: "" }),
    ]);
    expect(s.cycleReviews).toBe(2);
  });
  it("the real /wreview path (superpowers:requesting-code-review) counts one review", () => {
    const { s } = run([ev(1, "Skill", { skill: "superpowers:requesting-code-review" }), ev(2, "Await", { why: "stop", text: "" })]);
    expect(s.cycleReviews).toBe(1);
  });

  it("a review skill invoked inside a subagent does not count", () => {
    const { s } = run([
      ev(1, "Skill", { skill: "superpowers:requesting-code-review", agentId: "ag1" }),
      ev(2, "Await", { why: "stop", text: "" }),
    ]);
    expect(s.cycleReviews).toBe(0);
  });

  it("a review after Merge emits a second shipped cycle row with the new count, same started/ended", () => {
    const { emit } = run([
      ev(1, "Merge", {}),
      ev(2, "Skill", { skill: "superpowers:requesting-code-review" }), ev(3, "Await", { why: "stop", text: "" }),
    ]);
    const shipped = emit.cycles.filter((c) => c.outcome === "shipped");
    expect(shipped).toHaveLength(2);
    expect(shipped[0]).toMatchObject({ reviews: 0, ended: at(1) });
    expect(shipped[1]).toMatchObject({ reviews: 1, ended: at(1), started: shipped[0].started });
  });

  it("cycle rows carry planTasks = tasksTotal; the open row carries 0", () => {
    const { emit } = run([ev(1, "PlanWritten", { path: "p", tasks: 4 }), ev(2, "Merge", {}), ev(3, "Prompt", {})]);
    expect(emit.cycles.find((c) => c.outcome === "shipped")).toMatchObject({ planTasks: 4 });
    expect(emit.cycles.find((c) => c.outcome === null)).toMatchObject({ planTasks: 0 });
  });
});

describe("AgentBind is passive", () => {
  it("does not change lastEventAt, spare or status", () => {
    const { s } = run([ev(1, "SessionSeen", { source: "startup" })]);
    expect(s.spare).toBe(true);
    const r = reduce(s, ev(30, "AgentBind", { subId: "a1", useId: "toolu_1" })).state;
    expect(r.lastEventAt).toBe(s.lastEventAt);
    expect(r.spare).toBe(true);
    expect(r.status).toBe(s.status);
  });
});
