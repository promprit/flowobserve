import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initState, projectDir, reduce } from "../src/reducer";
import { ev, run } from "./events";
import { at } from "./helpers";

const skill = (sec: number, name: string) => ev(sec, "Skill", { skill: name });
const loop = (n: number, from: number, model: "sonnet" | "opus" | "fable" = "sonnet") =>
  Array.from({ length: n }, (_, i) => [
    ev(from + i, "Dispatch", { model }),
    ev(from + i, "SubStart", { subId: `a${from + i}`, executor: true }),
  ]).flat();

describe("stage ratchet", () => {
  it("walks a full loop to ship", () => {
    const stages: number[] = [];
    let s = initState("s1", "/Users/p/projects/app", at(0));
    const events = [
      skill(1, "superpowers:brainstorming"),
      skill(2, "superpowers:writing-plans"),
      ev(3, "PlanWritten", { path: "p.md", tasks: 2 }),
      ev(4, "JevJudge", { phase: "pre" }),
      ...loop(2, 5),
      ev(10, "SubDone", { subId: "a5", ok: true }),
      ev(11, "SubDone", { subId: "a6", ok: true }),
      skill(12, "wreview"),
      skill(13, "commit"),
      ev(14, "Merge", {}),
    ];
    for (const e of events) { s = reduce(s, e).state; stages.push(s.stage); }
    expect([...new Set(stages)]).toEqual([0, 1, 2, 3, 5, 6]);
    expect(s.status).toBe("shipped");
    expect(s.tasksDone).toBe(2);
    expect(s.tasksTotal).toBe(2);
  });

  it("a docs commit before Build does not ship (spec/plan committed via /commit)", () => {
    const { s } = run([skill(1, "superpowers:brainstorming"), ev(2, "SpecWritten", { path: "s.md" }), skill(3, "commit"),
      skill(4, "superpowers:writing-plans"), ev(5, "PlanWritten", { path: "p.md", tasks: 8 }), ev(6, "Dispatch", { model: "haiku" })]);
    expect(s.stage).toBe(3);
  });

  it("never moves back mid-cycle", () => {
    const { s } = run([skill(1, "wreview"), ev(2, "JevJudge", { phase: "pre" }), skill(3, "writing-plans")]);
    expect(s.stage).toBe(5);
  });

  it("opens a new cycle on prompt after ship, and closes the old one as shipped", () => {
    const { s, emit } = run([skill(1, "writing-plans"), ev(2, "Merge", {}), ev(3, "Prompt", {})]);
    expect(s.stage).toBe(0);
    expect(emit.cycles.map((c) => c.outcome)).toEqual(["shipped", null]);
  });

  it("counts spec and plan writes per cycle; new cycle resets", () => {
    let s = initState("s", "/r/app", 0);
    s = reduce(s, { ts: 1, sid: "s", cwd: "/r/app", agentId: null, k: "SpecWritten" } as never).state;
    s = reduce(s, { ts: 2, sid: "s", cwd: "/r/app", agentId: null, k: "SpecWritten" } as never).state;
    s = reduce(s, { ts: 3, sid: "s", cwd: "/r/app", agentId: null, k: "PlanWritten", tasks: 3 } as never).state;
    expect(s.docs).toEqual({ spec: 2, plan: 1, at: 3 });
  });

  it("docs reset when a new cycle opens after ship", () => {
    const { s } = run([ev(1, "SpecWritten", { path: "s.md" }), skill(2, "writing-plans"), ev(3, "Merge", {}), ev(4, "Prompt", {})]);
    expect(s.docs).toEqual({ spec: 0, plan: 0, at: null });
  });

  it("a prompt mid-cycle continues the cycle", () => {
    const { s } = run([skill(1, "writing-plans"), ev(2, "Prompt", {})]);
    expect(s.stage).toBe(1);
  });

  it("brainstorming mid-cycle abandons the current cycle", () => {
    const { s, emit } = run([skill(1, "writing-plans"), skill(2, "brainstorming")]);
    expect(s.stage).toBe(0);
    expect(emit.cycles[0]).toMatchObject({ outcome: "abandoned", lastStage: 1, ended: at(2) });
  });

  it("brainstorming in a fresh cycle does not open another", () => {
    expect(run([skill(1, "brainstorming")]).emit.cycles).toEqual([]);
  });
});

