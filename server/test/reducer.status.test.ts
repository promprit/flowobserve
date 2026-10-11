import { describe, expect, it } from "vitest";
import { toWire } from "@fo/shared";
import { effectiveStatus, reduce, tick } from "../src/reducer";
import { ev, run } from "./events";
import { at } from "./helpers";

describe("status overlay", () => {
  it("a mid-cycle Stop waits for an ANSWER and the next prompt clears it", () => {
    const { s } = run([ev(1, "Skill", { skill: "writing-plans" }), ev(2, "Say", { text: "Which DB?" }), ev(3, "Await", { why: "stop", text: "" })]);
    expect(s.status).toBe("waiting");
    expect(toWire(s)).toMatchObject({ action: "ANSWER", msg: "Waiting on you · Which DB?" });
    expect(reduce(s, ev(4, "Prompt", {})).state.status).toBe("active");
  });
  it("plan written at stage 1 asks to APPROVE PLAN with the task count", () => {
    const { s } = run([ev(1, "PlanWritten", { path: "p", tasks: 7 }), ev(2, "Await", { why: "stop", text: "" })]);
    expect(toWire(s)).toMatchObject({ action: "APPROVE PLAN", msg: "Waiting on you · approve plan (7 tasks)" });
  });
  it("spec written at stage 0 asks to REVIEW SPEC", () => {
    const { s } = run([ev(1, "SpecWritten", { path: "s" }), ev(2, "Await", { why: "stop", text: "" })]);
    expect(toWire(s).action).toBe("REVIEW SPEC");
  });
  it("stop while builders work is not waiting", () => {
    const { s } = run([
      ev(1, "Dispatch", { model: "sonnet" }), ev(1, "SubStart", { subId: "a", executor: true }),
      ev(2, "Await", { why: "stop", text: "" }), ev(3, "Await", { why: "idle", text: "" }),
    ]);
    expect(s.status).toBe("active");
  });
  it("a permission prompt waits even while builders work, and the tool running clears it", () => {
    const { s } = run([
      ev(1, "Dispatch", { model: "sonnet" }), ev(1, "SubStart", { subId: "a", executor: true }),
      ev(2, "Await", { why: "notification", text: "Claude needs your permission to use Bash" }),
    ]);
    expect(s.status).toBe("waiting");
    expect(reduce(s, ev(3, "ToolPost", { tool: "Bash" })).state.status).toBe("active");
  });
  it("tool events inside a subagent do not clear waiting", () => {
    const { s } = run([ev(1, "Await", { why: "question", text: "Q" }), ev(2, "ToolPost", { tool: "Read", agentId: "a" })]);
    expect(s.status).toBe("waiting");
  });
  it("Jev deny blocks the builder that made the call and outranks waiting", () => {
    const { s } = run([
      ev(1, "Dispatch", { model: "sonnet" }), ev(1, "SubStart", { subId: "a", executor: true }),
      ev(1, "Dispatch", { model: "sonnet" }), ev(1, "SubStart", { subId: "b", executor: true }),
      ev(2, "Await", { why: "question", text: "Q" }),
      ev(3, "ToolPre", { tool: "Bash", agentId: "b" }),
      ev(3, "JevDeny", { tool: "Bash", command: "Bash rm" }),
    ]);
    expect(s.status).toBe("deny");
    expect(toWire(s)).toMatchObject({ deny: 1, builders: ["working", "blocked", "idle"], msg: "Jev denied B2 · Bash rm", action: "REVIEW DENY" });
    const cleared = reduce(s, ev(4, "Prompt", {})).state;
    expect(cleared.builders[1]).toBe("working");
    expect(cleared.status).toBe("active");
  });
  it("a deny that matches no subagent call is the main thread's", () => {
    const { s } = run([ev(1, "ToolPre", { tool: "Bash" }), ev(1, "JevDeny", { tool: "Bash", command: "Bash curl" })]);
    expect(toWire(s)).toMatchObject({ deny: null, msg: "Jev denied Main · Bash curl" });
  });
  it("goes idle after 10 quiet minutes and shipped fades to idle", () => {
    const { s } = run([ev(1, "Prompt", {})]);
    expect(tick(s, at(1) + 599_000).state.status).toBe("active");
    const idle = tick(s, at(1) + 600_000);
    expect(idle.state.status).toBe("idle");
    expect(idle.emit.transitions[0]).toMatchObject({ fromStatus: "active", toStatus: "idle", cause: "tick" });
    const shipped = run([ev(1, "Merge", {})]).s;
    expect(effectiveStatus(shipped, at(1) + 599_000)).toBe("shipped");
    expect(effectiveStatus(shipped, at(1) + 600_000)).toBe("idle");
  });
  it("since follows status changes only", () => {
    const { s } = run([ev(1, "Prompt", {}), ev(5, "Await", { why: "question", text: "Q" }), ev(9, "Say", { text: "x" })]);
    expect(s.since).toBe(at(5));
    expect(s.say).toEqual({ t: at(9), text: "x" });
  });
  it("say lines are kept as a 6-entry log", () => {
    const say = (sec: number, text: string) => ev(sec, "Say", { text });
    const a = run([say(1, "a"), say(2, "b")]).s;
    expect(a.log).toEqual([{ t: at(1), text: "a" }, { t: at(2), text: "b" }]);
    expect(a.say).toEqual({ t: at(2), text: "b" });
    // an exact repeat of the last line is not appended again
    const dup = run([say(1, "a"), say(2, "a")]).s;
    expect(dup.log).toEqual([{ t: at(1), text: "a" }]);
    // capped at the last 6
    const many = run(["a", "b", "c", "d", "e", "f", "g", "h"].map((t, i) => say(i + 1, t))).s;
    expect(many.log.map((l) => l.text)).toEqual(["c", "d", "e", "f", "g", "h"]);
    expect(toWire(many).log).toEqual(many.log);
  });
});

describe("usage and spend", () => {
  const usage = (sec: number, costUsd: number | null) => ev(sec, "Usage", { fiveHour: null, sevenDay: null, costUsd, model: "claude-opus-5-5" });
  it("statusline cost writes no spend rows (Claude spend comes from transcripts)", () => {
    const { emit } = run([usage(1, 1), usage(2, 1.5), usage(3, 1.5), usage(4, 0.2)]);
    expect(emit.spend).toEqual([]);
  });
  it("usage does not keep a resting session awake", () => {
    const { s } = run([ev(1, "Prompt", {}), usage(500, 1)]);
    expect(s.lastEventAt).toBe(at(1));
  });
});

describe("session end", () => {
  it("End while waiting closes the blocked status", () => {
    const { s, emit } = run([ev(1, "Await", { why: "question", text: "?" }), ev(2, "End", {})]);
    expect(s.retired).toBe(true);
    const last = emit.transitions[emit.transitions.length - 1];
    expect(["waiting", "deny", "handoff"]).not.toContain(last.toStatus);
  });
});
