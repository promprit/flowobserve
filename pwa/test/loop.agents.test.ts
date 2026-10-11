import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HEX } from "../src/config";
import { buildGeometry } from "../src/scene/geometry";
import { disposeLoop, frameAgents, makeLoop, stateOf, type LoopCtx } from "../src/scene/loop";
import { topology } from "../src/scene/topology";
import { ui } from "../src/state";
import { T0, agent, reset, sess } from "./helpers";

const A = topology(false), B = topology(true), geo = buildGeometry(A, B);
const ctx = (): LoopCtx => ({ sc: new THREE.Scene(), G: geo.G, GD: geo.GD, U: { uTime: { value: 0 }, uMorph: { value: 0 } }, allMats: new Set(), labelsEl: document.createElement("div"), A, B, PS: () => 1 });
const three = (p = {}) => ["e1", "e2", "e3"].map((id) => agent(id, p));
const dt = 1 / 60;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); ui.reduce = false; });

describe("stateOf", () => {
  it("old server (no agents field): the builders path is unchanged", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, builders: ["working", "done", "idle"] }), "normal");
    expect([L.ns.b0, L.ns.b1]).toEqual(["live", "done"]);
    expect(L.label.b0).toEqual(["B1", "WORKING"]);
    expect(L.tgt.gateS.d0).toBe("pass");
    expect(L.tgt.packets.some((p) => p.k === "out0")).toBe(true);
    expect([L.av, L.tgt.ag, L.lla.textContent, L.slots.length]).toEqual([null, [], "", 0]);
  });
  it("agents mode hides B1-B3, their packets and gates, and lays out one target per agent", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, builders: ["working", "idle", "idle"], agents: three() }), "normal");
    for (const k of ["b0", "b1", "b2"]) expect(L.ns[k]).toBe("hide");
    expect(L.tgt.o.b0.a).toBe(0);
    for (const g of ["d0", "d1", "d2", "r0", "r1", "r2"]) expect(L.tgt.gateS[g]).toBe("hide");
    expect(L.tgt.packets.some((p) => /^(out|ret)/.test(p.k ?? ""))).toBe(false);
    expect(L.tgt.t.out0.a).toBe(0);
    expect(L.label.b0).toEqual(["", ""]);
    expect(L.tgt.ag.map((t) => t.key)).toEqual(["e1", "e2", "e3"]);
    expect(L.lla.textContent).toBe("3 AGENTS · 3 WORKING");
  });
  it("agents: [] is agents mode too (the server sends it before the first dispatch)", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, builders: ["working", "idle", "idle"], agents: [] }), "normal");
    expect(L.ns.b0).toBe("hide");
    expect(L.lla.textContent).toBe("");
  });
  it("a session flipping from builders to agents drops the builder nodes on the next sync", () => {
    const L = makeLoop(ctx(), "a"), s = sess("a", { stage: 3, builders: ["working", "idle", "idle"] });
    stateOf(L, s, "normal");
    expect(L.ns.b0).toBe("live");
    s.agents = three();
    stateOf(L, s, "normal");
    expect([L.ns.b0, L.tgt.gateS.d0, L.tgt.ag.length]).toEqual(["hide", "hide", 3]);
  });
  it("REVIEW shows the cycle tally from the review stage on", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 5, agents: [agent("r1", { type: "reviewer" })], agentTally: { spawned: 6, passed: 4, failed: 1, escalated: 1 } }), "normal");
    expect(L.label.review).toEqual(["REVIEW", "6 SPAWNED · 4 PASSED · 1 FAILED"]);
  });
  it("the overview line is text only and empty when offline", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, agents: [agent("x", { running: { tool: "<img src=x>", since: T0 - 5000 } })] }), "normal");
    expect(L.lla.textContent).toBe("1 AGENT · <IMG SRC=X> 0:05");
    expect(L.lla.querySelector("img")).toBeNull();
    stateOf(L, sess("a", { stage: 3, agents: three() }), "offline");
    expect(L.lla.textContent).toBe("");
  });
  it("a lite (unfocused) loop gets targets but no agent labels", () => {
    const L = makeLoop(ctx(), "a");
    L.detail = "lite";
    stateOf(L, sess("a", { stage: 3, agents: three() }), "normal");
    expect(L.tgt.ag).toHaveLength(3);
    expect(L.agL).toEqual([]);
    L.detail = "full";
    stateOf(L, sess("a", { stage: 3, agents: three() }), "normal");
    expect(L.agL.map((l) => l.id)).toEqual(["ag:e1", "ag:e2", "ag:e3"]);
  });
});

