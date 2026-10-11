import { beforeEach, expect, it } from "vitest";
import { CAM } from "../src/config";
import { initScene } from "../src/scene/world";
import { boxOf, hitNode, obstacleStats, obstacles, sceneBoxes } from "../src/scene/labels";
import { topology } from "../src/scene/topology";
import { Vector3 } from "three";
import { loadDom } from "./helpers";
import { fleetGalaxy } from "../src/scene/world";
import { coreLabels } from "../src/scene/labels";
import { nodeGrowth } from "../src/scene/loop";
import { corePointPositions } from "../src/scene/world";
import { layoutPages } from "../src/layout";

beforeEach(() => loadDom());

it("lays the loop out left → right in landscape and keeps the camera presets", () => {
  const L = topology(false), P = topology(true);
  expect(L.N.you.toArray()).toEqual([-12, 0.7, 0]);
  expect(L.N.main.x).toBeGreaterThan(L.N.you.x);
  expect(L.N.exec).toHaveLength(3);
  expect(L.C.out).toHaveLength(3);
  expect(L.cam.fov).toBe(CAM.landscape.fov);
  expect(L.cam.pos.toArray()).toEqual(CAM.landscape.pos);
  expect(P.cam.fov).toBe(CAM.portrait.fov);
  expect(P.cam.tgt.toArray()).toEqual(CAM.portrait.tgt);
});

it("falls back to the no-WebGL notice instead of throwing", () => {
  expect(initScene()).toBeNull();
  expect(document.body.classList.contains("nogl")).toBe(true);
});

const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

type B = { x: number; y: number; w: number; h: number };
const segHit = (p: { x: number; y: number }, q: { x: number; y: number }, b: B) => { // Liang-Barsky segment vs box
  let t0 = 0, t1 = 1; const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]]) {
    if (pp === 0) { if (qq < 0) return false; } else { const r = qq / pp; if (pp < 0) { if (r > t1) return false; t0 = Math.max(t0, r); } else { if (r < t0) return false; t1 = Math.min(t1, r); } }
  }
  return true;
};

for (const [W, H] of [[1440, 900], [1024, 768], [768, 1024]]) {
  it(`labels clear every ring marker and the orbit path at ${W}x${H}`, () => {
    const { labels, rings, orbit } = sceneBoxes(W, H);
    expect(rings).toHaveLength(10); // plan, review tori + 8 gate rings
    expect(orbit.length).toBeGreaterThan(50);
    for (const [k, lb] of Object.entries(labels)) {
      for (const [i, r] of rings.entries()) expect(hit(lb, r), `${k} label vs ring ${i}`).toBe(false);
      for (let i = 1; i < orbit.length; i++) expect(segHit(orbit[i - 1], orbit[i], lb), `${k} label on orbit segment ${i}`).toBe(false);
    }
  });
  it(`YOU label does not sit on the YOU trail at ${W}x${H}`, () => {
    const { labels, trail } = sceneBoxes(W, H), y = labels.you;
    const m = 4, on = trail.filter(p => p.x >= y.x - m && p.x <= y.x + y.w + m && p.y >= y.y - m && p.y <= y.y + y.h + m);
    expect(on).toHaveLength(0);
  });
}

const reach = (lb: B, n: { x: number; y: number; rpx: number }) => { // gap from label box to node circle
  const dx = Math.max(lb.x - n.x, 0, n.x - lb.x - lb.w), dy = Math.max(lb.y - n.y, 0, n.y - lb.y - lb.h);
  return Math.hypot(dx, dy) - n.rpx;
};
it("every label stays within reach of its node", () => {
  for (const [W, H, p] of [[1440, 900, false], [1024, 768, false], [768, 1024, true]] as const) {
    const { labels, nodes } = sceneBoxes(W, H, p);
    for (const [k, lb] of Object.entries(labels)) expect(reach(lb, nodes[k]), `${k} at ${W}x${H}`).toBeLessThanOrEqual(1.5 * lb.h);
  }
});

it("labels clear every ring marker in portrait", () => {
  const { labels, rings, orbit } = sceneBoxes(768, 1024, true);
  expect(rings).toHaveLength(10);
  for (const [k, lb] of Object.entries(labels)) {
    for (const [i, r] of rings.entries()) expect(hit(lb, r), `${k} vs ring ${i}`).toBe(false);
    for (let i = 1; i < orbit.length; i++) expect(segHit(orbit[i - 1], orbit[i], lb), `${k} on orbit ${i}`).toBe(false);
  }
});

it("builds obstacle geometry once, not per call", () => {
  const A = topology(false), B = topology(true), z = new Vector3(), proj = (x: number, y: number) => ({ x, y });
  const n0 = obstacleStats.builds;
  obstacles(proj as never, A, B, 0, z); obstacles(proj as never, A, B, 0.5, z); obstacles(proj as never, A, B, 1, z);
  expect(obstacleStats.builds - n0).toBe(1);
});

it("boxOf bounds points with padding", () => {
  expect(boxOf([{ x: 10, y: 20 }, { x: 30, y: 5 }], 4)).toEqual({ x: 6, y: 1, w: 28, h: 23 });
});

it("hitNode finds the node under the pointer, with a 22px minimum radius for touch", () => {
  const { nodes } = sceneBoxes(1440, 900);
  const list = Object.entries(nodes).map(([key, n]) => ({ key, ...n }));
  expect(hitNode(list, nodes.b1.x + 2, nodes.b1.y)).toBe("b1");
  expect(hitNode(list, nodes.you.x + 21, nodes.you.y)).toBe("you");
  expect(hitNode(list, -500, -500)).toBeNull();
});

