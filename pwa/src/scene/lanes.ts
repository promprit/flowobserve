import * as THREE from "three";
import { HEX } from "../config";
import { FRESH_MS, MHEX, type AModel } from "../agents";
import { LANE_MAX, type Lane, type LaneView } from "../lanes";
import { BIRTH_GAP_MS, laneR } from "./agents";
import { laneSlots, type LaneSlot, type Topology } from "./topology";

/** Lane pool (spec 2026-10-09 loop build lanes): LANE_MAX open lanes plus two spare, so normal turnover never takes a retiring lane. Each lane is two GPU-bent point tubes. The queued and done strands are not drawn: laneSlots().sq / .sd are only the peel origin and merge target. */
export const LANE_POOL = LANE_MAX + 2;
type Half = "out" | "ret";
type Bz = THREE.QuadraticBezierCurve3;
export interface LaneObj {
  key: string | null; live: boolean; born: number;
  /** Tube materials: null until the first board with lanes binds (`build`), so a builders-only board pays nothing. */
  out: THREE.ShaderMaterial | null; ret: THREE.ShaderMaterial | null; build: () => void;
  a: number; tgtA: number; c: THREE.Color; tgtC: THREE.Color; lit: number; tgtLit: number;
  marks: { pts: THREE.Points; mat: THREE.ShaderMaterial; model: AModel | null; f: number }[]; grow: () => void; climbed: AModel[]; r: number;
  curA: LaneSlot; curB: LaneSlot; tgtSA: LaneSlot; tgtSB: LaneSlot;
  /** Persistent CPU twins of the shader curves, [A, B] per half; refreshed by frameLanes. */
  cv: Record<Half, [Bz, Bz]>;
}
type Mk = (geo: THREE.BufferGeometry, hex: string, size: number) => THREE.ShaderMaterial;
const slot = (): LaneSlot => ({ mo: new THREE.Vector3(), node: new THREE.Vector3(), mr: new THREE.Vector3() });
const bez = (): Bz => new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
const put = (d: LaneSlot, s: LaneSlot) => { d.mo.copy(s.mo); d.node.copy(s.node); d.mr.copy(s.mr); };
const ease = (d: LaneSlot, s: LaneSlot, k: number) => { d.mo.lerp(s.mo, k); d.node.lerp(s.node, k); d.mr.lerp(s.mr, k); };
const away = (d: LaneSlot, s: LaneSlot) => d.mo.distanceTo(s.mo) + d.node.distanceTo(s.node) + d.mr.distanceTo(s.mr);
const pts = (m: THREE.ShaderMaterial) => m.userData.pts as THREE.Points;

/** `mkLane` makes bent-tube materials (LANE_VERT); `mkCloud` the regular cloud material used for the rung marks. */
export function makeLanes(mkLane: Mk, mkCloud: Mk, G: { lane: THREE.BufferGeometry; agent: THREE.BufferGeometry }): LaneObj[] {
  const mk = (): LaneObj => {
    const marks: LaneObj["marks"] = []; // built on first climb: G.agent is a lazy geometry that must not be drawn for a board with no climb
    const grow = () => { while (marks.length < 3) { const mat = mkCloud(G.agent, HEX.paper, 1.25); pts(mat).visible = false; marks.push({ pts: pts(mat), mat, model: null, f: 0 }); } };
    const q: LaneObj = { key: null, live: false, born: 0, out: null, ret: null, build: () => {
      if (q.out) return;
      q.out = mkLane(G.lane, HEX.sonnet, 1.3); q.ret = mkLane(G.lane, HEX.sonnet, 1.3);
      pts(q.out).visible = pts(q.ret).visible = false;
    }, a: 0, tgtA: 0, c: new THREE.Color(HEX.sonnet), tgtC: new THREE.Color(HEX.sonnet), lit: 0, tgtLit: 0, marks, grow, climbed: [], r: 0.9, curA: slot(), curB: slot(), tgtSA: slot(), tgtSB: slot(), cv: { out: [bez(), bez()], ret: [bez(), bez()] } };
    return q;
  };
  return Array.from({ length: LANE_POOL }, mk);
}

