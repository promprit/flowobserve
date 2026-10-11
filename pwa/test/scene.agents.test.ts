import { describe, expect, it } from "vitest";
import type { WireAgent } from "@fo/shared";
import { agentView, partsText } from "../src/agents";
import { HEX } from "../src/config";
import { agentLabels, BIRTH_GAP_MS, bindSlots, EMERGE_MS, layoutAgents, type SlotState, type SlotTarget } from "../src/scene/agents";
import { topology } from "../src/scene/topology";
import { T0, agent } from "./helpers";

const A = topology(false), B = topology(true);
const view = (ags: WireAgent[]) => agentView({ agents: ags }, T0)!;
const ex = (n: number) => Array.from({ length: n }, (_, i) => agent("e" + i, { spawnedAt: T0 - 60_000 + i }));

describe("layoutAgents", () => {
  it("one executor sits on the build column, tethered to PLAN", () => {
    const [t] = layoutAgents(view(ex(1)), A, B);
    expect(t.pa.toArray()).toEqual([0, 3.4, 0]);
    expect(t.pb.x).toBeCloseTo(0); expect(t.pb.y).toBeCloseTo(0); expect(t.pb.z).toBeCloseTo(2.04);
    expect(t.oa.toArray()).toEqual(A.N.plan.toArray());
    expect(t.ob.toArray()).toEqual(B.N.plan.toArray());
    expect(t.r).toBe(0.9);
  });
  it("three executors keep the B1-B3 spacing", () => {
    expect(layoutAgents(view(ex(3)), A, B).map((t) => t.pa.z)).toEqual([-7, 0, 7]);
  });
  it("six spread to ±9; twelve shrink and alternate the flow offset", () => {
    const six = layoutAgents(view(ex(6)), A, B);
    expect(six[0].pa.z).toBe(-9); expect(six[5].pa.z).toBeCloseTo(9);
    expect(six.every((t) => t.pa.x === 0 && t.r === 0.9)).toBe(true);
    const twelve = layoutAgents(view(ex(12)), A, B);
    expect(twelve.slice(0, 4).map((t) => t.pa.x)).toEqual([-1, 1, -1, 1]);
    expect(twelve[0].r).toBe(0.46);
  });
  it("reviewers ring REVIEW at R = 3.6; explorers ring PLAN", () => {
    const [r] = layoutAgents(view([agent("r1", { type: "reviewer" })]), A, B);
    expect([r.pa.x, r.pa.y, r.pa.z].map((v) => +v.toFixed(3))).toEqual([6, 4.2, -3.6]);
    expect(r.oa.toArray()).toEqual(A.N.review.toArray());
    expect(r.r).toBe(0.62);
    const [p] = layoutAgents(view([agent("x1", { type: "explore" })]), A, B);
    expect(p.pa.x).toBeCloseTo(-6);
    expect(p.oa.toArray()).toEqual(A.N.plan.toArray());
  });
  it("a child sits downstream of its parent at 0.68x, tethered to the parent", () => {
    const [p, c] = layoutAgents(view([agent("i1", { type: "interrogate" }), agent("i2", { type: "interrogate", parentId: "i1", spawnedAt: T0 - 1000 })]), A, B);
    expect(c.r).toBeCloseTo(0.62 * 0.68);
    expect(c.oa.toArray()).toEqual(p.pa.toArray());
    expect(c.pa.y).toBeCloseTo(p.pa.y - 0.3);
  });
  it("carries what the frame needs", () => {
    const [t] = layoutAgents(view([agent("w", { state: "waiting", toolCalls: 4 })]), A, B);
    expect(t).toMatchObject({ key: "w", state: "waiting", col: HEX.jev, tools: 4, spawnedAt: T0 - 60_000 });
  });
});

describe("agentLabels", () => {
  it("up to three agents in a cluster: one label each", () => {
    const ls = agentLabels(view(ex(3)), null, T0);
    expect(ls.map((l) => l.id)).toEqual(["ag:e0", "ag:e1", "ag:e2"]);
    expect(ls[0]).toMatchObject({ key: "e0", t1: "EXECUTOR 1", group: false, c1: HEX.sonnet, c2: "" });
    expect(partsText(ls[0].t2)).toBe("WORKING");
  });
  it("above three: one group label; waiting, failed and the selected agent keep their own", () => {
    const ags = [...ex(4), agent("w", { state: "waiting", spawnedAt: T0 - 50_000 }), agent("f", { state: "failed", endedAt: T0 - 1000, spawnedAt: T0 - 40_000 })];
    const ls = agentLabels(view(ags), "e2", T0);
    expect(ls.map((l) => l.id)).toEqual(["agg:build", "ag:e2", "ag:w", "ag:f"]);
    expect(ls[0]).toMatchObject({ key: "e0", group: true, t1: "6 AGENTS", c1: HEX.paper });
    expect(partsText(ls[0].t2)).toBe("1 WAITING · 4 WORKING · 1 FAILED");
    expect(ls[1].c1).toBe(HEX.paper);
    expect(ls[2].c2).toBe(HEX.jev);
    expect(ls[3].c2).toBe(HEX.deny);
  });
  it("clusters merge separately", () => {
    const ls = agentLabels(view([...ex(4), agent("r1", { type: "reviewer" }), agent("r2", { type: "reviewer" })]), null, T0);
    expect(ls.map((l) => l.id)).toEqual(["agg:build", "ag:r1", "ag:r2"]);
  });
});

