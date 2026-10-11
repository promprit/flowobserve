import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HEX } from "../src/config";
import { arcHead, arcStep, ARC_ALPHA, isAtt, labelHex, PULSE_MS, stageArc, STAGE_U } from "../src/scene/arc";
import { buildGeometry } from "../src/scene/geometry";
import { HIT_MIN_PX } from "../src/scene/labels";
import { makeLoop, stateOf, type LoopCtx } from "../src/scene/loop";
import { topology } from "../src/scene/topology";
import { ui } from "../src/state";
import { T0, agent, reset, sess } from "./helpers";

const A = topology(false), B = topology(true), geo = buildGeometry(A, B);
const ctx = (): LoopCtx => ({ sc: new THREE.Scene(), G: geo.G, GD: geo.GD, U: { uTime: { value: 0 }, uMorph: { value: 0 } }, allMats: new Set(), labelsEl: document.createElement("div"), A, B, PS: () => 1 });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); ui.reduce = false; });

describe("stageArc", () => {
  it("each stage's ring fraction shares its node's flow position (x in landscape)", () => {
    for (const [key, s] of [["you", 0], ["plan", 1], ["review", 5], ["main", 6]] as const) {
      const p = A.C.trunk.getPointAt(STAGE_U[s]), n = A.N[key];
      expect(Math.abs(p.x - n.x)).toBeLessThan(0.6);
    }
    const ex = A.C.trunk.getPointAt(STAGE_U[3]);
    expect(Math.abs(ex.x - A.N.exec[1].x)).toBeLessThan(0.6);
  });
  it("stage 0 (brainstorm) has no arc and highlights YOU", () => {
    expect(stageArc(0, "active")).toEqual({ to: 0, head: HEX.opus, here: "you" });
  });
  it("mid stages map to their node and label", () => {
    expect(stageArc(1, "active")).toEqual({ to: 1 / 6, head: HEX.opus, here: "plan" });
    expect(stageArc(2, "active").to).toBeCloseTo(5 / 24);
    expect(stageArc(3, "active", [])).toEqual({ to: 1 / 4, head: HEX.opus, here: "plan" });
    expect(stageArc(3, "active").here).toBe("b"); // builders mode: working builders carry BUILD
    expect(stageArc(4, "escalated").here).toBe("fable");
    expect(stageArc(5, "active")).toEqual({ to: 1 / 3, head: HEX.opus, here: "review" });
  });
  it("SHIP is half the ring; shipped closes it with a brand head", () => {
    expect(stageArc(6, "active")).toEqual({ to: 1 / 2, head: HEX.opus, here: "main" });
    expect(stageArc(6, "shipped")).toEqual({ to: 1, head: HEX.brand, here: "main" });
    expect(stageArc(2, "shipped").to).toBe(1);
  });
  it("unknown, negative, fractional or out-of-range stage: arc at YOU, nothing highlighted", () => {
    for (const st of [-1, 7, 99, 2.5, NaN]) expect(stageArc(st, "active")).toEqual({ to: 0, head: HEX.opus, here: null });
    expect(stageArc(-1, "none")).toEqual({ to: 0, head: HEX.opus, here: null });
  });
  it("head colour: waiting amber; handoff or deny red; escalated or a re-dispatching agent fable; working never red", () => {
    expect(stageArc(3, "waiting").head).toBe(HEX.jev);
    for (const st of ["handoff", "deny"] as const) expect(stageArc(3, st).head).toBe(HEX.deny);
    expect(stageArc(4, "escalated").head).toBe(HEX.fable);
    expect(stageArc(3, "active", [{ state: "escalated" }]).head).toBe(HEX.fable);
    expect(stageArc(3, "deny", [{ state: "escalated" }]).head).toBe(HEX.deny);
    expect(stageArc(3, "active", [{ state: "working" }, { state: "failed" }]).head).toBe(HEX.opus);
    expect(stageArc(3, "idle").head).toBe(HEX.opus);
  });
});

describe("arcStep", () => {
  it("grows with ease-out and is ~95% there after 600 ms", () => {
    let r = 0;
    for (let i = 0; i < 36; i++) r = arcStep(r, 1 / 3, 1 / 60, false);
    expect(r).toBeGreaterThan(0.94 / 3);
    expect(r).toBeLessThan(1 / 3);
    const first = arcStep(0, 1 / 3, 1 / 60, false), second = arcStep(first, 1 / 3, 1 / 60, false) - first;
    expect(second).toBeLessThan(first);
  });
  it("snaps when within 0.001", () => { expect(arcStep(0.3329, 1 / 3, 1 / 60, false)).toBe(1 / 3); });
  it("reduced motion jumps", () => { expect(arcStep(0, 1 / 3, 1 / 60, true)).toBe(1 / 3); });
  it("moving backwards shrinks at once, no reverse sweep", () => { expect(arcStep(1 / 3, 1 / 6, 1 / 60, false)).toBe(1 / 6); });
});

