import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGeometry } from "../src/scene/geometry";
import { LANE_VERT } from "../src/scene/shaders";
import { LANE_EDGE, laneSlots, topology } from "../src/scene/topology";

describe("laneSlots", () => {
  it("1 lane sits at the centre; strands at the edges", () => {
    const s = laneSlots(1, false);
    expect(s.open[0].node.z).toBeCloseTo(0);
    expect([s.sq.node.z, s.sd.node.z]).toEqual([-LANE_EDGE, LANE_EDGE]);
  });
  it("n lanes are evenly spaced strictly between the strands, ordered -edge → +edge", () => {
    for (let n = 1; n <= 6; n++) {
      const z = laneSlots(n, false).open.map((l) => l.node.z);
      expect(z.length).toBe(n);
      for (let i = 1; i < n; i++) expect(z[i] - z[i - 1]).toBeCloseTo((2 * LANE_EDGE) / (n + 1));
      expect(Math.min(...z)).toBeGreaterThan(-LANE_EDGE);
      expect(Math.max(...z)).toBeLessThan(LANE_EDGE);
    }
  });
  it("portrait uses the topology transform (spread → x)", () => {
    const s = laneSlots(3, true);
    expect(s.open.map((l) => Math.round(l.node.x * 10) / 10)).toEqual([-3.5 * 1.1, 0, 3.5 * 1.1].map((x) => Math.round(x * 10) / 10));
  });
  it("topology exposes the strand nodes", () => {
    const T = topology(false);
    expect([T.N.sq.z, T.N.sd.z]).toEqual([-LANE_EDGE, LANE_EDGE]);
  });
});

describe("bent tubes", () => {
  it("LANE_VERT declares the six control uniforms", () => {
    for (const u of ["uA0", "uA1", "uA2", "uB0", "uB1", "uB2"]) expect(LANE_VERT).toContain(u);
  });
  it("unit tubes: offsets within radius, aT spans [0,1]", () => {
    const { G } = buildGeometry(topology(false), topology(true));
    for (const [g, r] of [[G.lane, 0.2]] as const) {
      const p = g.attributes.position.array as Float32Array, t = g.attributes.aT.array as Float32Array;
      for (let i = 0; i < t.length; i++) expect(Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])).toBeLessThanOrEqual(r + 1e-6);
      expect(Math.min(...t)).toBeGreaterThanOrEqual(0); expect(Math.max(...t)).toBeLessThanOrEqual(1);
    }
  });
});