describe("builder slots", () => {
  it("a 4th executor waits in overflow and takes the first freed slot", () => {
    const { s, emit } = run([...loop(4, 1), ev(9, "SubDone", { subId: "a2", ok: true })]);
    expect(s.builders).toEqual(["working", "working", "working"]);
    expect(s.slots).toEqual({ a1: 0, a3: 2, a4: 1 });
    expect(s.overflow).toEqual([]);
    expect(emit.transitions.some((t) => t.cause === "slot:a4→B2")).toBe(true);
  });
  it("failed executors show failed and do not count as done", () => {
    const { s } = run([...loop(1, 1), ev(5, "SubDone", { subId: "a1", ok: false })]);
    expect(s.builders[0]).toBe("failed");
    expect(s.tasksDone).toBe(0);
  });
  it("ignores non-executor subagents", () => {
    const { s } = run([ev(1, "SubStart", { subId: "x", executor: false })]);
    expect(s.builders).toEqual(["idle", "idle", "idle"]);
  });
  it("records build calls with duration and result", () => {
    const { emit } = run([...loop(1, 1), ev(31, "SubDone", { subId: "a1", ok: true })]);
    expect(emit.calls).toContainEqual({ ts: at(31), sid: "s1", role: "build", model: "sonnet", ms: 30_000, ok: true });
  });
});

describe("escalation ladder", () => {
  const esc = (sec: number, from: "sonnet" | "opus", to: "opus" | "fable") => ev(sec, "Escalation", { from, to, task: "Task 2" });
  it("escalate then pass returns to Build", () => {
    const { s } = run([...loop(1, 1), esc(5, "sonnet", "opus"), ...loop(1, 6, "opus")]);
    expect(s.stage).toBe(4);
    expect(s.esc).toMatchObject({ builder: 1, subId: "a6", chain: ["sonnet", "opus"] });
    const after = reduce(s, ev(9, "SubDone", { subId: "a6", ok: true })).state;
    expect(after.stage).toBe(3);
    expect(after.esc).toBeNull();
  });
  it("Fable failure hands the task to you with all reports", () => {
    const { s, emit } = run([
      esc(1, "sonnet", "opus"), ...loop(1, 2, "opus"), ev(3, "SubDone", { subId: "a2", ok: false }),
      esc(4, "opus", "fable"), ...loop(1, 5, "fable"), ev(6, "SubDone", { subId: "a5", ok: false }),
    ]);
    expect(s.status).toBe("handoff");
    expect(s.handoff).toEqual({ builder: 0, reports: 4 });
    expect(emit.calls.filter((c) => c.role === "escalate").map((c) => c.model)).toEqual(["opus", "fable"]);
  });
});

describe("interrogate (Dryas §4 step 8b)", () => {
  const panel = (sec: number) => [
    ev(sec, "Dispatch", { model: "sonnet" }), ev(sec, "Dispatch", { model: "opus" }),
    ev(sec, "SubStart", { subId: "rA", executor: true }), ev(sec, "SubStart", { subId: "rB", executor: true }),
  ];
  const interrogated = () => run([
    ...loop(2, 1), ev(5, "SubDone", { subId: "a1", ok: true }), ev(6, "SubDone", { subId: "a2", ok: true }),
    skill(7, "interrogate"), ...panel(8),
    ev(20, "SubDone", { subId: "rA", ok: true }), ev(21, "SubDone", { subId: "rB", ok: true }),
    ...loop(1, 22), ev(30, "SubDone", { subId: "a22", ok: true }),
  ]);
  it("shows the panel as Review, never Escalate", () => {
    const { s } = interrogated();
    expect(s.stage).toBe(5);
    expect(s.stageAt[4]).toBeNull();
    expect(s.cycleEscalations).toBe(0);
    expect(s.esc).toBeNull();
  });
  it("logs reviewers as review calls and counts only real tasks", () => {
    const { s, emit } = interrogated();
    expect(emit.calls.filter((c) => c.role === "escalate")).toEqual([]);
    expect(emit.calls.filter((c) => c.role === "review").map((c) => c.model)).toEqual(["sonnet", "opus"]);
    expect(emit.calls.filter((c) => c.role === "build")).toHaveLength(3); // two tasks + cleanup
    expect(s.tasksDone).toBe(3);
  });
  it("the orchestrator's stop adds no third review row", () => {
    const { emit } = run([skill(1, "interrogate"), ...panel(2), ev(9, "Await", { why: "stop", text: "" }),
      ev(10, "SubDone", { subId: "rA", ok: true }), ev(11, "SubDone", { subId: "rB", ok: true })]);
    expect(emit.calls.filter((c) => c.role === "review")).toHaveLength(2);
  });
  it("a read without a panel does not mislabel the next task", () => {
    const { s, emit } = run([skill(1, "interrogate"), ev(2, "Await", { why: "stop", text: "" }), ev(3, "Prompt", {}),
      ...loop(1, 4), ev(9, "SubDone", { subId: "a4", ok: true })]);
    expect(s.tasksDone).toBe(1);
    expect(emit.calls.filter((c) => c.role === "build")).toHaveLength(1);
  });
  it("a real escalation still shows Escalate", () => {
    const { s } = run([...loop(1, 1), ev(5, "Escalation", { from: "sonnet", to: "opus", task: "Task 1" }), ...loop(1, 6, "opus")]);
    expect(s.stage).toBe(4);
  });
});

