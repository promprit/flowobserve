import type { WireAgent } from "@fo/shared";
import { describe, expect, it } from "vitest";
import { LIFE } from "../src/scene/rate";
import { QUIET_MS, RateWindow, STALL_MS, activeNode, oldestRun, runningMin, sceneTier, speedOf, stallMin, tierOf, type Shape } from "../src/scene/rate";

const NOW = 10_000_000;
const S = (p: Partial<Shape> = {}): Shape => ({ stage: 3, status: "active", builders: ["idle", "idle", "idle"], deny: null, esc: false, lastEventAt: NOW, running: null, ...p });

describe("RateWindow", () => {
  it("the first sighting is a baseline; each advance counts once within 60 s", () => {
    const w = new RateWindow();
    w.note("a", 1000, 1000);
    expect(w.rate("a", 1000)).toBe(0);
    w.note("a", 2000, 2000); w.note("a", 2000, 2500); w.note("a", 3000, 3000);
    expect(w.rate("a", 3000)).toBe(2);
    expect(w.rate("a", 62_001)).toBe(1);
    expect(w.rate("a", 63_001)).toBe(0);
    expect(w.rate("nobody", 0)).toBe(0);
  });
  it("forgets sessions that are gone", () => {
    const w = new RateWindow();
    w.note("a", 1, 1); w.note("a", 2, 2);
    w.keep(["b"]);
    w.note("a", 3, 3);
    expect(w.rate("a", 3)).toBe(0);
  });
});

describe("speedOf", () => {
  it("clamps to 2-30 events/min, linear 0.5-1.5", () => {
    expect(speedOf(0)).toBe(0.5); expect(speedOf(2)).toBe(0.5);
    expect(speedOf(16)).toBeCloseTo(1); expect(speedOf(30)).toBe(1.5); expect(speedOf(99)).toBe(1.5);
  });
});

describe("tierOf", () => {
  it("working: recent event, an open tool, or a builder working and not stalled", () => {
    expect(tierOf(S({ lastEventAt: NOW - QUIET_MS + 1 }), NOW)).toBe("working");
    expect(tierOf(S({ lastEventAt: NOW - 10 * QUIET_MS, running: { tool: "Bash", since: NOW - 300_000 } }), NOW)).toBe("working");
    expect(tierOf(S({ lastEventAt: NOW - 90_000, builders: ["working", "idle", "idle"] }), NOW)).toBe("working");
  });
  it("breathing: quiet over 60 s, waiting on you, deny/handoff, stalled, shipped", () => {
    expect(tierOf(S({ lastEventAt: NOW - QUIET_MS - 1 }), NOW)).toBe("breathing");
    expect(tierOf(S({ status: "waiting" }), NOW)).toBe("breathing");
    expect(tierOf(S({ status: "deny", deny: 0 }), NOW)).toBe("breathing");
    expect(tierOf(S({ lastEventAt: NOW - STALL_MS - 1, builders: ["working", "idle", "idle"] }), NOW)).toBe("breathing");
    expect(tierOf(S({ status: "shipped", stage: 6 }), NOW)).toBe("breathing");
  });
  it("still: idle", () => {
    expect(tierOf(S({ status: "idle" }), NOW)).toBe("still");
  });
  it("a server clock ahead of ours counts as recent, never negative", () => {
    expect(tierOf(S({ lastEventAt: NOW + 5000 }), NOW)).toBe("working");
  });
  it("the scene takes the liveliest session; none -> still", () => {
    expect(sceneTier(["still", "breathing", "working"])).toBe("working");
    expect(sceneTier(["still", "breathing"])).toBe("breathing");
    expect(sceneTier([])).toBe("still");
  });
  it("LIFE: breathing slower than working, no packets; still is zero", () => {
    expect(LIFE.breathing.drift).toBeLessThan(LIFE.working.drift);
    expect(LIFE.breathing.packets).toBe(false);
    expect(LIFE.working.packets).toBe(true);
    expect(LIFE.still).toMatchObject({ drift: 0, pulse: 0, sway: 0, packets: false });
  });
});

