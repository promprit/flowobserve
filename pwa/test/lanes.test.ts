import { describe, expect, it } from "vitest";
import { agentView } from "../src/agents";
import { LANE_MAX, laneTitle, laneView, taskNum } from "../src/lanes";
import { T0, agent } from "./helpers";

const T = (n: number) => `worktree-x:${n}`;
const lv = (agents: ReturnType<typeof agent>[], o: { tasksTotal?: number; tasksDone?: number; esc?: boolean } = {}) =>
  laneView({ tasksTotal: 0, tasksDone: 0, ...o }, agentView({ agents }, T0));

describe("laneView", () => {
  it("nothing known: one single centre lane", () => {
    expect(lv([])).toEqual({ open: [], done: 0, queued: 0, overflow: 0, single: true });
    expect(laneView({ tasksTotal: 0, tasksDone: 0 }, null).single).toBe(true);
  });
  it("plan of 4, two running: 2 open, 2 queued", () => {
    const r = lv([agent("a", { taskId: T(1), role: "coder" }), agent("b", { taskId: T(2), role: "coder" })], { tasksTotal: 4 });
    expect([r.open.map((l) => l.num), r.queued, r.done, r.single]).toEqual([[1, 2], 2, 0, false]);
  });
  it("tester then coder stay on one lane; tester done, coder not spawned keeps it open", () => {
    const tst = agent("t", { taskId: T(3), role: "tester", state: "done", endedAt: T0 - 1000 });
    expect(lv([tst], { tasksTotal: 3 }).open.map((l) => [l.num, l.state, l.role])).toEqual([[3, "handoff", "tester"]]);
    const r = lv([tst, agent("c", { taskId: T(3), role: "coder", spawnedAt: T0 - 500 })], { tasksTotal: 3 });
    expect(r.open.length).toBe(1);
    expect([r.open[0].role, r.open[0].lines.length]).toEqual(["coder", 2]);
  });
  it("Haiku → Sonnet climb: rung sonnet, climbed [haiku]", () => {
    const r = lv([
      agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }),
      agent("s", { taskId: T(1), model: "sonnet", escalatedFrom: "haiku", spawnedAt: T0 - 4000 }),
    ], { tasksTotal: 1 });
    expect([r.open[0].rung, r.open[0].climbed]).toEqual(["sonnet", ["haiku"]]);
  });
  it("an escalated head is climbing; an Opus head with session esc is frontier", () => {
    expect(lv([agent("h", { taskId: T(1), model: "haiku", state: "escalated" })], { tasksTotal: 1 }).open[0].state).toBe("climbing");
    expect(lv([agent("o", { taskId: T(1), model: "opus", state: "failed" })], { tasksTotal: 1, esc: true }).open[0].state).toBe("frontier");
  });
  it("done coder leaves the open set and counts done", () => {
    const r = lv([agent("c", { taskId: T(1), role: "coder", state: "done", endedAt: T0 - 1000 })], { tasksTotal: 2, tasksDone: 1 });
    expect([r.open.length, r.done, r.queued]).toEqual([0, 1, 1]);
  });
  it("cap: 8 running → 6 open by task number, overflow 2; a waiting lane is always open", () => {
    const ags = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => agent("a" + n, { taskId: T(n), role: "coder", state: n === 8 ? "waiting" : "working" }));
    const r = lv(ags, { tasksTotal: 12 });
    expect(r.open.length).toBe(LANE_MAX);
    expect(r.open.map((l) => l.num)).toEqual([1, 2, 3, 4, 5, 8]);
    expect([r.overflow, r.queued]).toEqual([2, 4]);
  });
  it("no plan: untagged executors are one lane each; reviewers never make lanes", () => {
    const r = lv([agent("e1"), agent("e2"), agent("r1", { type: "reviewer" })]);
    expect(r.open.map((l) => l.key)).toEqual(["e1", "e2"]);
    expect(r.single).toBe(false);
  });
  it("non-numeric ids keep spawn order; labels", () => {
    expect([taskNum("worktree-x:12"), taskNum("alpha"), taskNum("7")]).toEqual([12, null, 7]);
    const r = lv([agent("b", { taskId: "zeta", spawnedAt: T0 - 9000 }), agent("a", { taskId: "alpha", spawnedAt: T0 - 5000 })]);
    expect(r.open.map((l) => l.key)).toEqual(["zeta", "alpha"]);
    const one = lv([agent("a", { taskId: T(3), model: "haiku", role: "coder" })], { tasksTotal: 3 }).open[0];
    expect(laneTitle(one)).toBe("T3 · HAIKU · CODE");
    expect(laneTitle(r.open[0])).toBe("EXECUTOR 1");
  });
  it("shipped: everything done, nothing open", () => {
    const r = lv([agent("c", { taskId: T(1), role: "coder", state: "done", endedAt: T0 - 1000 })], { tasksTotal: 1, tasksDone: 1 });
    expect([r.open.length, r.done, r.queued, r.single]).toEqual([0, 1, 0, false]);
  });
});

