import { beforeEach, describe, expect, it } from "vitest";
import { BLOOM, FRAME_MS, bloomOn, capOn, demand, due, frameDt, minGapMs, sceneSig, wake, wantsFrame, type Motion, type SigRow } from "../src/scene/demand";

const still: Motion = { now: 10_000, settling: false, camLag: 0, zoomGap: 0, orbiting: false, shipWave: false, tier: "still", reduce: false };
beforeEach(() => { demand.wakeUntil = 0; demand.rendered = 0; });

describe("wantsFrame", () => {
  it("an idle dashboard wants no frame", () => {
    expect(wantsFrame(still)).toBe(false);
  });
  it("every mover wants a frame", () => {
    for (const p of [{ settling: true }, { camLag: 0.5 }, { zoomGap: 0.1 }, { orbiting: true }, { shipWave: true }, { tier: "working" as const }])
      expect(wantsFrame({ ...still, ...p }), JSON.stringify(p)).toBe(true);
  });
  it("popover alone does not want a frame", () => {
    expect(wantsFrame({ ...still, popover: true } as Motion)).toBe(false);
  });
  it("sub-threshold camera and zoom drift does not keep rendering", () => {
    expect(wantsFrame({ ...still, camLag: 0.01, zoomGap: 0.001 })).toBe(false);
  });
  it("reduced motion drops ambient movers but keeps user-driven ones", () => {
    expect(wantsFrame({ ...still, reduce: true, tier: "working", shipWave: true })).toBe(false);
    expect(wantsFrame({ ...still, reduce: true, orbiting: true })).toBe(true);
  });
});

describe("wake", () => {
  it("keeps rendering for the settle window, then stops", () => {
    wake(1000);
    expect(wantsFrame({ ...still, now: 4999 })).toBe(true);
    expect(wantsFrame({ ...still, now: 5001 })).toBe(false);
  });
  it("never shortens an open window", () => {
    wake(1000, 10_000);
    wake(2000, 100);
    expect(demand.wakeUntil).toBe(11_000);
  });
});

describe("sceneSig", () => {
  const row = (p: Record<number, unknown> = {}): SigRow => Object.assign(["a", 3, "active", "wii", null, false, true, 2, 5, 0], p) as SigRow;
  it("changes with what the scene draws", () => {
    const a = sceneSig([row()], "live", "a");
    expect(sceneSig([row({ 1: 4 })], "live", "a")).not.toBe(a);
    expect(sceneSig([row({ 3: "wdi" })], "live", "a")).not.toBe(a);
    expect(sceneSig([row({ 7: 3 })], "live", "a")).not.toBe(a);
    expect(sceneSig([row({ 8: 6 })], "live", "a")).not.toBe(a);
    expect(sceneSig([row({ 9: 3 })], "live", "a")).not.toBe(a); // a new stall minute re-renders the label
    expect(sceneSig([row()], "offline", "a")).not.toBe(a);
    expect(sceneSig([row()], "live", "b")).not.toBe(a);
  });
  it("is stable for the same state", () => {
    expect(sceneSig([row()], "live", "a")).toBe(sceneSig([row()], "live", "a"));
  });
  it("a row without agents keeps today's exact signature; an agents signature (11th field) changes it", () => {
    const today = "live|a|a,3,active,wii,,false,true,2,5,0";
    expect(sceneSig([row()], "live", "a")).toBe(today);
    expect(sceneSig([row({ 10: undefined })], "live", "a")).toBe(today); // builders mode: no trailing comma
    expect(sceneSig([row({ 10: "e1:e1:working:3:sonnet" })], "live", "a")).not.toBe(today);
    expect(sceneSig([row({ 10: "e1:e1:working:3:sonnet" })], "live", "a")).not.toBe(sceneSig([row({ 10: "e1:e1:working:4:sonnet" })], "live", "a"));
  });
});

