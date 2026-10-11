import { describe, expect, it } from "vitest";
import { ev, run } from "./events";

const build = [ev(1, "Prompt", {}), ev(2, "Skill", { skill: "orchestrate" }), ev(3, "Dispatch", { model: "sonnet" })];

describe("log_review (spec §10)", () => {
  it("advances to Review and counts a round", () => {
    const r = run([...build, ev(10, "ReviewLogged", { task: null, round: null })]);
    expect(r.s.stage).toBe(5);
    expect(r.s.cycleReviews).toBe(1);
  });
  it("fix tasks after a review keep the stage at Review", () => {
    const r = run([...build, ev(10, "ReviewLogged", { task: null, round: null }), ev(11, "Dispatch", { model: "sonnet" }), ev(12, "Dispatch", { model: "opus" })]);
    expect(r.s.stage).toBe(5);
  });
  it("skill + log_review in the same round count once", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(11, "ReviewLogged", { task: null, round: null }), ev(20, "Await", { why: "stop", text: "" })]);
    expect(r.s.cycleReviews).toBe(1);
  });
  it("skill alone still counts at its stop", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(20, "Await", { why: "stop", text: "" })]);
    expect(r.s.cycleReviews).toBe(1);
  });
  it("skill stop, then log_review later in the same cycle, counts once", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(20, "Await", { why: "stop", text: "" }), ev(30, "ReviewLogged", { task: null, round: null })]);
    expect(r.s.cycleReviews).toBe(1);
    expect(r.s.stage).toBe(5);
  });
  it("a second log_review after the claim counts", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(20, "Await", { why: "stop", text: "" }), ev(30, "ReviewLogged", { task: null, round: null }), ev(40, "ReviewLogged", { task: null, round: null })]);
    expect(r.s.cycleReviews).toBe(2);
  });
  it("two log_review rounds in one turn count two", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(11, "ReviewLogged", { task: null, round: null }), ev(15, "ReviewLogged", { task: null, round: null }), ev(20, "Await", { why: "stop", text: "" })]);
    expect(r.s.cycleReviews).toBe(2);
  });
  it("same round logged twice counts once", () => {
    const r = run([...build, ev(10, "ReviewLogged", { task: "t1", round: 1 }), ev(11, "ReviewLogged", { task: "t1", round: 1 })]);
    expect(r.s.cycleReviews).toBe(1);
  });
  it("different rounds and different tasks each count", () => {
    const r = run([...build, ev(10, "ReviewLogged", { task: "t1", round: 1 }), ev(11, "ReviewLogged", { task: "t1", round: 2 }), ev(12, "ReviewLogged", { task: "t2", round: 1 })]);
    expect(r.s.cycleReviews).toBe(3);
  });
  it("a new cycle forgets seen rounds", () => {
    const r = run([...build, ev(10, "ReviewLogged", { task: "t1", round: 1 }), ev(20, "Skill", { skill: "brainstorming" }), ev(21, "Prompt", {}), ev(22, "Skill", { skill: "orchestrate" }), ev(23, "Dispatch", { model: "sonnet" }), ev(30, "ReviewLogged", { task: "t1", round: 1 })]);
    expect(r.s.cycleReviews).toBe(1);
  });
  it("/wreview stop (no log), then a new /wreview start and a log counts 2", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(20, "Await", { why: "stop", text: "" }), ev(30, "Skill", { skill: "wreview" }), ev(31, "ReviewLogged", { task: "t1", round: 1 })]);
    expect(r.s.cycleReviews).toBe(2);
  });
  it("log 20 min after an unlogged skill stop is a new round", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(20, "Await", { why: "stop", text: "" }), ev(20 + 20 * 60, "ReviewLogged", { task: null, round: null })]);
    expect(r.s.cycleReviews).toBe(2);
  });
  it("log 3 min after an unlogged skill stop still claims it", () => {
    const r = run([...build, ev(10, "Skill", { skill: "wreview" }), ev(20, "Await", { why: "stop", text: "" }), ev(20 + 3 * 60, "ReviewLogged", { task: null, round: null })]);
    expect(r.s.cycleReviews).toBe(1);
  });
});
