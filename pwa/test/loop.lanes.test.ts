import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HEX } from "../src/config";
import { buildGeometry } from "../src/scene/geometry";
import { LANE_POOL, frameLanes, laneCurve, laneOf } from "../src/scene/lanes";
import { frameAgents, makeLoop, stateOf, writePackets, type LoopCtx } from "../src/scene/loop";
import { laneSlots, topology } from "../src/scene/topology";
import { ui } from "../src/state";
import { T0, agent, reset, sess } from "./helpers";

const A = topology(false), B = topology(true), geo = buildGeometry(A, B);
const ctx = (): LoopCtx => ({ sc: new THREE.Scene(), G: geo.G, GD: geo.GD, U: { uTime: { value: 0 }, uMorph: { value: 0 } }, allMats: new Set(), labelsEl: document.createElement("div"), A, B, PS: () => 1 });
const T = (n: number) => `worktree-x:${n}`;
const settle = (L: ReturnType<typeof makeLoop>, s = 3) => { for (let i = 0; i < s * 60; i++) frameLanes(L.lanes, A, B, 0, 1 / 60, 1, false); };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); ui.reduce = false; });

describe("lane pool", () => {
  it("builders-only: no lanes drawn, legacy path unchanged", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, builders: ["working", "idle", "idle"] }), "normal"); settle(L);
    expect(L.lanes.every((q) => q.a < 0.01)).toBe(true);
    expect(L.tgt.t.out0.a).toBe(1);
  });
  it("agents mode, nothing known: one centre lane, legacy lanes fully hidden", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 2, agents: [] }), "normal"); settle(L);
    const on = L.lanes.filter((q) => q.a > 0.1);
    expect(on.length).toBe(1);
    expect(on[0].curA.node.z).toBeCloseTo(0, 1);
    expect(L.tgt.t.out0.a).toBe(0);
  });
  it("a new task peels from the queued strand and settles in its slot", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("c", { taskId: T(1), spawnedAt: T0 })] }), "normal");
    const q = laneOf(L.lanes, T(1))!;
    expect(q.curA.node.z).toBeCloseTo(laneSlots(0, false).sq.node.z);
    settle(L);
    expect(q.curA.node.z).toBeCloseTo(laneSlots(1, false).open[0].node.z, 1);
  });
  it("a known task keeps its lane across syncs (no re-peel)", () => {
    const L = makeLoop(ctx(), "a"), s = sess("a", { stage: 3, tasksTotal: 1, agents: [agent("c", { taskId: T(1) })] });
    stateOf(L, s, "normal"); settle(L);
    const q = laneOf(L.lanes, T(1))!, z = q.curA.node.z;
    stateOf(L, s, "normal");
    expect(laneOf(L.lanes, T(1))).toBe(q);
    expect(q.curA.node.z).toBeCloseTo(z);
  });
  it("finished task merges into the done strand and frees its lane", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 2, agents: [agent("c", { taskId: T(1), role: "coder" })] }), "normal"); settle(L);
    const q = laneOf(L.lanes, T(1))!;
    stateOf(L, sess("a", { stage: 3, tasksTotal: 2, tasksDone: 1, agents: [agent("c", { taskId: T(1), role: "coder", state: "done", endedAt: T0 })] }), "normal"); settle(L);
    expect(q.key).toBe(null);
  });
  it("re-dispatch up the ladder keeps one lane and recolours it", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("h", { taskId: T(1), model: "haiku", state: "escalated" })] }), "normal"); settle(L);
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("h", { taskId: T(1), model: "haiku", state: "escalated" }), agent("s", { taskId: T(1), model: "sonnet", escalatedFrom: "haiku" })] }), "normal"); settle(L);
    expect(L.lanes.filter((x) => x.key === T(1)).length).toBe(1);
    expect(laneOf(L.lanes, T(1))!.c.getHexString()).toBe(new THREE.Color(HEX.sonnet).getHexString());
  });
  it("reduced motion: a new lane starts in its slot", () => {
    ui.reduce = true;
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("c", { taskId: T(1) })] }), "normal");
    expect(laneOf(L.lanes, T(1))!.curA.node.z).toBeCloseTo(laneSlots(1, false).open[0].node.z);
  });
  it("single -> split: the centre lane becomes the first task's lane, nothing merges to done", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 2, agents: [] }), "normal"); settle(L);
    const solo = laneOf(L.lanes, "·")!;
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("c1", { taskId: T(1) }), agent("c2", { taskId: T(2) })] }), "normal");
    expect(laneOf(L.lanes, T(1))).toBe(solo);
    expect(solo.curA.node.z).toBeCloseTo(0, 1);
    expect(laneOf(L.lanes, T(2))).not.toBe(solo);
    settle(L);
    expect(solo.a).toBeGreaterThan(0.3);
  });
});

