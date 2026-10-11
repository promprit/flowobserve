import { describe, expect, it } from "vitest";
import { awayKey, galaxyLayout, projectSubset, RIM, rowCount, threadEnd } from "../src/scene/galaxy";

const page = (...gs: [string, number][]) => ({ groups: gs.map(([k, n]) => ({ key: k, name: k, sessions: Array.from({ length: n }, (_, i) => ({ id: `${k}${i}` })) })) });
const minGap = (ls: { x: number; z: number }[]) => {
  let m = Infinity;
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) m = Math.min(m, Math.hypot(ls[i].x - ls[j].x, ls[i].z - ls[j].z));
  return m;
};

describe("galaxyLayout", () => {
  it("one core per group, one loop per session", () => {
    const g = galaxyLayout(page(["a", 4], ["b", 1]));
    expect(g.cores.map((c) => c.key)).toEqual(["a", "b"]);
    expect(g.loops).toHaveLength(5);
  });
  it("loops never overlap (min distance >= 1 unit) for 1..7 chats", () => {
    for (let n = 1; n <= 7; n++) expect(minGap(galaxyLayout(page(["a", n], ["b", 2])).loops)).toBeGreaterThanOrEqual(1);
  });
  it("seats stay put when a chat ends", () => {
    const seats = new Map<string, number>();
    const before = galaxyLayout(page(["a", 4]), seats);
    const p = page(["a", 4]); p.groups[0].sessions.splice(1, 1); // a1 ends
    const after = galaxyLayout(p, seats);
    for (const id of ["a0", "a2", "a3"]) {
      const b = before.loops.find((l) => l.id === id)!, c = after.loops.find((l) => l.id === id)!;
      expect([c.x, c.z]).toEqual([b.x, b.z]);
    }
  });
  it("ending the HIGHEST seat leaves the others in place", () => {
    const seats = new Map<string, number>();
    const before = galaxyLayout(page(["a", 4]), seats);
    const p = page(["a", 4]); p.groups[0].sessions.pop(); // a3 ends
    const after = galaxyLayout(p, seats);
    for (const id of ["a0", "a1", "a2"]) {
      const b = before.loops.find((l) => l.id === id)!, c = after.loops.find((l) => l.id === id)!;
      expect([c.x, c.z]).toEqual([b.x, b.z]);
    }
  });
  it("new chats take seats in start order, not layout order", () => {
    const seats = new Map<string, number>();
    galaxyLayout({ groups: [{ key: "a", name: "a", sessions: [{ id: "late", startedAt: 30 }, { id: "early", startedAt: 10 }, { id: "mid", startedAt: 20 }] }] }, seats);
    expect([seats.get("early"), seats.get("mid"), seats.get("late")]).toEqual([0, 1, 2]);
  });
  it("a chat joining from another group never shares a seat", () => {
    const seats = new Map<string, number>();
    galaxyLayout(page(["a", 1], ["b", 1]), seats); // a0 and b0 both hold seat 0
    const p = page(["a", 1]); p.groups[0].sessions.push({ id: "b0" });
    const g = galaxyLayout(p, seats);
    expect(minGap(g.loops)).toBeGreaterThanOrEqual(1);
    expect(seats.get("a0")).toBe(0);
  });
  it("constellation: a lone chat's core sits just beside its loop, toward the outside", () => {
    const g = galaxyLayout(page(["a", 1], ["b", 1]));
    const [ca, cb] = g.cores, [la, lb] = g.loops;
    expect(ca.x).toBeLessThan(la.x); expect(cb.x).toBeGreaterThan(lb.x); // outside of the scene
    for (const [c, l] of [[ca, la], [cb, lb]]) { const d = Math.hypot(c.x - l.x, c.z - l.z); expect(d).toBeGreaterThan(RIM); expect(d).toBeLessThan(0.8); }
  });
  it("constellation: a ring's core is its centre, loops close around it", () => {
    for (let n = 2; n <= 4; n++) {
      const g = galaxyLayout(page(["a", n])), c = g.cores[0];
      for (const l of g.loops) expect(Math.hypot(l.x - c.x, l.z - c.z)).toBeLessThan(0.8);
    }
  });
  it("the page is centred on 0 (left edge mirrors right edge)", () => {
    for (const ns of [[1], [3], [1, 1], [1, 3], [3, 2]] as number[][]) {
      const g = galaxyLayout(page(...ns.map((n, i) => [`g${i}`, n] as [string, number])));
      const xs = g.loops.map((l) => l.x);
      const lo = Math.min(...xs) - RIM, hi = Math.max(...xs) + RIM, cs = g.cores.map((c) => c.x);
      expect(Math.abs(Math.min(lo, ...cs.map((x) => x - 0.32)) + Math.max(hi, ...cs.map((x) => x + 0.32)))).toBeLessThan(1e-3);
    }
  });
  it("thread ends on the loop's rim facing the core, not its centre", () => {
    const e = threadEnd({ x: -1, z: 0 }, { x: 0, z: 0 });
    expect(e.x).toBeCloseTo(-RIM); expect(e.z).toBeCloseTo(0);
    const f = threadEnd({ x: 0, z: 0 }, { x: 0.6, z: 0.8 });
    expect(Math.hypot(f.x - 0.6, f.z - 0.8)).toBeCloseTo(RIM);
  });
  it("default aspect: one row (every core on z = 0)", () => {
    expect(galaxyLayout(page(["a", 1], ["b", 1], ["c", 1], ["d", 1])).cores.map((c) => c.z)).toEqual([0, 0, 0, 0]);
  });
  it("wraps groups into rows that fit the zone's aspect", () => {
    const rowsOf = (aspect: number) => new Set(galaxyLayout(page(["a", 1], ["b", 1], ["c", 1], ["d", 1]), new Map(), aspect).cores.map((c) => c.z)).size;
    expect(rowsOf(1)).toBe(2);
    expect(rowsOf(3)).toBe(1);
    expect(rowsOf(0.5)).toBe(4);
  });
  it("wrapped rows: loops never overlap, cores keep start order row by row", () => {
    const g = galaxyLayout(page(["a", 3], ["b", 1], ["c", 5], ["d", 2], ["e", 1]), new Map(), 1);
    expect(minGap(g.loops)).toBeGreaterThanOrEqual(1);
    expect(g.cores.map((c) => c.key)).toEqual(["a", "b", "c", "d", "e"]);
    const zs = g.cores.map((c) => c.z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThanOrEqual(zs[i - 1]);
  });
  it("row breaks depend on the groups, not on how many chats each has", () => {
    const row = (p: ReturnType<typeof page>) => { const g = galaxyLayout(p, new Map(), 1), zs = [...new Set(g.cores.map((c) => c.z))]; return g.cores.map((c) => zs.indexOf(c.z)); };
    expect(row(page(["a", 1], ["b", 1], ["c", 1], ["d", 1]))).toEqual(row(page(["a", 6], ["b", 1], ["c", 3], ["d", 1])));
  });
  it("empty or undefined page: nothing", () => {
    expect(galaxyLayout(undefined)).toEqual({ cores: [], loops: [] });
    expect(galaxyLayout({ groups: [] })).toEqual({ cores: [], loops: [] });
  });
});

describe("rowCount", () => {
  it("one row for 0 or 1 group, or no aspect", () => {
    for (const a of [0.1, 1, 10]) { expect(rowCount(0, a)).toBe(1); expect(rowCount(1, a)).toBe(1); }
    expect(rowCount(5, Infinity)).toBe(1);
    expect(rowCount(5, NaN)).toBe(1);
  });
  it("two groups: side by side when wide, stacked when tall", () => {
    expect(rowCount(2, 4)).toBe(1);
    expect(rowCount(2, 0.2)).toBe(2);
  });
  it("a tie keeps fewer rows", () => {
    expect(rowCount(2, Math.sqrt(2.5 * 0.625))).toBe(1); // 2 cols (2.5) and 2 rows (0.625) equally far from 1.25
  });
  it("never picks a row count that leaves a row empty", () => {
    for (let n = 2; n <= 12; n++) for (const a of [0.3, 0.7, 1, 1.6, 3]) {
      const r = rowCount(n, a), cols = Math.ceil(n / r);
      expect((r - 1) * cols).toBeLessThan(n);
    }
  });
});

describe("projectSubset", () => {
  const g = galaxyLayout(page(["f", 2], ["b", 1]), new Map());
  it("returns only the project holding the session", () => {
    const s = projectSubset(g, "f1");
    expect(s.cores.map((c) => c.key)).toEqual(["f"]);
    expect(s.loops.map((l) => l.id).sort()).toEqual(["f0", "f1"]);
  });
  it("positions are the fleet's, untouched", () => {
    expect(projectSubset(g, "b0").loops[0]).toEqual(g.loops.find((l) => l.id === "b0"));
  });
  it("null or unknown id → whole galaxy", () => {
    expect(projectSubset(g, null)).toBe(g);
    expect(projectSubset(g, "nope")).toBe(g);
  });
});

describe("awayKey", () => {
  const lk = new Map([["a0", "a"], ["b0", "b"]]);
  it("portrait known focus returns its project key", () => expect(awayKey(lk, "b0", true)).toBe("b"));
  it("portrait unknown or no focus returns undefined", () => { expect(awayKey(lk, "zz", true)).toBeUndefined(); expect(awayKey(lk, null, true)).toBeUndefined(); });
  it("landscape returns undefined", () => expect(awayKey(lk, "b0", false)).toBeUndefined());
});
