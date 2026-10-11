import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTN_R, attentionOf, fieldUniforms, floorAt, PULSE_MS } from "../src/scene/field";
import { topology } from "../src/scene/topology";
import { T0, agent, reset, sess } from "./helpers";

const A = topology(false), B = topology(true), at = floorAt(A, B, 0);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); });

describe("floorAt", () => {
  it("is the landscape (x, z) of each node, and maps portrait back to the same floor frame", () => {
    expect(at.you).toEqual([-12, 0]);
    expect(at.main).toEqual([12, 0]);
    const p = floorAt(A, B, 1);
    expect(p.you[0]).toBeCloseTo(-12); expect(p.you[1]).toBeCloseTo(0);
    expect(p.fable[0]).toBeCloseTo(-3); expect(p.fable[1]).toBeCloseTo(12.6);
  });
});

describe("attentionOf", () => {
  it("maps waiting to amber under YOU, deny and handoff to red", () => {
    expect(attentionOf(sess("a", { status: "waiting" }))).toEqual({ key: "you", kind: 1 });
    expect(attentionOf(sess("a", { status: "handoff" }))).toEqual({ key: "you", kind: 2 });
    expect(attentionOf(sess("a", { status: "deny", deny: 2 }))).toEqual({ key: "b2", kind: 2 });
    expect(attentionOf(sess("a", { status: "deny", deny: null }))).toEqual({ key: "you", kind: 2 });
    expect(attentionOf(sess("a", { status: "escalated" }))).toBeNull();
    expect(attentionOf(undefined)).toBeNull();
  });
});

describe("fieldUniforms", () => {
  it("ship sets the pulse from MAIN for 1.6 s, then turns it off", () => {
    const s = sess("a", { status: "shipped", washAt: T0 });
    const u = fieldUniforms(s, T0 + PULSE_MS / 2, false, at);
    expect(u.pulseOrigin).toEqual(at.main);
    expect(u.pulseT).toBeCloseTo(0.5);
    expect(fieldUniforms(s, T0 + PULSE_MS + 1, false, at).pulseT).toBe(-1);
  });
  it("attention fills slot 0 with position, radius and colour kind; the rest stay empty", () => {
    const u = fieldUniforms(sess("a", { status: "deny", deny: 1 }), T0, false, at);
    expect(u.attn[0]).toEqual([...at.b1, ATTN_R, 2]);
    expect(u.attn[1]).toEqual([0, 0, 0, 0]);
    expect(u.ping).toEqual({ key: "b1", kind: 2 });
    expect(fieldUniforms(sess("a"), T0, false, at).attn[0]).toEqual([0, 0, 0, 0]);
  });
  it("activity is the live builder share, 0..1", () => {
    expect(fieldUniforms(sess("a", { builders: ["working", "working", "done"] }), T0, false, at).activity).toBeCloseTo(2 / 3);
    expect(fieldUniforms(sess("a"), T0, false, at).activity).toBe(0);
  });
  it("reduced motion zeroes every moving uniform but keeps the static pool", () => {
    const u = fieldUniforms(sess("a", { status: "waiting", washAt: T0, builders: ["working", "idle", "idle"] }), T0 + 100, true, at);
    expect(u.pulseT).toBe(-1);
    expect(u.activity).toBe(0);
    expect(u.time).toBe(0);
    expect(u.attn[0][3]).toBe(1);
  });
});

describe("agents mode", () => {
  it("activity counts working agents (capped at 1), never builders", () => {
    const f = (p: Parameters<typeof sess>[1]) => fieldUniforms(sess("a", p), T0, false, at).activity;
    expect(f({ agents: [agent("a"), agent("b", { state: "done" })] })).toBeCloseTo(1 / 3);
    expect(f({ agents: Array.from({ length: 6 }, (_, i) => agent("x" + i)) })).toBe(1);
    expect(f({ agents: [], builders: ["working", "working", "idle"] })).toBe(0);
    expect(f({ builders: ["working", "working", "idle"] })).toBeCloseTo(2 / 3);
  });
  it("a deny in agents mode marks PLAN, the fan root (the B nodes are hidden)", () => {
    expect(attentionOf(sess("a", { status: "deny", deny: 2, agents: [] }))).toEqual({ key: "plan", kind: 2 });
  });
});