describe("no strand lines", () => {
  it("the pool holds only open lanes; a working lane settles dim", () => {
    const L = makeLoop(ctx(), "a");
    const done = agent("d", { taskId: T(2), role: "coder", state: "done", endedAt: T0 });
    stateOf(L, sess("a", { stage: 3, tasksTotal: 4, tasksDone: 1, agents: [agent("c", { taskId: T(1), role: "coder" }), done] }), "normal"); settle(L);
    expect(L.lanes.length).toBe(LANE_POOL); // no queued / done strand objects
    expect(laneOf(L.lanes, T(1))!.a).toBeCloseTo(0.4, 1);
  });
});

describe("orbs on lanes", () => {
  it("each open task's head orb targets its lane node, emerging from the queued strand", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 4, agents: [agent("a1", { taskId: T(1) }), agent("a2", { taskId: T(2) })] }), "normal");
    const s2 = laneSlots(2, false);
    expect(L.tgt.ag.map((t) => [t.key, Math.round(t.pa.z * 10) / 10])).toEqual([[T(1), Math.round(s2.open[0].node.z * 10) / 10], [T(2), Math.round(s2.open[1].node.z * 10) / 10]]);
    expect(L.tgt.ag[0].oa.z).toBeCloseTo(s2.sq.node.z);
  });
  it("tester then coder: only the coder (head) has a target", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("t", { taskId: T(1), role: "tester", state: "done", endedAt: T0 - 500 }), agent("c", { taskId: T(1), role: "coder", spawnedAt: T0 - 400 })] }), "normal");
    expect(L.tgt.ag.map((t) => [t.key, t.aid])).toEqual([[T(1), "c"]]); // keyed by the lane (task id); aid is the head lineage
  });
  it("reviewers keep the Review ring", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 5, tasksTotal: 1, tasksDone: 1, agents: [agent("r", { type: "reviewer", model: "opus" })] }), "normal");
    expect(L.tgt.ag[0].pa.x).toBeGreaterThan(3); // around REVIEW (f = 6)
  });
  it("a Haiku → Sonnet climb shows one sand rung mark on the lane", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }), agent("s", { taskId: T(1), model: "sonnet", escalatedFrom: "haiku", spawnedAt: T0 - 4000 })] }), "normal");
    settle(L);
    const q = laneOf(L.lanes, T(1))!, on = q.marks.filter((mk) => mk.pts.visible);
    expect(on.length).toBe(1);
    expect(on[0].mat.uniforms.uColor.value.getHexString()).toBe(new THREE.Color(HEX.haiku).getHexString());
  });
});