it("fleet galaxy: every page's sessions get loops (never paged), one core label per project", () => {
  const mk = (id: string, name: string) => ({ id, name, openUrl: "/p/" + name, status: "active", startedAt: 1, lastEventAt: 1 });
  const pages = layoutPages([mk("a", "A"), mk("b", "B"), mk("c", "C")]);
  expect(pages.length).toBeGreaterThan(1);
  const { g, ids } = fleetGalaxy(pages, 16 / 9, new Map());
  expect(ids.sort()).toEqual(["a", "b", "c"]);
  const host = document.createElement("div"), els = new Map<string, HTMLElement>();
  coreLabels(host, g.cores, els);
  expect(host.querySelectorAll(".core")).toHaveLength(3);
  expect(fleetGalaxy([], 1, new Map()).ids).toEqual(["__empty"]);
});

it("node growth: 1 at zero, grows by log, caps at 1.6", () => {
  expect(nodeGrowth(0)).toBe(1);
  expect(nodeGrowth(1)).toBeCloseTo(1.15);
  expect(nodeGrowth(3)).toBeCloseTo(1.3);
  expect(nodeGrowth(1000)).toBe(1.6);
});

it("one bright core point per visible core", () => {
  const mk = (id: string, name: string) => ({ id, name, openUrl: "/p/" + name, status: "active", startedAt: 1, lastEventAt: 1 });
  const pages = layoutPages([mk("a", "A"), mk("b", "B"), mk("c", "C")]);
  const { g } = fleetGalaxy(pages, 1, new Map());
  expect(corePointPositions(g.cores).length).toBe(g.cores.length * 3);
});

import { Box3, PerspectiveCamera } from "three";
import { galaxyBox, galaxyFrame, overviewFrame } from "../src/scene/threads";
import { galaxyLayout } from "../src/scene/galaxy";

it("overviewFrame: box centre is the target, a wider box needs more distance", () => {
  const dir = new Vector3(0, 0.86, 0.52), up = new Vector3(0, 1, 0);
  const small = new Box3(new Vector3(-10, 0, -10), new Vector3(30, 6, 10)), wide = new Box3(new Vector3(-10, 0, -10), new Vector3(90, 6, 10));
  const a = overviewFrame(small, dir, up, 34, 1.6), b = overviewFrame(wide, dir, up, 34, 1.6);
  expect(a.target.toArray()).toEqual([10, 3, 0]);
  expect(b.target.x).toBeCloseTo(40);
  expect(b.distance).toBeGreaterThan(a.distance);
  expect(overviewFrame(wide, dir, up, 34, 0.6).distance).toBeGreaterThan(b.distance); // portrait aspect needs more
});

it("overviewFrame with a top inset: frames the box in the area below it (centre at NDC y = -inset), from further back", () => {
  const dir = new Vector3(0, 0.86, 0.52).normalize(), up = new Vector3(0, 1, 0);
  const box = new Box3(new Vector3(-10, 0, -40), new Vector3(10, 6, 40)), c = box.getCenter(new Vector3());
  const plain = overviewFrame(box, dir, up, 34, 1, undefined, undefined, 0);
  const f = overviewFrame(box, dir, up, 34, 1, undefined, undefined, 0.25);
  expect(f.distance).toBeGreaterThan(plain.distance);
  const cam = new PerspectiveCamera(34, 1, 0.1, 1000);
  cam.up.copy(up); cam.position.copy(dir).multiplyScalar(f.distance).add(f.target); cam.lookAt(f.target); cam.updateMatrixWorld();
  const p = c.clone().project(cam);
  expect(p.x).toBeCloseTo(0, 5);
  expect(p.y).toBeCloseTo(-0.25, 2);
});

it("overviewFrame with a minimum distance: the box centre still lands at NDC y = -inset", () => {
  const dir = new Vector3(0, 0.86, 0.52).normalize(), up = new Vector3(0, 1, 0);
  const box = new Box3(new Vector3(-10, 0, -40), new Vector3(10, 6, 40)), c = box.getCenter(new Vector3());
  const fit = overviewFrame(box, dir, up, 34, 1, undefined, undefined, 0.25).distance;
  const f = overviewFrame(box, dir, up, 34, 1, undefined, undefined, 0.25, fit * 2);
  expect(f.distance).toBeCloseTo(fit * 2);
  const cam = new PerspectiveCamera(34, 1, 0.1, 1000);
  cam.up.copy(up); cam.position.copy(dir).multiplyScalar(f.distance).add(f.target); cam.lookAt(f.target); cam.updateMatrixWorld();
  expect(c.clone().project(cam).y).toBeCloseTo(-0.25, 2);
});

it("galaxyBox covers every core and loop, centred on the galaxy, for 1 and 2 groups in both frames", () => {
  const mk = (...ns: number[]) => ({ groups: ns.map((n, i) => ({ key: `g${i}`, name: `g${i}`, sessions: Array.from({ length: n }, (_, j) => ({ id: `g${i}s${j}` })) })) });
  for (const ns of [[1], [7], [1, 7], [3, 4]]) for (const m of [0, 1]) {
    const g = galaxyLayout(mk(...ns)), box = galaxyBox(g, m);
    expect(box.isEmpty()).toBe(false);
    const f = galaxyFrame(m);
    for (const c of g.cores) expect(box.containsPoint(new Vector3(c.x, 0, c.z).applyMatrix4(f))).toBe(true);
    for (const l of g.loops) expect(box.containsPoint(new Vector3(l.x, 0, l.z).applyMatrix4(f))).toBe(true);
  }
  expect(galaxyBox({ cores: [], loops: [] }, 0).isEmpty()).toBe(false);
});
