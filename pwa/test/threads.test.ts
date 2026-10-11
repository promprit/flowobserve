import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { topology } from "../src/scene/topology";
import { SP } from "../src/config";
import { galaxyFrame, makeThreads, overviewFrame, poseBox } from "../src/scene/threads";
import { galaxyLayout } from "../src/scene/galaxy";

describe("threads", () => {
  it("one LineSegments for all threads", () => {
    const scene = new THREE.Scene(), t = makeThreads(scene);
    t.set([{ id: "a", x1: 0, z1: 0, x2: 1, z2: 0 }, { id: "b", x1: 0, z1: 0, x2: 0, z2: 1 }]);
    expect(scene.children.filter((c) => c instanceof THREE.LineSegments)).toHaveLength(1);
  });
  it("pulse animates for 1.5 s, never under reduced motion", () => {
    const t = makeThreads(new THREE.Scene());
    t.set([{ id: "a", x1: 0, z1: 0, x2: 1, z2: 0 }]);
    t.pulse("a", 0);
    expect(t.tick(500, false)).toBe(true);
    expect(t.tick(1600, false)).toBe(false);
    t.pulse("a", 2000);
    expect(t.tick(2100, true)).toBe(false);
  });
  it("colour buffer is uploaded only after a write", () => {
    const scene = new THREE.Scene(), t = makeThreads(scene);
    t.set([{ id: "a", x1: 0, z1: 0, x2: 1, z2: 0 }]);
    const col = (scene.children[0] as THREE.LineSegments).geometry.getAttribute("color") as THREE.BufferAttribute;
    t.tick(0, false);
    const v = col.version;
    t.tick(16, false); t.tick(32, false);
    expect(col.version).toBe(v); // no pulse: nothing to upload
    t.pulse("a", 40); t.tick(50, false);
    expect(col.version).toBeGreaterThan(v);
  });
  it("dispose removes the object", () => {
    const scene = new THREE.Scene(), t = makeThreads(scene);
    t.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it("galaxy frame maps a grid point to the loop offset plus its visual centre (offA at 0, offB at 1) in both orientations", () => {
    const p = new THREE.Vector3(1.5, 0, -0.75);
    const a = p.clone().applyMatrix4(galaxyFrame(0)), b = p.clone().applyMatrix4(galaxyFrame(1));
    expect(a.toArray()).toEqual([1.5 * SP.A[0], 3, -0.75 * SP.A[1]]);
    expect(b.x).toBeCloseTo(1.5 * SP.B[0]); expect(b.y).toBeCloseTo(0.75 * SP.B[1]); expect(b.z).toBeCloseTo(1.5);
    const mid = p.clone().applyMatrix4(galaxyFrame(0.4)), offA = new THREE.Vector3(1.5 * SP.A[0], 0, -0.75 * SP.A[1]).add(topology(false).center), offB = new THREE.Vector3(1.5 * SP.B[0], 0.75 * SP.B[1], 0).add(topology(true).center);
    expect(mid.distanceTo(new THREE.Vector3().lerpVectors(offA, offB, 0.4))).toBeLessThan(1e-4);
  });
});

describe("poseBox (portrait frames the current project)", () => {
  const g = galaxyLayout({ groups: [
    { key: "f", name: "f", sessions: [{ id: "f0" }, { id: "f1" }] },
    { key: "b", name: "b", sessions: [{ id: "b0" }] },
  ] }, new Map(), 9 / 16);
  const dir = new THREE.Vector3(0.5, -0.2, 0.84).normalize(), up = new THREE.Vector3(0, 0, 1);
  const target = (focus: string, portrait = true) => overviewFrame(poseBox(g, focus, portrait, 1), dir, up, 40, 9 / 16).target.clone();
  it("same-project switch keeps the camera target", () => {
    expect(target("f0").distanceTo(target("f1"))).toBeLessThan(1e-6);
  });
  it("other-project switch moves it", () => {
    expect(target("f0").distanceTo(target("b0"))).toBeGreaterThan(1);
  });
  it("landscape frames the whole galaxy whatever the focus", () => {
    expect(target("f0", false).distanceTo(target("b0", false))).toBeLessThan(1e-6);
  });
});