describe("lane packets and labels", () => {
  it("working open lanes carry packets; strands and single carry none", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("a1", { taskId: T(1) }), agent("a2", { taskId: T(2), state: "waiting" })] }), "normal");
    const lp = L.tgt.packets.filter((p) => p.lane);
    expect(lp.map((p) => p.half)).toEqual(["out", "ret"]);
    expect(lp.every((p) => p.lane === laneOf(L.lanes, T(1)))).toBe(true);
    stateOf(L, sess("a", { stage: 2, agents: [] }), "normal");
    expect(L.tgt.packets.some((p) => p.lane)).toBe(false);
  });
  it("writePackets places a lane packet on that lane's curve", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("a1", { taskId: T(1) })] }), "normal"); settle(L);
    writePackets(L, [{ lane: laneOf(L.lanes, T(1))!, half: "out", fixed: 1, col: new THREE.Color(1, 1, 1), size: 6, tr: 0, gap: 0, max: 1 }], 0, 1, geo.curveOf, 1);
    expect(L.pPos[2]).toBeCloseTo(laneOf(L.lanes, T(1))!.curA.node.z, 1);
  });
  it("counts on PLAN and REVIEW labels", () => {
    const L = makeLoop(ctx(), "a");
    const ags = [1, 2, 3, 4, 5, 6, 7].map((n) => agent("a" + n, { taskId: T(n) }));
    stateOf(L, sess("a", { stage: 3, tasksTotal: 10, tasksDone: 2, agents: ags }), "normal");
    expect(L.label.plan[1].endsWith("· 1 QUEUED +1")).toBe(true);
    expect(L.label.review[1].endsWith("· 2 DONE")).toBe(true);
    expect(L.label.sq).toBeUndefined(); expect(L.label.sd).toBeUndefined();
    expect(L.ns.sq).toBeUndefined(); expect(L.ns.sd).toBeUndefined();
    stateOf(L, sess("a", { stage: 2, agents: [] }), "normal");
    expect(L.label.plan[1]).toBe("ORCHESTRATOR · OPUS"); expect(L.label.review[1]).toBe("2-STAGE + VERIFY");
  });
  it("≤ 3 open lanes: each orb label reads T<n> · MODEL · ROLE", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("a1", { taskId: T(3), model: "haiku", role: "coder" })] }), "normal");
    expect(L.agL.find((x) => x.key === "a1")?.t1).toBe("T3 · HAIKU · CODE");
  });
});

describe("lane pool hardening", () => {
  const climb = (n: number) => agent("h" + n, { taskId: T(n), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 });
  it("rebinding never steals a lane that is still wanted (T3 mid-climb keeps its lane and stays visible)", () => {
    const L = makeLoop(ctx(), "a"), mk = (ns: number[]) => ns.map((n) => (n === 3 ? climb(3) : agent("a" + n, { taskId: T(n) })));
    stateOf(L, sess("a", { stage: 3, tasksTotal: 7, agents: mk([1, 2, 3, 4, 5, 6]) }), "normal"); vi.setSystemTime(T0 + 20000); settle(L); // births are staggered; let every lane arrive
    const q3 = laneOf(L.lanes, T(3))!;
    expect(q3.a).toBeGreaterThan(0.3);
    stateOf(L, sess("a", { stage: 3, tasksTotal: 7, agents: mk([0, 2, 3, 4, 5, 6]) }), "normal");
    expect(laneOf(L.lanes, T(3))).toBe(q3);
    expect(laneOf(L.lanes, T(0))).toBeDefined();
    expect(L.lanes.filter((x) => x.live).length).toBe(6);
    expect(q3.tgtA).toBeGreaterThan(0.3);
    settle(L, 1);
    expect(q3.a).toBeGreaterThan(0.3);
  });
  it("makeLoop and a builders-only board draw no lane-material randomness", () => {
    const fresh = (): LoopCtx => { const g = buildGeometry(A, B); return { ...ctx(), G: g.G, GD: g.GD }; }; // geometry is lazy: use unrealised copies
    const spy = vi.spyOn(Math, "random");
    const ca = fresh(), cb = fresh(), base = spy.mock.calls.length; // buildGeometry's own draws (~85k) are not makeLoop's
    makeLoop(ca, "a");
    expect(spy.mock.calls.length - base).toBeLessThan(1000); // main: 368; eager lane/strand materials took it to ~5,400
    const L = makeLoop(cb, "b"), before = spy.mock.calls.length;
    stateOf(L, sess("b", { stage: 3, builders: ["working", "idle", "idle"] }), "normal"); settle(L, 1);
    expect(spy.mock.calls.length - before).toBe(0);
    spy.mockRestore();
  });
  it("laneCurve returns the same persistent curve object and tracks the lane", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("a1", { taskId: T(1) })] }), "normal"); settle(L);
    const q = laneOf(L.lanes, T(1))!;
    for (const half of ["out", "ret"] as const) for (const P of [0, 1] as const) expect(laneCurve(q, half, P)).toBe(laneCurve(q, half, P));
    expect(laneCurve(q, "out", 0).v2.z).toBeCloseTo(q.curA.node.z);
    expect(laneCurve(q, "ret", 0).v0.z).toBeCloseTo(q.curA.node.z);
  });
  it("a handoff lane (done tester head) carries no lane packets", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("t", { taskId: T(1), role: "tester", state: "done", endedAt: T0 - 500 })] }), "normal");
    expect(L.tgt.packets.filter((p) => p.lane || /^l[or]:/.test(p.k ?? ""))).toEqual([]);
  });
});