export const laneOf = (pool: LaneObj[], key: string): LaneObj | undefined => pool.find((q) => q.key === key);

/** Open lanes stay dim so the orb carries the light. */
const STYLE = { working: { a: 0.4, l: 0.1 }, waiting: { a: 0.55, l: 0.12 }, failed: { a: 0.6, l: 0.12 }, blocked: { a: 0.6, l: 0.12 }, climbing: { a: 0.35, l: 0 }, frontier: { a: 0.35, l: 0 }, handoff: { a: 0.3, l: 0 } } as const;

/** When the lane's first lineage was spawned (its earliest). */
const firstSpawn = (L: Lane) => Math.min(L.head.chain[0].spawnedAt, ...L.lines.map((l) => l.chain[0].spawnedAt));

export function bindLanes(pool: LaneObj[], lv: LaneView | null, wall: number, reduce: boolean): void {
  for (const q of pool) q.live = false;
  if (lv) for (const q of pool) q.build();
  const centre = !!lv && (lv.single || lv.open.length === 0); // nothing to split yet: one dim centre lane, so Build never shows a gap
  const n = lv ? (centre ? 1 : lv.open.length) : 0;
  const SA = laneSlots(n, false), SB = laneSlots(n, true);
  const aim = (q: LaneObj, a: LaneSlot, b: LaneSlot, hex: string, al: number, l: number) => { put(q.tgtSA, a); put(q.tgtSB, b); q.tgtC.set(hex); q.tgtA = al; q.tgtLit = l; };
  if (lv) {
    const want: { key: string; st?: (typeof STYLE)[keyof typeof STYLE]; hex: string }[] = centre ? [{ key: "·", hex: HEX.sonnet }] : lv.open.map((L) => ({ key: L.key, st: STYLE[L.state], hex: L.state === "failed" || L.state === "blocked" ? HEX.deny : L.state === "frontier" ? HEX.fable : MHEX[L.rung ?? "sonnet"] }));
    const got: (LaneObj | undefined)[] = want.map((w) => laneOf(pool, w.key));
    // Pass 1: every wanted key that already owns a lane keeps it (marked live first, so pass 2 can never steal it).
    got.forEach((q) => { if (q) q.live = true; });
    if (!centre) got.forEach((q, i) => { // a late task tag: the lane keyed by its head lineage id takes the task key (no merge, no re-peel)
      if (q) return;
      const t = pool.find((x) => !x.live && x.key === lv.open[i].head.id);
      if (t) { t.key = want[i].key; t.live = true; got[i] = t; }
    });
    const solo = centre ? undefined : laneOf(pool, "·");
    if (solo) { const i = got.indexOf(undefined); if (i >= 0) { got[i] = solo; solo.key = want[i].key; solo.live = true; } } // centre -> split: the centre lane becomes the first task's lane
    // Pass 2: fresh lanes only from lanes that are not live.
    let last = Math.max(0, ...pool.map((q) => q.born));
    want.forEach((w, i) => {
      let q = got[i], fresh = false;
      if (!q) {
        q = pool.find((x) => !x.live && x.key === null) ?? pool.filter((x) => !x.live).sort((x, y) => x.a - y.a)[0];
        if (!q) return;
        fresh = true; q.key = w.key; q.a = 0; q.live = true;
      }
      if (!centre) { q.climbed = lv.open[i].climbed; if (q.climbed.length) q.grow(); q.r = laneR(lv.open.length); } else q.climbed = [];
      aim(q, SA.open[i], SB.open[i], w.hex, w.st?.a ?? 0.26, w.st?.l ?? 0);
      if (fresh) {
        const slotted = centre || reduce || wall - firstSpawn(lv.open[i]) >= FRESH_MS; // a reload or loop rebuild starts in its slot, like bindSlots
        put(q.curA, slotted ? SA.open[i] : SA.sq); put(q.curB, slotted ? SB.open[i] : SB.sq); q.c.copy(q.tgtC); q.lit = q.tgtLit;
        q.born = slotted ? wall : Math.max(wall, last + BIRTH_GAP_MS); last = Math.max(last, q.born);
      }
    });
  }
  for (const q of pool) if (!q.live) { put(q.tgtSA, SA.sd); put(q.tgtSB, SB.sd); q.tgtA = 0; q.tgtLit = 0; }
}