describe("frameAgents", () => {
  it("old server (no agents field): no slot is allocated and nothing asks to render", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, builders: ["working", "done", "idle"] }), "normal");
    expect(frameAgents(L, 0, dt, 1, T0, false)).toBe(0);
    expect(L.slots).toHaveLength(0);
  });
  it("creates slots on demand and shows agents that already existed at once", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, agents: three() }), "normal");
    expect(L.slots).toHaveLength(0);
    expect(frameAgents(L, 0, dt, 1, T0, false)).toBe(0);
    expect(L.slots).toHaveLength(3);
    expect(L.slots.every((q) => q.pts.visible && !q.line.visible && q.a === 1)).toBe(true);
  });
  it("fresh spawns emerge 90 ms apart and wake the renderer for the emerge", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, agents: three({ spawnedAt: T0 - 100 }) }), "normal");
    expect(frameAgents(L, 0, dt, 1, T0, false)).toBe(180 + 900 + 100);
    expect(L.slots.map((q) => q.pts.visible)).toEqual([true, false, false]);
  });
  it("a focus switch mid-emerge does not restart the emerge", () => {
    const L = makeLoop(ctx(), "a"), s = sess("a", { stage: 3, agents: three({ spawnedAt: T0 - 100 }) });
    stateOf(L, s, "normal"); frameAgents(L, 0, dt, 1, T0, false);
    const born = L.slots.map((q) => q.born);
    L.detail = "lite"; stateOf(L, s, "normal"); frameAgents(L, 0, dt, 1, T0 + 300, false);
    L.detail = "full"; stateOf(L, s, "normal");
    expect(frameAgents(L, 0, dt, 1, T0 + 400, false)).toBe(0);
    expect(L.slots.map((q) => q.born)).toEqual(born);
    expect(L.slots).toHaveLength(3);
  });
  it("reduced motion: no emerge; a waiting agent holds a still glow", () => {
    ui.reduce = true;
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, agents: [agent("w", { state: "waiting", spawnedAt: T0 - 100 })] }), "normal");
    frameAgents(L, 0, dt, 1, T0, true);
    const q = L.slots[0];
    expect([q.born, q.pts.visible]).toEqual([0, true]);
    expect(q.mat.uniforms.uLit.value).toBeCloseTo(0.2 + 0.6 * 0.6);
  });
  it("a dropped agent fades out and frees its slot", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, agents: three() }), "normal"); frameAgents(L, 0, dt, 1, T0, false);
    stateOf(L, sess("a", { stage: 3, agents: three().slice(0, 2) }), "normal");
    for (let i = 0; i < 60; i++) frameAgents(L, 0, dt, 0.2, T0 + i * 16, false);
    expect(L.slots.filter((q) => q.key).map((q) => q.key)).toEqual(["e1", "e2"]);
    expect(L.slots[2].pts.visible).toBe(false);
  });
  it("only an escalated (re-dispatching) agent keeps its tether; working, waiting and failed agents have none", () => {
    const g = { type: "general" as const }; // non-lane agents: a lane-bound orb rides its lane and draws no tether
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, agents: [agent("w", g), agent("x", { ...g, state: "escalated", model: "opus" }), agent("y", { ...g, state: "waiting" }), agent("z", { ...g, state: "failed" })] }), "normal");
    frameAgents(L, 0, dt, 1, T0, false);
    const by = Object.fromEntries(L.slots.map((q) => [q.key, q]));
    expect([by.w.line.visible, by.x.line.visible, by.y.line.visible, by.z.line.visible]).toEqual([false, true, false, false]);
    expect(by.x.pts.visible).toBe(true);
    expect("#" + by.x.lm.color.getHexString()).toBe(HEX.deny.toLowerCase());
  });
  it("disposeLoop disposes every slot's tether geometry", () => {
    const cx = ctx(), L = makeLoop(cx, "a");
    stateOf(L, sess("a", { stage: 3, agents: three() }), "normal"); frameAgents(L, 0, dt, 1, T0, false);
    const spies = L.slots.map((q) => vi.spyOn(q.lg, "dispose"));
    disposeLoop(cx, L);
    expect(spies.every((sp) => sp.mock.calls.length === 1)).toBe(true);
  });
});

describe("agent orb geometry", () => {
  // The demo seeds its fast-forward from Math.random after the scene is built: a builders-only board must not draw
  // random numbers for agent orbs it never shows, or the seeded demo lands somewhere else (portrait demo=1 e2e).
  it("building the scene and a builders-only loop draws nothing for the agent orb; the first agent slot builds it once", () => {
    const spy = vi.spyOn(Math, "random");
    try {
      const g = buildGeometry(A, B), L = makeLoop({ ...ctx(), G: g.G }, "a");
      stateOf(L, sess("a", { stage: 3, builders: ["working", "done", "idle"] }), "normal");
      frameAgents(L, 0, dt, 1, T0, false);
      const builders = spy.mock.calls.length;
      stateOf(L, sess("a", { stage: 3, builders: ["working", "idle", "idle"], agents: three() }), "normal");
      frameAgents(L, 0, dt, 1, T0, false);
      expect(spy.mock.calls.length - builders).toBeGreaterThanOrEqual(420 * 7); // the 420-point orb, drawn only now
      const after = spy.mock.calls.length;
      expect(L.slots.map((q) => q.pts.geometry)).toEqual([g.G.agent, g.G.agent, g.G.agent]);
      expect(spy.mock.calls.length).toBe(after);
    } finally { spy.mockRestore(); }
  });
});
