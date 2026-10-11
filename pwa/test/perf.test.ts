import { beforeEach, describe, expect, it } from "vitest";
import { GpuTimer, MAX_IN_FLIGHT, RING, Ring, perf, pct, stats, type GL2 } from "../src/scene/perf";

beforeEach(() => { perf.cpu.clear(); perf.gpu.clear(); perf.bloomDead = false; perf.capMs = 0; });

describe("Ring + pct", () => {
  it("keeps the last 240 values", () => {
    const r = new Ring();
    for (let i = 0; i < RING + 10; i++) r.push(i);
    expect(r.size).toBe(RING);
    expect(Math.min(...r.values())).toBe(10);
    expect(Math.max(...r.values())).toBe(RING + 9);
  });
  it("nearest-rank percentiles; null when empty", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(pct(xs, 50)).toBe(50); expect(pct(xs, 95)).toBe(95);
    expect(pct([7], 95)).toBe(7); expect(pct([], 50)).toBeNull();
  });
  it("stats reports GPU null when nothing was measured", () => {
    perf.cpu.push(2); perf.cpu.push(4);
    expect(stats()).toEqual({ frames: 2, cpuP50: 2, cpuP95: 4, gpuP50: null, gpuP95: null, bloomDead: false, capMs: 0 });
  });
});

function fakeGl(ext = true) {
  let id = 0;
  const ready = new Map<number, number>();
  const gl = {
    QUERY_RESULT: 1, QUERY_RESULT_AVAILABLE: 2, disjoint: false, deleted: 0, ended: 0,
    getExtension: () => (ext ? { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 } : null),
    createQuery: () => ({ id: ++id }),
    deleteQuery() { gl.deleted++; },
    beginQuery() {},
    endQuery() { gl.ended++; },
    getParameter: (p: number) => (p === 11 ? gl.disjoint : null),
    getQueryParameter: (q: { id: number }, p: number) => (p === 2 ? ready.has(q.id) : ready.get(q.id)),
    resolve: (qid: number, ns: number) => ready.set(qid, ns),
  };
  return gl;
}
const asGl = (g: ReturnType<typeof fakeGl>) => g as unknown as GL2;

describe("GpuTimer", () => {
  it("without the extension it is off and never begins", () => {
    const g = fakeGl(false), t = new GpuTimer(asGl(g));
    expect(t.ok).toBe(false); expect(t.begin()).toBe(false);
    t.end(); expect(g.ended).toBe(0); expect(t.poll()).toEqual([]);
    expect(new GpuTimer(null).ok).toBe(false);
  });
  it("pools at most 4 queries in flight and reads them back in order, in ms", () => {
    const g = fakeGl(), t = new GpuTimer(asGl(g));
    for (let i = 0; i < MAX_IN_FLIGHT; i++) { expect(t.begin()).toBe(true); t.end(); }
    expect(t.begin()).toBe(false);
    t.end(); expect(g.ended).toBe(MAX_IN_FLIGHT);
    g.resolve(2, 3e6); expect(t.poll()).toEqual([]);        // query 1 not ready: keep order
    g.resolve(1, 1.5e6); expect(t.poll()).toEqual([1.5, 3]);
    expect(t.begin()).toBe(true);
  });
  it("a throwing render still ends the query, so begin() works next frame", () => {
    const g = fakeGl(), t = new GpuTimer(asGl(g));
    const began = t.begin();
    expect(() => t.around(began, () => { throw new Error("boom"); })).toThrow("boom");
    expect(g.ended).toBe(1);
    expect(t.begin()).toBe(true);
  });
  it("a disjoint event drops every pending result", () => {
    const g = fakeGl(), t = new GpuTimer(asGl(g));
    t.begin(); t.end(); t.begin(); t.end();
    g.resolve(1, 1e6); g.disjoint = true;
    expect(t.poll()).toEqual([]);
    expect(g.deleted).toBe(2);
    expect(t.begin()).toBe(true);
  });
});