describe("bindSlots", () => {
  const W0 = 1_000_000;
  const mk = (): SlotState => ({ key: null, T: null, live: false, born: 0, tc: 0, tick: 0, init: false });
  const tg = (key: string, p: Partial<SlotTarget> = {}): SlotTarget => ({ key, tools: 0, spawnedAt: W0, state: "working", ...p });

  it("grows slots lazily and never past 16", () => {
    const s: SlotState[] = [];
    bindSlots(s, [tg("a")], W0, 0, false, mk);
    expect(s).toHaveLength(1);
    const t: SlotState[] = [];
    bindSlots(t, Array.from({ length: 20 }, (_, i) => tg("k" + i)), W0, 0, false, mk);
    expect(t).toHaveLength(16);
    expect(t.filter((q) => q.live)).toHaveLength(16);
    expect(t.map((q) => q.key)).toEqual(Array.from({ length: 16 }, (_, i) => "k" + i));
  });
  it("staggers fresh births 90 ms apart and asks for the whole emerge", () => {
    const s: SlotState[] = [];
    const r = bindSlots(s, [tg("a"), tg("b"), tg("c")], W0, 0, false, mk);
    expect(s.map((q) => q.born)).toEqual([W0, W0 + BIRTH_GAP_MS, W0 + 2 * BIRTH_GAP_MS]);
    expect(r).toEqual({ lastBorn: W0 + 180, wakeMs: 180 + EMERGE_MS + 100 });
    expect(s.every((q) => q.init)).toBe(true);
  });
  it("an old agent (reload, reconnect) appears without emerging", () => {
    const s: SlotState[] = [];
    const r = bindSlots(s, [tg("a", { spawnedAt: W0 - 10_000 })], W0, 0, false, mk);
    expect([s[0].born, r.wakeMs]).toEqual([0, 0]);
  });
  it("re-binding the same keys (snapshot replay, focus switch) keeps born and asks for nothing", () => {
    const s: SlotState[] = [];
    const r = bindSlots(s, [tg("a"), tg("b")], W0, 0, false, mk);
    s.forEach((q) => { q.init = false; });
    const born = s.map((q) => q.born);
    const r2 = bindSlots(s, [tg("a"), tg("b")], W0 + 500, r.lastBorn, false, mk);
    expect(s.map((q) => q.born)).toEqual(born);
    expect(r2.wakeMs).toBe(0);
    expect(s.some((q) => q.init)).toBe(false);
  });
  it("one tick per tool-call increment, only while working, never under reduced motion", () => {
    const s: SlotState[] = [];
    bindSlots(s, [tg("a", { tools: 3 })], W0, 0, false, mk);
    expect(s[0].tick).toBe(0);
    expect(bindSlots(s, [tg("a", { tools: 4 })], W0, 0, false, mk).wakeMs).toBe(1000);
    expect(s[0].tick).toBe(1);
    s[0].tick = 0;
    bindSlots(s, [tg("a", { tools: 4 })], W0, 0, false, mk);
    expect(s[0].tick).toBe(0);
    bindSlots(s, [tg("a", { tools: 5, state: "waiting" })], W0, 0, false, mk);
    expect(s[0].tick).toBe(0);
    bindSlots(s, [tg("a", { tools: 6 })], W0, 0, true, mk);
    expect(s[0].tick).toBe(0);
  });
  it("reduced motion: no birth stagger", () => {
    const s: SlotState[] = [];
    expect(bindSlots(s, [tg("a"), tg("b")], W0, 0, true, mk).wakeMs).toBe(0);
    expect(s.map((q) => q.born)).toEqual([0, 0]);
  });
  it("a dropped agent's slot stops being live but keeps its key until the frame frees it", () => {
    const s: SlotState[] = [];
    bindSlots(s, [tg("a"), tg("b")], W0, 0, false, mk);
    bindSlots(s, [tg("a")], W0, 0, false, mk);
    expect(s.map((q) => [q.key, q.live])).toEqual([["a", true], ["b", false]]);
  });
});