const lp = (u: THREE.IUniform, v: THREE.Vector3) => (u.value as THREE.Vector3).copy(v);
const pa = new THREE.Vector3(), pb = new THREE.Vector3(); // scratch points: frameLanes allocates nothing per frame
const tube = (u: Record<string, THREE.IUniform>, q: LaneObj, g: number) => { u.uAlpha.value = q.a * g; u.uLit.value = q.lit; (u.uColor.value as THREE.Color).copy(q.c); u.uReveal.value = 1.1; };
/** Eases every lane toward its target and writes the shader uniforms. Returns true while anything is still moving. */
export function frameLanes(pool: LaneObj[], A: Topology, B: Topology, m: number, dt: number, g: number, reduce: boolean, wall = Date.now()): boolean {
  const k = reduce ? 1 : 1 - Math.exp(-dt * 3.3);
  let busy = false;
  for (const q of pool) {
    const born = wall >= q.born;
    ease(q.curA, q.tgtSA, k); ease(q.curB, q.tgtSB, k);
    q.a += ((born ? q.tgtA : 0) - q.a) * k; q.lit += (q.tgtLit - q.lit) * k; q.c.lerp(q.tgtC, k);
    if (!q.live && q.a < 0.01) q.key = null;
    const on = q.a > 0.005;
    const oA = q.cv.out[0], oB = q.cv.out[1], rA = q.cv.ret[0], rB = q.cv.ret[1];
    oA.v0.copy(A.N.plan); oA.v1.copy(q.curA.mo); oA.v2.copy(q.curA.node); oB.v0.copy(B.N.plan); oB.v1.copy(q.curB.mo); oB.v2.copy(q.curB.node);
    rA.v0.copy(q.curA.node); rA.v1.copy(q.curA.mr); rA.v2.copy(A.N.review); rB.v0.copy(q.curB.node); rB.v1.copy(q.curB.mr); rB.v2.copy(B.N.review);
    if (q.out && q.ret && (on || pts(q.out).visible)) {
      const o = q.out.uniforms, r = q.ret.uniforms;
      lp(o.uA0, A.N.plan); lp(o.uA1, q.curA.mo); lp(o.uA2, q.curA.node); lp(o.uB0, B.N.plan); lp(o.uB1, q.curB.mo); lp(o.uB2, q.curB.node);
      lp(r.uA0, q.curA.node); lp(r.uA1, q.curA.mr); lp(r.uA2, A.N.review); lp(r.uB0, q.curB.node); lp(r.uB1, q.curB.mr); lp(r.uB2, B.N.review);
      tube(o, q, g); tube(r, q, g);
    }
    if (q.out && q.ret) pts(q.out).visible = pts(q.ret).visible = on;
    for (let j = 0; j < q.marks.length; j++) {
      const mk = q.marks[j], t = 0.3 + 0.06 * j;
      if (q.live) mk.model = q.climbed[j] ?? null; // a retiring lane keeps its marks (and their colour) while its alpha eases to 0
      const model = mk.model; mk.pts.visible = on && model !== null;
      if (!mk.pts.visible) { mk.f = 0; continue; }
      mk.f += (1 - mk.f) * k;
      mk.pts.position.lerpVectors(oA.getPoint(t, pa), oB.getPoint(t, pb), m); mk.pts.scale.setScalar(0.18 * q.r);
      const u = mk.mat.uniforms; (u.uColor.value as THREE.Color).set(MHEX[model!]); u.uAlpha.value = 0.8 * q.a * g * mk.f; u.uLit.value = 0;
    }
    if (!born || away(q.curA, q.tgtSA) > 0.01 || away(q.curB, q.tgtSB) > 0.01 || Math.abs(q.a - q.tgtA) > 0.01) busy = true;
  }
  return busy;
}

/** The lane's persistent curve for one half and projection (A = landscape, B = portrait); same shape as the shader's. */
export function laneCurve(L: LaneObj, half: Half, P: 0 | 1): Bz { return L.cv[half][P]; }