describe("laneView interrogate fixes", () => {
  it("lagging tasksDone: 3 finished coders, tasksDone 0, total 9 → done 3, queued 6 - open", () => {
    const ags = [1, 2, 3].map((n) => agent("d" + n, { taskId: T(n), role: "coder", state: "done", endedAt: T0 - 1000 }));
    ags.push(agent("w4", { taskId: T(4), role: "coder" }), agent("w5", { taskId: T(5), role: "coder" }));
    const r = lv(ags, { tasksTotal: 9, tasksDone: 0 });
    expect([r.done, r.open.length, r.queued]).toEqual([3, 2, 4]);
  });
  it("a done tester makes the lane handoff (open, quiet)", () => {
    const r = lv([agent("t", { taskId: T(2), role: "tester", state: "done", endedAt: T0 - 1000 })], { tasksTotal: 3 });
    expect([r.open.length, r.open[0].state]).toEqual([1, "handoff"]);
  });
  it("tagged fable executor on T1: T1 lane is frontier, head stays opus, no lane headed by fable", () => {
    const r = lv([
      agent("o", { taskId: T(1), model: "opus", state: "failed", spawnedAt: T0 - 9000 }),
      agent("f", { taskId: T(1), model: "fable", escalatedFrom: "opus", spawnedAt: T0 - 4000 }),
    ], { tasksTotal: 1, esc: true });
    expect(r.open.length).toBe(1);
    expect([r.open[0].state, r.open[0].head.head.model]).toEqual(["frontier", "opus"]);
    expect(r.open.some((l) => l.head.head.model === "fable")).toBe(false);
  });
  it("opus failed on T2 with s.esc while T1's fable runs: T2 is not frontier", () => {
    const r = lv([
      agent("o1", { taskId: T(1), model: "opus", state: "failed", spawnedAt: T0 - 9000 }),
      agent("f1", { taskId: T(1), model: "fable", escalatedFrom: "opus", spawnedAt: T0 - 4000 }),
      agent("o2", { taskId: T(2), model: "opus", state: "failed", spawnedAt: T0 - 8000 }),
    ], { tasksTotal: 2, esc: true });
    expect(r.open.map((l) => [l.num, l.state])).toEqual([[1, "frontier"], [2, "failed"]]);
  });
  it("joined lineage (opus escalated, fable re-run joined): frontier, head and rung stay opus, climbed excludes fable", () => {
    const r = lv([
      agent("o", { taskId: T(1), model: "opus", state: "escalated", spawnedAt: T0 - 9000 }),
      agent("f", { taskId: T(1), model: "fable", escalatedFrom: "opus", spawnedAt: T0 - 4000 }),
    ], { tasksTotal: 1 });
    expect(r.open.length).toBe(1);
    expect([r.open[0].state, r.open[0].head.head.model, r.open[0].rung, r.open[0].climbed.includes("fable")]).toEqual(["frontier", "opus", "opus", false]);
  });
});

describe("laneView review fixes", () => {
  it("hex-style untagged ids keep spawn order and title by name", () => {
    const r = lv([agent("ae4113e8ec3d494f7", { spawnedAt: T0 - 9000 }), agent("a2b1", { spawnedAt: T0 - 5000 })]);
    expect(r.open.map((l) => [l.key, l.num])).toEqual([["ae4113e8ec3d494f7", null], ["a2b1", null]]);
    expect(laneTitle(r.open[0])).toBe("EXECUTOR 1");
  });
  it("a failed Fable head makes the task lane failed; a blocked one blocked; a running one frontier", () => {
    const mk = (state: "failed" | "blocked" | "working") => lv([
      agent("o", { taskId: T(1), model: "opus", state: "escalated", spawnedAt: T0 - 9000 }),
      agent("f", { taskId: T(1), model: "fable", state, escalatedFrom: "opus", spawnedAt: T0 - 4000 }),
    ], { tasksTotal: 1 }).open[0].state;
    expect([mk("failed"), mk("blocked"), mk("working")]).toEqual(["failed", "blocked", "frontier"]);
  });
  it("Haiku tester then Sonnet coder on one task: climbed is empty", () => {
    const r = lv([
      agent("t", { taskId: T(1), role: "tester", model: "haiku", state: "done", endedAt: T0 - 5000, spawnedAt: T0 - 9000 }),
      agent("c", { taskId: T(1), role: "coder", model: "sonnet", spawnedAt: T0 - 4000 }),
    ], { tasksTotal: 1 });
    expect([r.open[0].rung, r.open[0].climbed]).toEqual(["sonnet", []]);
  });
  it("Haiku → Sonnet → Opus joined chain: climbed [haiku, sonnet]", () => {
    const r = lv([
      agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }),
      agent("s", { taskId: T(1), model: "sonnet", state: "escalated", escalatedFrom: "haiku", spawnedAt: T0 - 6000 }),
      agent("o", { taskId: T(1), model: "opus", escalatedFrom: "sonnet", spawnedAt: T0 - 3000 }),
    ], { tasksTotal: 1 });
    expect([r.open[0].rung, r.open[0].climbed]).toEqual(["opus", ["haiku", "sonnet"]]);
  });
  it("head with no model: climbed keeps the earlier models", () => {
    const r = lv([
      agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }),
      agent("x", { taskId: T(1), model: null, escalatedFrom: "haiku", spawnedAt: T0 - 4000 }),
    ], { tasksTotal: 1 });
    expect(r.open[0].climbed).toEqual(["haiku"]);
  });
  it("a repeated model in the chain shows one rung", () => {
    const r = lv([
      agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }),
      agent("h2", { taskId: T(1), model: "haiku", state: "escalated", escalatedFrom: "haiku", spawnedAt: T0 - 6000 }),
      agent("s", { taskId: T(1), model: "sonnet", escalatedFrom: "haiku", spawnedAt: T0 - 3000 }),
    ], { tasksTotal: 1 });
    expect(r.open[0].climbed).toEqual(["haiku"]);
  });
});
