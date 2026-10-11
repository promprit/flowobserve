import * as THREE from "three";
import { clamp } from "../util";
import { topology } from "./topology";

export interface Box { x: number; y: number; w: number; h: number }
export type Topo = ReturnType<typeof topology>;
export interface LItem { key: string; r: number; mode: string; x: number; y: number; rpx: number; w: number; h: number }
export interface Pt { x: number; y: number }
export const LABEL_DEFS: [string, number, string, string][] = [
  ["you", 0.45, "below", "left"], ["plan", 2.4, "below", "left"], ["b0", 0.9, "right", "left"], ["b1", 0.9, "right", "right"], ["b2", 0.9, "right", "right"],
  ["review", 2.4, "below", "left"], ["main", 0.6, "below", "left"], ["fable", 1.0, "above", "above"],
];
export const nodeOf = (T: Topo, key: string) => key[0] === "b" && key.length === 2 ? T.N.exec[+key[1]] : T.N[key as "you" | "plan" | "review" | "main" | "fable"];
/** Reused projector: pt() writes into one shared Pt (copy what you keep). */
export type Proj = (x: number, y: number, z: number) => Pt;
export const projector = (cam: THREE.PerspectiveCamera, W: number, H: number): Proj => {
  const v = new THREE.Vector3(), out: Pt = { x: 0, y: 0 };
  return (x, y, z) => { v.set(x, y, z).project(cam); out.x = (v.x * 0.5 + 0.5) * W; out.y = (-v.y * 0.5 + 0.5) * H; return out; };
};

const RING_SPINS = 12, RING_PTS = 32, GATE_PTS = 16, GATE_R = 1.15, TRAIL_N = 80, ORBIT_N = 128;
/** Obstacle geometry in local space, built once per (A, B) topology pair; per frame only projected. */
interface ObsModel {
  ringLocal: Float32Array; gateLocal: Float32Array; gates: { pa: THREE.Vector3; pb: THREE.Vector3; qa: THREE.Quaternion; qb: THREE.Quaternion }[];
  trailA: Float32Array; trailB: Float32Array; orbitA: Float32Array; orbitB: Float32Array;
  rings: Box[]; trail: Pt[]; orbit: Pt[]; v: THREE.Vector3; q: THREE.Quaternion;
}
export const obstacleStats = { builds: 0 };
const models = new WeakMap<Topo, ObsModel>();
const sample = (fa: (u: number) => THREE.Vector3, fb: (u: number) => THREE.Vector3, n: number, u0 = 0, u1 = 1) => {
  const A = new Float32Array((n + 1) * 3), B = new Float32Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) { const u = (u0 + (u1 - u0) * i / n + 1) % 1; fa(u).toArray(A, i * 3); fb(u).toArray(B, i * 3); }
  return [A, B] as const;
};
const pts = (n: number): Pt[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));
function obsModel(A: Topo, B: Topo): ObsModel {
  const hit = models.get(A); if (hit) return hit;
  obstacleStats.builds++;
  const e = new THREE.Euler(), e2 = new THREE.Euler(), tmp = new THREE.Vector3();
  const ringLocal = new Float32Array(2 * RING_SPINS * RING_PTS * 3); let o = 0;
  for (const [R, tilt] of [[1.7, 0.4], [2.05, -0.7]]) for (let s = 0; s < RING_SPINS; s++) for (let a = 0; a < RING_PTS; a++) {
    tmp.set(R * Math.cos(a / RING_PTS * Math.PI * 2), R * Math.sin(a / RING_PTS * Math.PI * 2), 0)
      .applyEuler(e.set(Math.PI / 2 + tilt, 0, 0)).applyEuler(e2.set(0, s / RING_SPINS * Math.PI * 2, 0)).toArray(ringLocal, o); o += 3;
  }
  const gateLocal = new Float32Array(GATE_PTS * 3);
  for (let a = 0; a < GATE_PTS; a++) tmp.set(GATE_R * Math.cos(a / GATE_PTS * Math.PI * 2), GATE_R * Math.sin(a / GATE_PTS * Math.PI * 2), 0).toArray(gateLocal, a * 3);
  const gd = (ca: THREE.Curve<THREE.Vector3>, cb: THREE.Curve<THREE.Vector3>, t: number) => ({
    pa: ca.getPointAt(t), pb: cb.getPointAt(t),
    qa: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ca.getTangentAt(t).normalize()),
    qb: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cb.getTangentAt(t).normalize()),
  });
  // same gate placement as buildGeometry (route/commit on in/ship, d/r on out/ret)
  const gates = [gd(A.C.in, B.C.in, 0.55), gd(A.C.ship, B.C.ship, 0.45)];
  for (let i = 0; i < 3; i++) gates.push(gd(A.C.out[i], B.C.out[i], 0.5), gd(A.C.ret[i], B.C.ret[i], 0.5));
  const [trailInA, trailInB] = sample(u => A.C.in.getPoint(u), u => B.C.in.getPoint(u), TRAIL_N, 0, 1 - 1e-9);
  const [tkA, tkB] = sample(u => A.C.trunk.getPoint(u), u => B.C.trunk.getPoint(u), 80, -0.08, 0.08);
  const trailA = new Float32Array([...trailInA, ...tkA]), trailB = new Float32Array([...trailInB, ...tkB]);
  const [orbitA, orbitB] = sample(u => A.C.trunk.getPoint(u), u => B.C.trunk.getPoint(u), ORBIT_N);
  const m: ObsModel = { ringLocal, gateLocal, gates, trailA, trailB, orbitA, orbitB,
    rings: Array.from({ length: 2 + gates.length }, () => ({ x: 0, y: 0, w: 0, h: 0 })), trail: pts(trailA.length / 3), orbit: pts(orbitA.length / 3), v: new THREE.Vector3(), q: new THREE.Quaternion() };
  models.set(A, m); return m;
}