describe("activeNode", () => {
  it("names the node where work is happening", () => {
    expect(activeNode(S({ stage: 0 }))).toBe("you");
    expect(activeNode(S({ stage: 3, status: "waiting" }))).toBe("you");
    expect(activeNode(S({ stage: 1 }))).toBe("plan");
    expect(activeNode(S({ stage: 3, builders: ["done", "working", "idle"] }))).toBe("b1");
    expect(activeNode(S({ stage: 4, builders: ["done", "done", "done"] }))).toBe("plan");
    expect(activeNode(S({ stage: 3, status: "deny", deny: 2 }))).toBe("b2");
    expect(activeNode(S({ stage: 4, status: "escalated", esc: true }))).toBe("fable");
    expect(activeNode(S({ stage: 5 }))).toBe("review");
    expect(activeNode(S({ stage: 6 }))).toBe("main");
    expect(activeNode(S({ stage: 6, status: "shipped" }))).toBe("main");
  });
});

describe("stall vs running", () => {
  const W = { builders: ["working", "idle", "idle"] as Shape["builders"], lastEventAt: 0 };
  it("STALLED after 120 s with a builder working and no open tool; whole minutes", () => {
    expect(stallMin(S({ ...W }), STALL_MS)).toBe(0);
    expect(stallMin(S({ ...W }), STALL_MS + 1)).toBe(2);
    expect(stallMin(S({ ...W }), 5 * 60_000 + 5)).toBe(5);
  });
  it("an open tool is never a stall; it is running after 120 s", () => {
    const r = S({ ...W, running: { tool: "Bash", since: 0 } });
    expect(stallMin(r, 10 * 60_000)).toBe(0);
    expect(runningMin(r, STALL_MS)).toBe(0);
    expect(runningMin(r, 3 * 60_000 + 1)).toBe(3);
  });
  it("never stalls without a working builder, when shipped, or with the server clock ahead", () => {
    expect(stallMin(S({ builders: ["done", "idle", "idle"], lastEventAt: 0 }), 10 * 60_000)).toBe(0);
    expect(stallMin(S({ ...W, status: "shipped" }), 10 * 60_000)).toBe(0);
    expect(stallMin(S({ ...W, lastEventAt: 10 * 60_000 }), 0)).toBe(0);
  });
});

const AG = (p: Partial<WireAgent> = {}): WireAgent => ({ id: "x", type: "executor", model: "sonnet", parentId: null, spawnedAt: NOW - 60_000, endedAt: null, state: "working", task: null, running: null, toolCalls: 0, tokens: 0, escalatedFrom: null, ...p });

describe("agents mode", () => {
  it("stalls on a working agent with no open tool and no event for 3 min; builders[] is ignored", () => {
    expect(stallMin(S({ agents: [AG()], lastEventAt: NOW - 3 * 60_000 }), NOW)).toBe(3);
    expect(stallMin(S({ agents: [], builders: ["working", "idle", "idle"], lastEventAt: NOW - 3 * 60_000 }), NOW)).toBe(0);
    expect(stallMin(S({ agents: [AG({ state: "waiting" })], lastEventAt: NOW - 3 * 60_000 }), NOW)).toBe(0);
  });
  it("an agent's open tool is work, not a stall, and the oldest one is the running clock", () => {
    const s = S({ agents: [AG({ running: { tool: "Bash", since: NOW - 5 * 60_000 } }), AG({ id: "y", running: { tool: "Read", since: NOW - 60_000 } })], lastEventAt: NOW - 5 * 60_000 });
    expect(stallMin(s, NOW)).toBe(0);
    expect(oldestRun(s)).toEqual({ tool: "Bash", since: NOW - 5 * 60_000 });
    expect(runningMin(s, NOW)).toBe(5);
  });
  it("the active node comes from the agents: the fan root, or REVIEW for a reviewer", () => {
    expect(activeNode(S({ stage: 3, agents: [AG()] }))).toBe("plan");
    expect(activeNode(S({ stage: 5, agents: [AG({ type: "reviewer" })] }))).toBe("review");
    expect(activeNode(S({ stage: 4, agents: [AG({ type: "interrogate", spawnedAt: NOW - 9e5 }), AG({ id: "y" })] }))).toBe("review");
    expect(activeNode(S({ status: "deny", deny: 1, agents: [AG()] }))).toBe("plan");
    expect(activeNode(S({ stage: 3, builders: ["idle", "working", "idle"] }))).toBe("b1"); // old server: unchanged
  });
  it("tier: an agent's open tool keeps the scene working; only done agents let it breathe", () => {
    expect(tierOf(S({ agents: [AG({ running: { tool: "Bash", since: NOW - 1000 } })], lastEventAt: NOW - 2 * QUIET_MS }), NOW)).toBe("working");
    expect(tierOf(S({ agents: [AG({ state: "done" })], lastEventAt: NOW - 2 * QUIET_MS }), NOW)).toBe("breathing");
  });
});