describe("projectDir", () => {
  it("projectDir strips worktree suffix", () => {
    expect(projectDir("/Users/p/app/.worktrees/feat-x")).toBe("/Users/p/app");
    expect(projectDir("/Users/p/app/.claude/worktrees/abc/src")).toBe("/Users/p/app");
    expect(projectDir("/Users/p/app/")).toBe("/Users/p/app");
    expect(initState("s", "/Users/p/app/.worktrees/x", 0)).toMatchObject({ name: "app", cwd: "/Users/p/app" });
  });
});

describe("dispatch model", () => {
  it("opus or fable dispatch enters Escalate (4); sonnet stays at 3", () => {
    expect(run([ev(1, "Dispatch", { model: "sonnet" })]).s.stage).toBe(3);
    expect(run([ev(1, "Dispatch", { model: "opus" })]).s.stage).toBe(4);
    expect(run([ev(1, "Dispatch", { model: "fable" })]).s.stage).toBe(4);
  });
});

describe("stageAt", () => {
  it("records when each stage was first entered this cycle", () => {
    const { s } = run([skill(1, "writing-plans"), ev(2, "JevJudge", { phase: "pre" }), ...loop(1, 3), skill(9, "wreview")]);
    expect(s.stageAt).toEqual([at(0), at(1), at(2), at(3), null, at(9), null]);
  });
  it("keeps the first entry when a stage is re-entered (escalate pass returns to Build)", () => {
    const { s } = run([
      ...loop(1, 1), ev(5, "Escalation", { from: "sonnet", to: "opus", task: "T" }),
      ...loop(1, 6, "opus"), ev(9, "SubDone", { subId: "a6", ok: true }),
    ]);
    expect(s.stage).toBe(3);
    expect(s.stageAt[3]).toBe(at(1));
    expect(s.stageAt[4]).toBe(at(5));
  });
  it("resets on a new cycle: stage 0 at the cycle start, the rest null", () => {
    const { s } = run([skill(1, "writing-plans"), ev(2, "Merge", {}), ev(3, "Prompt", {})]);
    expect(s.cycleStart).toBe(at(3));
    expect(s.stageAt).toEqual([at(3), null, null, null, null, null, null]);
  });
});

describe("reducer purity", () => {
  it("uses explicit project/worktree from the event", () => {
    const s0 = initState("s", "/x/y", 0, { project: "/r/app", worktree: "w1" });
    expect(s0).toMatchObject({ cwd: "/r/app", worktree: "w1", name: "app" });
    const { state } = reduce(s0, { ts: 1, sid: "s", cwd: "/elsewhere", project: "/r/app", worktree: null, agentId: null, k: "Prompt" });
    expect(state.worktree).toBeNull();
    const r2 = reduce(s0, { ts: 1, sid: "s", cwd: "/r/app/.worktrees/q", agentId: null, k: "Prompt" });
    expect(r2.state.worktree).toBe("q"); // regex fallback
  });
  it("reducer.ts does not import worktree", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/reducer.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/worktree["']/);
    expect(src).not.toMatch(/node:fs/);
  });
});