describe("orbs follow their lane", () => {
  const settleAll = (L: ReturnType<typeof makeLoop>, s = 3) => { for (let i = 0; i < s * 60; i++) { const wall = Date.now(); frameLanes(L.lanes, A, B, 0, 1 / 60, 1, false); frameAgents(L, 0, 1 / 60, 1, wall, false); vi.setSystemTime(wall + 1000 / 60); } };
  const slotOf = (L: ReturnType<typeof makeLoop>, keys: string[]) => L.slots.find((q) => q.key !== null && keys.includes(q.key));
  it("tester then coder on one task keeps the same orb and ticks at the head change", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("t", { taskId: T(1), role: "tester", state: "done", endedAt: T0 - 500, spawnedAt: T0 - 9000 })] }), "normal");
    settleAll(L, 2);
    const before = slotOf(L, [T(1), "t"])!;
    expect(before).toBeDefined();
    const tick0 = before.tick;
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("t", { taskId: T(1), role: "tester", state: "done", endedAt: T0 - 500, spawnedAt: T0 - 9000 }), agent("c", { taskId: T(1), role: "coder", spawnedAt: Date.now() })] }), "normal");
    settleAll(L, 1);
    const after = slotOf(L, [T(1), "c"])!;
    expect(after).toBe(before);
    expect(after.tick).toBeGreaterThan(tick0);
    expect(after.tick).toBeGreaterThan(0);
  });
  it("after settle the orb sits on its lane's eased node", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("a1", { taskId: T(1), spawnedAt: T0 - 9000 })] }), "normal");
    settleAll(L, 4);
    const q = slotOf(L, [T(1), "a1"])!, node = laneOf(L.lanes, T(1))!.curA.node;
    expect(q.pos.distanceTo(node)).toBeLessThan(0.05);
  });
  it("a reflow mid-ease keeps the orb on its lane's eased node", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("a1", { taskId: T(1), spawnedAt: T0 - 9000 })] }), "normal");
    settleAll(L, 4);
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("a1", { taskId: T(1), spawnedAt: T0 - 9000 }), agent("a2", { taskId: T(2), spawnedAt: T0 - 9000 })] }), "normal");
    settleAll(L, 10 / 60);
    const q = slotOf(L, [T(1), "a1"])!, node = laneOf(L.lanes, T(1))!.curA.node;
    expect(q.pos.distanceTo(node)).toBeLessThan(0.05);
  });
  it("a climbing (escalated) lane head draws no tether", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 })] }), "normal");
    settleAll(L, 2);
    const q = slotOf(L, [T(1), "h"])!;
    expect(q).toBeDefined();
    expect(q.pts.visible).toBe(true);
    expect(q.line.visible).toBe(false);
  });
  it("a top-level waiting general agent alongside lanes still has a target", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 2, agents: [agent("a1", { taskId: T(1) }), agent("g", { type: "general", state: "waiting" })] }), "normal");
    expect(L.tgt.ag.some((t) => t.key === "g")).toBe(true);
  });
});

