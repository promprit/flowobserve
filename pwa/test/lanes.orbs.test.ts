import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGeometry } from "../src/scene/geometry";
import { frameLanes, laneOf } from "../src/scene/lanes";
import { TR, frameAgents, makeLoop, stateOf, writePackets, type LoopCtx } from "../src/scene/loop";
import { topology } from "../src/scene/topology";
import { ui } from "../src/state";
import { T0, agent, reset, sess } from "./helpers";

const A = topology(false), B = topology(true), geo = buildGeometry(A, B);
const ctx = (): LoopCtx => ({ sc: new THREE.Scene(), G: geo.G, GD: geo.GD, U: { uTime: { value: 0 }, uMorph: { value: 0 } }, allMats: new Set(), labelsEl: document.createElement("div"), A, B, PS: () => 1 });
const T = (n: number) => `worktree-x:${n}`;
type Lp = ReturnType<typeof makeLoop>;
const run = (L: Lp, s = 3, k = 1) => { for (let i = 0; i < s * 60; i++) { const wall = Date.now(); frameLanes(L.lanes, A, B, 0, 1 / 60, 1, false, wall); frameAgents(L, 0, 1 / 60, k, wall, false); vi.setSystemTime(wall + 1000 / 60); } };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); ui.reduce = false; });

describe("orbs packets and labels review fixes", () => {
  it("6 working lanes still leave room for the arc head packet", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 6, agents: [1, 2, 3, 4, 5, 6].map((n) => agent("a" + n, { taskId: T(n), spawnedAt: T0 - 9000 })) }), "normal");
    const lanes = L.tgt.packets.length;
    expect(lanes).toBe(12);
    const head = { k: "trunk", fixed: 0.5, col: new THREE.Color(1, 1, 1), size: 6, tr: 0, gap: 0, max: 1 };
    writePackets(L, [...L.tgt.packets, head], 0, 1, geo.curveOf, 1);
    expect(L.pSize[lanes * (TR + 1)]).toBeGreaterThan(0);
  });
  it("lane packets stay dark until their lane arrives", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("a1", { taskId: T(1), spawnedAt: T0 - 9000 })] }), "normal");
    writePackets(L, L.tgt.packets, 0, 1, geo.curveOf, 1);
    expect(L.pSize[0]).toBe(0);
    run(L, 3);
    writePackets(L, L.tgt.packets, 0, 1, geo.curveOf, 1);
    expect(L.pSize[0]).toBeGreaterThan(0);
  });
  it("finished tasks' fading orbs never chase a lane that was re-bound to a new task", () => {
    const L = makeLoop(ctx(), "a");
    const mk = (open: number[], done: number[]) => [...open.map((n) => agent("a" + n, { taskId: T(n), spawnedAt: n > 6 ? Date.now() : T0 - 9000 })), ...done.map((n) => agent("a" + n, { taskId: T(n), spawnedAt: T0 - 9000, state: "done" as const, endedAt: T0 }))];
    stateOf(L, sess("a", { stage: 3, tasksTotal: 9, agents: mk([1, 2, 3, 4, 5, 6], []) }), "normal"); run(L, 4);
    const z0 = new Map([4, 5, 6].map((n) => [n, L.slots.find((q) => q.key === T(n))!.pos.z]));
    // three tasks finish and three new ones arrive within a moment: the pool runs out of null lanes and re-binds fading ones
    stateOf(L, sess("a", { stage: 3, tasksTotal: 9, tasksDone: 1, agents: mk([1, 2, 3, 4, 5, 7], [6]) }), "normal"); run(L, 2 / 60, 0.02);
    stateOf(L, sess("a", { stage: 3, tasksTotal: 9, tasksDone: 2, agents: mk([1, 2, 3, 4, 7, 8], [6, 5]) }), "normal"); run(L, 2 / 60, 0.02);
    stateOf(L, sess("a", { stage: 3, tasksTotal: 9, tasksDone: 3, agents: mk([1, 2, 3, 7, 8, 9], [6, 5, 4]) }), "normal");
    for (let i = 0; i < 10; i++) {
      run(L, 1 / 60, 0.02);
      for (const n of [4, 5, 6]) { const q = L.slots.find((x) => x.key === T(n)); if (q) expect(q.pos.z).toBeGreaterThan(z0.get(n)! - 0.05); } // the queued edge is at lower z
    }
  });
  it("a late task tag re-keys the orb: still exactly one visible slot for the agent", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("c1", { spawnedAt: T0 - 9000 })] }), "normal"); run(L, 2);
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("c1", { taskId: T(1), spawnedAt: T0 - 9000 })] }), "normal"); run(L, 1, 0.02);
    const seen = L.slots.filter((q) => q.key && q.pts.visible && q.T?.aid === "c1");
    expect(seen.length).toBe(1);
    expect(seen[0].key).toBe(T(1));
    expect(L.slots.filter((q) => q.key).length).toBe(1);
  });
  it("2 open tasks with tester and coder lineages keep per-lane titles", () => {
    const L = makeLoop(ctx(), "a");
    const ag = [1, 2].flatMap((n) => [agent("t" + n, { taskId: T(n), role: "tester", state: "done", endedAt: T0 - 500, spawnedAt: T0 - 9000 }), agent("c" + n, { taskId: T(n), role: "coder", spawnedAt: T0 - 400 })]);
    stateOf(L, sess("a", { stage: 3, tasksTotal: 2, agents: ag }), "normal");
    expect(L.agL.some((x) => x.group)).toBe(false);
    expect(L.agL.filter((x) => /^T\d · /.test(x.t1)).length).toBe(2);
  });
  it("PLAN label reads MORE when nothing is queued but lanes overflow", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 8, agents: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => agent("a" + n, { taskId: T(n) })) }), "normal");
    expect(L.label.plan[1].endsWith("· 2 MORE")).toBe(true);
    expect(L.label.plan[1]).not.toContain("QUEUED");
  });
  it("a lane head's child tethers to the head's eased lane node", () => {
    const L = makeLoop(ctx(), "a");
    const ag = [agent("h1", { taskId: T(1), spawnedAt: T0 - 9000 }), agent("h2", { taskId: T(2), spawnedAt: T0 - 9000 }), agent("k", { type: "general", parentId: "h1", state: "escalated", spawnedAt: T0 - 9000 })];
    stateOf(L, sess("a", { stage: 3, tasksTotal: 2, agents: ag }), "normal"); run(L, 4);
    const kid = L.slots.find((q) => q.T?.aid === "k")!, node = laneOf(L.lanes, T(1))!.curA.node;
    expect(kid.line.visible).toBe(true);
    const arr = kid.lg.attributes.position.array as Float32Array;
    expect(Math.hypot(arr[0] - node.x, arr[1] - node.y, arr[2] - node.z)).toBeLessThan(0.05);
  });
  it("group label anchors to an orb", () => {
    const L = makeLoop(ctx(), "a");
    const ag = [agent("d1", { taskId: T(1), state: "done", endedAt: T0 - 1000, spawnedAt: T0 - 90000 }), ...[2, 3, 4, 5].map((n) => agent("a" + n, { taskId: T(n), spawnedAt: T0 - 9000 }))];
    stateOf(L, sess("a", { stage: 3, tasksTotal: 5, tasksDone: 1, agents: ag }), "normal"); run(L, 30);
    const g = L.agL.find((x) => x.group)!;
    expect(g.t1).toBe("4 AGENTS");
    expect(L.slots.some((q) => q.key && q.T?.aid === g.key && q.pts.visible)).toBe(true);
  });
});