describe("arcHead", () => {
  it("no head with no arc, a closed ring, or offline", () => {
    expect(arcHead(0, HEX.opus, null, T0, false, false)).toBeNull();
    expect(arcHead(1, HEX.brand, null, T0, false, false)).toBeNull();
    expect(arcHead(1 / 3, HEX.opus, null, T0, false, true)).toBeNull();
  });
  it("a fixed packet on the trunk at the arc end, in the head colour", () => {
    const p = arcHead(1 / 3, HEX.jev, null, T0, false, false)!;
    expect([p.k, p.fixed, p.size, "#" + p.col.getHexString()]).toEqual(["trunk", 1 / 3, 9, HEX.jev.toLowerCase()]);
  });
  it("reduced motion still draws the head, as a static dot", () => {
    const p = arcHead(1 / 3, HEX.opus, null, T0, true, false)!;
    expect([p.fixed, p.size]).toEqual([1 / 3, 9]);
  });
  it("one pulse when waiting starts: bigger mid-pulse, back to 9 after PULSE_MS; none under reduced motion", () => {
    expect(arcHead(1 / 3, HEX.jev, T0, T0 + PULSE_MS / 2, false, false)!.size).toBeGreaterThan(14);
    expect(arcHead(1 / 3, HEX.jev, T0, T0 + PULSE_MS + 1, false, false)!.size).toBe(9);
    expect(arcHead(1 / 3, HEX.jev, T0, T0 + PULSE_MS / 2, true, false)!.size).toBe(9);
  });
});

describe("labelHex", () => {
  it("current stage title is paper, others t3; attention states keep their colour", () => {
    expect(labelHex("review", "live", HEX.opus, "review")).toBe(HEX.paper);
    expect(labelHex("plan", "done", HEX.opus, "review")).toBe(HEX.t3);
    expect(labelHex("plan", "live", HEX.opus, "review")).toBe(HEX.t3);
    expect(labelHex("you", "attn", HEX.jev, "plan")).toBe(HEX.jev);
    expect(labelHex("b0", "failed", HEX.deny, "plan")).toBe(HEX.deny);
    expect(labelHex("you", "seen", HEX.jev, null)).toBe(HEX.jev);
    expect(labelHex("you", undefined, HEX.paper, null)).toBe(HEX.t3);
    expect(labelHex("b0", "live", HEX.sonnet, "b")).toBe(HEX.paper);
    expect(labelHex("b1", "calm", HEX.sonnet, "b")).toBe(HEX.t3);
    expect(labelHex("plan", "live", HEX.opus, "b")).toBe(HEX.t3);
    expect(labelHex("b2", "failed", HEX.deny, "b")).toBe(HEX.deny);
  });
});

it("isAtt: attn, seen and failed only", () => { expect(["attn", "seen", "failed", "live", "held", undefined].map(isAtt)).toEqual([true, true, true, false, false, false]); });

describe("stateOf drives the arc", () => {
  it("sets the trunk target to the stage fraction in opus at 55% and records here/head", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 5 }), "normal");
    expect(L.tgt.t.trunk.r).toBeCloseTo(1 / 3);
    expect(L.tgt.t.trunk.a).toBe(ARC_ALPHA);
    expect("#" + L.tgt.t.trunk.c.getHexString()).toBe(HEX.opus.toLowerCase());
    expect([L.here, L.head]).toEqual(["review", HEX.opus]);
  });
  it("empty board keeps the full ghost ring", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, undefined, "empty");
    expect(L.tgt.t.trunk.r).toBe(1);
  });
  it("records when waiting starts, once, and clears it when waiting ends", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 1 }), "normal");
    expect(L.waitAt).toBeNull();
    stateOf(L, sess("a", { stage: 1, status: "waiting" }), "normal");
    expect(L.waitAt).toBe(T0);
    vi.setSystemTime(T0 + 5000);
    stateOf(L, sess("a", { stage: 1, status: "waiting" }), "normal");
    expect(L.waitAt).toBe(T0);
    stateOf(L, sess("a", { stage: 1 }), "normal");
    expect(L.waitAt).toBeNull();
  });
  it("a re-dispatching agent turns the head fable", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, agents: [agent("x", { state: "escalated" })] }), "normal");
    expect(L.head).toBe(HEX.fable);
  });
  it("BUILD lights the builders in builders mode and PLAN in agents mode", () => {
    const L = makeLoop(ctx(), "a");
    stateOf(L, sess("a", { stage: 3, builders: ["working", "idle", "idle"] }), "normal");
    expect(L.here).toBe("b");
    stateOf(L, sess("a", { stage: 3, agents: [agent("x")] }), "normal");
    expect(L.here).toBe("plan");
  });
});

it("stage node hit areas stay at least 44 px across", () => { expect(HIT_MIN_PX * 2).toBeGreaterThanOrEqual(44); });