describe("lane pool review fixes", () => {
  it("a fresh pool with an old spawn time (reload) starts in its slot, no peel", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [agent("c", { taskId: T(1), spawnedAt: T0 - 60000 })] }), "normal");
    expect(laneOf(L.lanes, T(1))!.curA.node.z).toBeCloseTo(laneSlots(1, false).open[0].node.z);
  });
  it("plan known but nothing open: one dim centre lane, no gap", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 3, agents: [] }), "normal"); settle(L);
    const on = L.lanes.filter((q) => q.a > 0.1);
    expect(on.length).toBe(1);
    expect(on[0].curA.node.z).toBeCloseTo(0, 1);
  });
  it("normal turnover never takes a retiring lane: T1 done + T7 starts", () => {
    const L = makeLoop(ctx(), "a"), mk = (ns: number[]) => ns.map((n) => agent("a" + n, { taskId: T(n), spawnedAt: T0 - 9000 }));
    stateOf(L, sess("a", { stage: 3, tasksTotal: 8, agents: mk([1, 2, 3, 4, 5, 6]) }), "normal"); vi.setSystemTime(T0 + 20000); settle(L);
    const q1 = laneOf(L.lanes, T(1))!;
    const next = [agent("a1", { taskId: T(1), role: "coder", state: "done", endedAt: T0, spawnedAt: T0 - 9000 }), ...mk([2, 3, 4, 5, 6, 7])];
    stateOf(L, sess("a", { stage: 3, tasksTotal: 8, tasksDone: 1, agents: next }), "normal");
    expect(q1.key).toBe(T(1));
    expect(laneOf(L.lanes, T(7))).not.toBe(q1);
    expect(q1.tgtSA.node.z).toBeCloseTo(laneSlots(6, false).sd.node.z);
    settle(L);
    expect(q1.key).toBe(null);
  });
  it("a late task tag re-keys the same lane: no merge, no re-peel", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 2, agents: [agent("c1", { spawnedAt: T0 - 9000 })] }), "normal"); settle(L);
    const q = laneOf(L.lanes, "c1")!, z = q.curA.node.z;
    expect(q).toBeDefined();
    stateOf(L, sess("a", { stage: 3, tasksTotal: 2, agents: [agent("c1", { taskId: T(1), spawnedAt: T0 - 9000 })] }), "normal");
    expect(laneOf(L.lanes, T(1))).toBe(q);
    expect(q.curA.node.z).toBeCloseTo(z);
    expect(q.tgtA).toBeGreaterThan(0.3);
  });
  it("rung marks fade out with a retiring lane instead of snapping off", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }), agent("s", { taskId: T(1), model: "sonnet", escalatedFrom: "haiku", spawnedAt: T0 - 4000 })] }), "normal");
    settle(L);
    const q = laneOf(L.lanes, T(1))!, mk = q.marks.find((m) => m.pts.visible)!;
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, tasksDone: 1, agents: [agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }), agent("s", { taskId: T(1), model: "sonnet", state: "done", endedAt: T0, escalatedFrom: "haiku", spawnedAt: T0 - 4000 })] }), "normal");
    const al: number[] = [];
    for (let i = 0; i < 4; i++) { frameLanes(L.lanes, A, B, 0, 1 / 60, 1, false); al.push(mk.mat.uniforms.uAlpha.value); }
    expect(al[0]).toBeGreaterThan(0);
    expect(al[3]).toBeLessThan(al[0]);
    expect(mk.pts.visible).toBe(true);
    expect(mk.mat.uniforms.uColor.value.getHexString()).toBe(new THREE.Color(HEX.haiku).getHexString());
  });
  it("rung marks fade in with the lane's easing", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, tasksTotal: 1, agents: [agent("h", { taskId: T(1), model: "haiku", state: "escalated", spawnedAt: T0 - 9000 }), agent("s", { taskId: T(1), model: "sonnet", escalatedFrom: "haiku", spawnedAt: T0 - 4000 })] }), "normal");
    const q = laneOf(L.lanes, T(1))!;
    frameLanes(L.lanes, A, B, 0, 1 / 60, 1, false);
    const mk = q.marks.find((m) => m.pts.visible)!, ratio = () => mk.mat.uniforms.uAlpha.value / (0.8 * q.a);
    expect(ratio()).toBeLessThan(0.5); // the mark eases in on top of the lane's own alpha
    settle(L);
    expect(ratio()).toBeCloseTo(1, 1);
  });
});
