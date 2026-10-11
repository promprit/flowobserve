import { describe, expect, it } from "vitest";
import { chainText, clip, statusText } from "../src/status";
import { openUrl, toWire } from "../src/towire";
import { SessionZ } from "../src/wire";
import type { SessionState } from "../src/types";

const state: SessionState = {
  id: "s1", name: "my app", cwd: "/Users/p/my app", worktree: null, title: null, stage: 1, status: "waiting",
  tasksDone: 0, tasksTotal: 6, builders: ["idle", "idle", "idle"], slots: {}, overflow: [],
  pendingModels: [], subModel: {}, subStartedAt: {}, reviewersDue: 0, pendingReview: [], reviewSubs: {}, deny: null,
  waiting: { kind: "plan", text: "" }, esc: null, handoff: null, shippedAt: null,
  specThisCycle: false, planThisCycle: true, cycleStart: 0, stageAt: [0, null, null, null, null, null, null], cycleHadHandoff: false,
  cycleEscalations: 0, planSkillAt: null, reviewSkillAt: null, judgeAt: null, lastPre: null,
  lastCostUsd: null, say: null, log: [], startedAt: 0, since: 0, lastEventAt: 0, retired: false,
  open: {}, wrote: null, fromClear: false, ctx: null, handoffAt: null,
};

describe("status texts (prototype templates)", () => {
  it("waiting variants", () => {
    expect(statusText({ status: "waiting", kind: "plan", tasksTotal: 6, text: "" }))
      .toEqual({ msg: "Waiting on you · approve plan (6 tasks)", action: "APPROVE PLAN" });
    expect(statusText({ status: "waiting", kind: "spec", tasksTotal: 0, text: "" }))
      .toEqual({ msg: "Waiting on you · review spec", action: "REVIEW SPEC" });
    expect(statusText({ status: "waiting", kind: "answer", tasksTotal: 0, text: "Which DB?" }))
      .toEqual({ msg: "Waiting on you · Which DB?", action: "ANSWER" });
    expect(statusText({ status: "waiting", kind: "answer", tasksTotal: 0, text: "" }).msg).toBe("Waiting on you");
  });
  it("deny, escalated, handoff, shipped, quiet", () => {
    expect(statusText({ status: "deny", builder: 1, command: "Bash rm" }))
      .toEqual({ msg: "Jev denied B2 · Bash rm", action: "REVIEW DENY" });
    expect(statusText({ status: "deny", builder: null, command: "Bash rm" }).msg).toBe("Jev denied Main · Bash rm");
    expect(statusText({ status: "escalated", builder: 0, chain: ["sonnet", "opus"] }))
      .toEqual({ msg: "B1 escalated · Sonnet ✗✗ → Opus", action: null });
    expect(statusText({ status: "escalated", builder: null, chain: ["sonnet", "opus", "fable"] }).msg)
      .toBe("Task escalated · Sonnet ✗✗ → Opus ✗ → Fable");
    expect(statusText({ status: "handoff", builder: 2, reports: 4 }))
      .toEqual({ msg: "Fable ✗ · B3 handed to you with 4 reports", action: "RESOLVE B3 · 4 REPORTS" });
    expect(statusText({ status: "shipped", tasksDone: 5, tasksTotal: 6 }))
      .toEqual({ msg: "Shipped · merged to main · 5/6 tasks", action: null });
    expect(statusText({ status: "active" })).toEqual({ msg: null, action: null });
  });
  it("clip collapses whitespace and cuts with an ellipsis", () => {
    expect(clip("a  b\n c", 60)).toBe("a b c");
    expect(clip("x".repeat(70), 60)).toBe("x".repeat(59) + "…");
  });
  it("chainText marks failures per rung", () => {
    expect(chainText(["opus", "fable"])).toBe("Opus ✗ → Fable");
  });
  it("toWire projects a valid session with an encoded vscode url", () => {
    const w = toWire(state);
    expect(SessionZ.parse(w)).toEqual(w);
    expect(w.action).toBe("APPROVE PLAN");
    expect(w.openUrl).toBe("vscode://file/Users/p/my%20app");
    expect(openUrl("")).toBeNull();
    expect(openUrl("/Users/p/a#b?c")).toBe("vscode://file/Users/p/a%23b%3Fc");
    expect(openUrl("C:/Users/dev/Desktop/HARBOR PC/harbor-website")).toBe("vscode://file/C:/Users/dev/Desktop/HARBOR%20PC/harbor-website");
  });
  it("shipped text clamps tasksDone to tasksTotal", () => {
    expect(statusText({ status: "shipped", tasksDone: 5, tasksTotal: 3 }).msg)
      .toBe("Shipped · merged to main · 3/3 tasks");
    expect(statusText({ status: "shipped", tasksDone: 1, tasksTotal: 0 }).msg)
      .toBe("Shipped · merged to main");
  });
  it("toWire never emits tasksDone above tasksTotal, raw count when total is 0", () => {
    expect(toWire({ ...state, tasksDone: 5, tasksTotal: 3 }).tasksDone).toBe(3);
    expect(toWire({ ...state, tasksDone: 2, tasksTotal: 3 }).tasksDone).toBe(2);
    expect(toWire({ ...state, tasksDone: 1, tasksTotal: 0 }).tasksDone).toBe(1);
  });
  it("toWire shipped text is clamped", () => {
    expect(toWire({ ...state, status: "shipped", tasksDone: 5, tasksTotal: 3 }).msg)
      .toBe("Shipped · merged to main · 3/3 tasks");
    expect(toWire({ ...state, status: "shipped", tasksDone: 1, tasksTotal: 0 }).msg)
      .toBe("Shipped · merged to main");
  });
});