describe("frame cap", () => {
  it("working tier runs at 30 fps, breathing at 12, still draws nothing", () => {
    const m = { ...still, tier: "working" as const };
    expect(minGapMs(m)).toBe(FRAME_MS.working);
    expect(due(m, 29)).toBe(false);
    expect(due(m, 30)).toBe(true);
    expect(minGapMs({ ...still, tier: "breathing" })).toBe(FRAME_MS.breathing);
    expect(wantsFrame({ ...still, tier: "breathing" })).toBe(true);
    expect(wantsFrame({ ...still, tier: "still" })).toBe(false);
    expect(wantsFrame({ ...still, tier: "breathing", reduce: true })).toBe(false);
  });
  it("camera, zoom, orbit, morph, ship wave and the settle window run at 60 fps", () => {
    for (const p of [{ camLag: 0.5 }, { zoomGap: 0.1 }, { orbiting: true }, { settling: true }, { shipWave: true }])
      expect(minGapMs({ ...still, tier: "working", ...p }), JSON.stringify(p)).toBe(FRAME_MS.fast);
    wake(9_000);
    expect(minGapMs({ ...still, tier: "working" })).toBe(FRAME_MS.fast);
  });
  it("a long pause (hidden tab, idle) is due at once and advances one 60 fps step", () => {
    expect(due({ ...still, tier: "working" }, 60_000)).toBe(true);
    expect(frameDt(60_000)).toBeCloseTo(1 / 60);
    expect(frameDt(33)).toBeCloseTo(0.033);
  });
});

describe("bloomOn", () => {
  const S = (gpuMs: number | null | undefined, gapMs = 16, capMs = 16) => ({ gpuMs, gapMs, capMs });
  it("runs only while attention is visible", () => {
    const g = { over: 0, dead: false };
    expect(bloomOn(g, false, S(1))).toBe(false);
    expect(bloomOn(g, true, S(1))).toBe(true);
  });
  it("3 consecutive GPU samples over 4 ms drop bloom for the page lifetime", () => {
    const g = { over: 0, dead: false };
    bloomOn(g, true, S(5)); bloomOn(g, true, S(5));
    expect(bloomOn(g, true, S(3))).toBe(true);
    for (let i = 0; i < BLOOM.strikes - 1; i++) expect(bloomOn(g, true, S(4.5))).toBe(true);
    expect(bloomOn(g, true, S(4.5))).toBe(false);
    expect(bloomOn(g, true, S(1))).toBe(false);
  });
  it("no new GPU sample (undefined) neither strikes nor clears", () => {
    const g = { over: 2, dead: false };
    expect(bloomOn(g, true, S(undefined, 999))).toBe(true);
    expect(g.over).toBe(2);
  });
  it("without a GPU timer it falls back to the frame gap, scaled to the cap", () => {
    const g = { over: 0, dead: false };
    for (let i = 0; i < 5; i++) bloomOn(g, true, S(null, 33, FRAME_MS.working)); // 30 fps is on budget
    expect(g.over).toBe(0);
    bloomOn(g, true, S(null, 25)); expect(g.over).toBe(1);                       // 25 ms at the 60 fps cap is slow
    bloomOn(g, true, S(null, 0)); expect(g.over).toBe(0);                        // an uncounted gap never strikes
  });
  it("slow frames without attention never strike", () => {
    const g = { over: 0, dead: false };
    for (let i = 0; i < 5; i++) bloomOn(g, false, S(50));
    expect(g.dead).toBe(false);
  });
});

describe("24 fps cap", () => {
  const S = (gpuMs: number | null | undefined, gapMs = 0) => ({ gpuMs, gapMs, capMs: 33 });
  it("working tier caps at 24 fps once bloom is dead and still over budget", () => {
    const g = { over: 0, capped: false };
    for (let i = 0; i < 10; i++) expect(capOn(g, false, S(9))).toBe(false); // bloom alive: never capped
    for (let i = 0; i < BLOOM.strikes - 1; i++) expect(capOn(g, true, S(9))).toBe(false);
    expect(capOn(g, true, S(9))).toBe(true);
    expect(capOn(g, true, S(1))).toBe(true); // sticky
    const m = { ...still, tier: "working" as const, capped: true };
    expect(FRAME_MS.capped).toBe(41);
    expect(minGapMs(m)).toBe(41);
    expect(minGapMs({ ...m, tier: "breathing" })).toBe(FRAME_MS.breathing);
  });
  it("on-budget frames reset the strikes; fast motion stays 16 ms when capped", () => {
    const g = { over: 0, capped: false };
    capOn(g, true, S(9)); capOn(g, true, S(9)); capOn(g, true, S(1));
    expect(g.over).toBe(0);
    expect(minGapMs({ ...still, tier: "working", capped: true, orbiting: true })).toBe(FRAME_MS.fast);
    expect(minGapMs({ ...still, tier: "working", capped: true, shipWave: true })).toBe(FRAME_MS.fast);
  });
});