/** Everything the scene draws that a label must not cover, as screen geometry: ring markers (plan/review tori and the gate rings on the edges),
 *  the YOU trail points and the outer orbit path points. Built once in local space; per call only projected. Returned arrays are reused. */
export function obstacles(proj: Proj, A: Topo, B: Topo, m: number, off: THREE.Vector3): { rings: Box[]; trail: Pt[]; orbit: Pt[] } {
  const M = obsModel(A, B), { v, q } = M;
  const fit = (box: Box, x0: number, y0: number, x1: number, y1: number) => { box.x = x0; box.y = y0; box.w = x1 - x0; box.h = y1 - y0; };
  let bi = 0;
  for (const k of ["plan", "review"] as const) {
    const ax = A.N[k], bx = B.N[k], cx = ax.x + (bx.x - ax.x) * m + off.x, cy = ax.y + (bx.y - ax.y) * m + off.y, cz = ax.z + (bx.z - ax.z) * m + off.z;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const L = M.ringLocal;
    for (let i = 0; i < L.length; i += 3) { const p = proj(L[i] + cx, L[i + 1] + cy, L[i + 2] + cz); if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    fit(M.rings[bi++], x0, y0, x1, y1);
  }
  for (const g of M.gates) {
    q.slerpQuaternions(g.qa, g.qb, m);
    const cx = g.pa.x + (g.pb.x - g.pa.x) * m + off.x, cy = g.pa.y + (g.pb.y - g.pa.y) * m + off.y, cz = g.pa.z + (g.pb.z - g.pa.z) * m + off.z;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const L = M.gateLocal;
    for (let i = 0; i < L.length; i += 3) { v.set(L[i], L[i + 1], L[i + 2]).applyQuaternion(q); const p = proj(v.x + cx, v.y + cy, v.z + cz); if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    fit(M.rings[bi++], x0, y0, x1, y1);
  }
  const lerpPts = (a: Float32Array, b: Float32Array, out: Pt[]) => {
    for (let i = 0; i < out.length; i++) { const j = i * 3, p = proj(a[j] + (b[j] - a[j]) * m + off.x, a[j + 1] + (b[j + 1] - a[j + 1]) * m + off.y, a[j + 2] + (b[j + 2] - a[j + 2]) * m + off.z); out[i].x = p.x; out[i].y = p.y; }
  };
  lerpPts(M.trailA, M.trailB, M.trail); lerpPts(M.orbitA, M.orbitB, M.orbit);
  return { rings: M.rings, trail: M.trail, orbit: M.orbit };
}

/** Liang-Barsky: does segment p-q cross the box? (no allocation) */
function segBox(p: Pt, q: Pt, bx: number, by: number, bw: number, bh: number): boolean {
  let t0 = 0, t1 = 1; const dx = q.x - p.x, dy = q.y - p.y;
  for (let k = 0; k < 4; k++) {
    const pp = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dy : dy, qq = k === 0 ? p.x - bx : k === 1 ? bx + bw - p.x : k === 2 ? p.y - by : by + bh - p.y;
    if (pp === 0) { if (qq < 0) return false; } else { const r = qq / pp; if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
  }
  return true;
}
const SLIDES = [0, 0.5, -0.5, 1, -1, 0.75, -0.75, 0.25, -0.25, 1.5, -1.5, 2, -2];
const MODES = ["left", "right", "above", "below"] as const;
/** Pure label placement: items + blocked boxes (mutated: placed labels are appended) + obstacles -> label boxes.
 *  Candidates sit around the node (every side, two gap tiers, tangential slides); the first clear one within reach wins,
 *  otherwise the in-range candidate that hits the fewest obstacles. A label never leaves 1.5x its height from its node. */
export function layoutLabels(items: LItem[], W: number, H: number, boxes: Box[], rings: Box[], trail: Pt[], orbit: Pt[] = []): Record<string, Box & { md: string }> {
  const out: Record<string, Box & { md: string }> = {}, gap = H * 0.022;
  for (const lb of items) {
    const cap = lb.h * 1.5, w = lb.w, h = lb.h;
    const cost = (px: number, py: number) => { let c = 0;
      for (const q of boxes) { // text over text is unreadable: a real overlap outweighs crossing a ring or the orbit
        if (px < q.x + q.w + 14 && px + w + 14 > q.x && py < q.y + q.h + 8 && py + h + 8 > q.y) c += 4;
        if (px < q.x + q.w && px + w > q.x && py < q.y + q.h && py + h > q.y) c += 40; }
      for (const q of rings) { if (px < q.x + q.w + 6 && px + w + 6 > q.x && py < q.y + q.h + 6 && py + h + 6 > q.y) c += 4; if (px < q.x + q.w && px + w > q.x && py < q.y + q.h && py + h > q.y) c += 20; }
      for (const q of trail) if (q.x > px - 8 && q.x < px + w + 8 && q.y > py - 8 && q.y < py + h + 8) c++;
      for (let i = 0; i < orbit.length; i++) { const q = orbit[i];
        if (q.x > px - 8 && q.x < px + w + 8 && q.y > py - 8 && q.y < py + h + 8) c++;
        if (i && segBox(orbit[i - 1], q, px, py, w, h)) c += 30; }
      for (const q of items) if (q.key !== lb.key && px < q.x + q.rpx + 6 && px + w + 6 > q.x - q.rpx && py < q.y + q.rpx + 4 && py + h + 4 > q.y - q.rpx) c += 4;
      return c; };
    const reach = (px: number, py: number) => Math.hypot(Math.max(px - lb.x, 0, lb.x - px - w), Math.max(py - lb.y, 0, lb.y - py - h)) - lb.rpx;
    let bx = 0, by = 0, md: string = lb.mode, best = Infinity, any = false;
    const order = [lb.mode, ...MODES.filter(q => q !== lb.mode)];
    search: for (const tier of [1, 0.35, 1.8, 2.6]) for (const slide of SLIDES) for (const m2 of order) {
      const horiz = m2 === "left" || m2 === "right", g = gap * tier;
      let px = m2 === "left" ? lb.x - lb.rpx - g * 1.3 - w : m2 === "right" ? lb.x + lb.rpx + g * 1.1 : lb.x - w / 2 + (horiz ? 0 : slide * w * 0.6);
      let py = m2 === "above" ? lb.y - lb.rpx - g - h : m2 === "below" ? lb.y + lb.rpx + g : lb.y - h / 2 + (horiz ? slide * h * 0.9 : 0);
      px = clamp(px, 16, W - w - 16); py = clamp(py, 8, H - h - 8);
      if (reach(px, py) > cap) continue;
      const c = cost(px, py);
      if (c < best) { best = c; bx = px; by = py; md = m2; any = true; if (c === 0) break search; }
    }
    if (best >= 20) { // every candidate hard-overlaps something: fine grid around the node (rare, so the cost stays off the common path)
      const x0 = lb.x - lb.rpx - cap - w, x1 = lb.x + lb.rpx + cap, y0 = lb.y - lb.rpx - cap - h, y1 = lb.y + lb.rpx + cap;
      for (let py = Math.max(8, y0); py <= Math.min(H - h - 8, y1) && best >= 8; py += 2) for (let px = Math.max(16, x0); px <= Math.min(W - w - 16, x1); px += 2) {
        const r = reach(px, py); if (r > cap || r < 3) continue;
        const c = cost(px, py) + r * 0.01;
        if (c < best) { best = c; bx = px; by = py; any = true; md = px + w <= lb.x ? "left" : px >= lb.x ? "right" : py < lb.y ? "above" : "below"; if (c < 8) break; }
      }
    }
    if (!any) { // nothing in range (tiny viewport clamp): hug the node on the preferred side
      bx = clamp(lb.x - w / 2, 16, W - w - 16); by = clamp(lb.y + lb.rpx + gap, 8, H - h - 8); md = "below";
    }
    boxes.push({ x: bx, y: by, w, h });
    out[lb.key] = { x: bx, y: by, w, h, md };
  }
  return out;
}

/** Headless screen-space geometry for the focused loop (test seam; label sizes are fixed estimates). Uses the same camera fit, obstacles and layoutLabels as initScene;
 *  portrait uses the real morph (m=1), topology B pose and portrait label modes. */
export function sceneBoxes(W: number, H: number, portrait = H > W, lw = 110, lh = 34): { labels: Record<string, Box>; rings: Box[]; trail: Pt[]; orbit: Pt[]; nodes: Record<string, { x: number; y: number; rpx: number }> } {
  const A = topology(false), B = topology(true), m = portrait ? 1 : 0, cam = new THREE.PerspectiveCamera(A.cam.fov + (B.cam.fov - A.cam.fov) * m, W / H, 0.1, 400);
  const ref = A.cam.ref + (B.cam.ref - A.cam.ref) * m, fit = Math.max(1, ref / (W / H)) * (portrait ? 1.16 : 1);
  const pos = new THREE.Vector3().lerpVectors(A.cam.pos, B.cam.pos, m), tgt = new THREE.Vector3().lerpVectors(A.cam.tgt, B.cam.tgt, m);
  cam.position.copy(pos).sub(tgt).multiplyScalar(fit).add(tgt); cam.lookAt(tgt); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const proj = projector(cam, W, H), tan = Math.tan(cam.fov * Math.PI / 360), zero = new THREE.Vector3(), v = new THREE.Vector3();
  const items: LItem[] = LABEL_DEFS.map(([key, r, mL, mP]) => {
    const n = v.lerpVectors(nodeOf(A, key), nodeOf(B, key), m), d = n.distanceTo(cam.position), c = proj(n.x, n.y, n.z);
    return { key, r, mode: portrait ? mP : mL, x: c.x, y: c.y, rpx: r / (d * tan) * H / 2, w: lw, h: lh };
  });
  const { rings, trail, orbit } = obstacles(proj, A, B, m, zero);
  return { labels: layoutLabels(items, W, H, [], rings, trail, orbit), rings, trail, orbit, nodes: Object.fromEntries(items.map(i => [i.key, { x: i.x, y: i.y, rpx: i.rpx }])) };
}

export function boxOf(pts: Pt[], pad = 0): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

export const HIT_MIN_PX = 22;
/** Nearest node whose (rendered, min 22px) radius contains the point. */
export function hitNode(nodes: { key: string; x: number; y: number; rpx: number }[], x: number, y: number, min = HIT_MIN_PX): string | null {
  let best: string | null = null, bd = Infinity;
  for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d <= Math.max(n.rpx, min) && d < bd) { bd = d; best = n.key; } }
  return best;
}

/** Portrait (spec §3): the core label repeats the loop titles when every loop of that core shows the same name. */
export function coreHidden(core: { key: string; name: string }, loops: { key: string; name: string }[]): boolean {
  const mine = loops.filter((l) => l.key === core.key);
  return mine.length > 0 && mine.every((l) => l.name === core.name);
}

/** One label per project core (spec §3.6), keyed by core key. Elements live in `host`; stale ones are removed. */
export function coreLabels(host: HTMLElement, cores: { key: string; name: string }[], els: Map<string, HTMLElement>): void {
  const keep = new Set(cores.map((c) => c.key));
  for (const [k, el] of els) if (!keep.has(k)) { el.remove(); els.delete(k); }
  for (const c of cores) {
    let el = els.get(c.key);
    if (!el) { el = document.createElement("div"); el.className = "core"; el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;font-family:Archivo,sans-serif;font-weight:600;letter-spacing:.04em;font-size:calc(var(--u)*26);color:var(--t2);opacity:0;will-change:transform;pointer-events:none"; host.appendChild(el); els.set(c.key, el); }
    if (el.textContent !== c.name) el.textContent = c.name;
  }
}
