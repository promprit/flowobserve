import * as THREE from "three";
import { CAM } from "../config";

export const LANE_EDGE = 7;
export interface LaneSlot { mo: THREE.Vector3; node: THREE.Vector3; mr: THREE.Vector3 }
const wOf = (P: boolean) => (f: number, h: number, s: number, k = 1.1) => P ? new THREE.Vector3(s * k, -f * 0.85, h * 0.6) : new THREE.Vector3(f, h, s);
const slotAt = (W: ReturnType<typeof wOf>, z: number, h: number): LaneSlot => ({ mo: W(-3.4, 4.4, z * 0.55), node: W(0, h, z), mr: W(3.4, 4.4, z * 0.55) });
/** Open lanes evenly between the queued (-edge) and done (+edge) strands. */
export function laneSlots(n: number, P: boolean): { open: LaneSlot[]; sq: LaneSlot; sd: LaneSlot } {
  const W = wOf(P), E = LANE_EDGE;
  return { open: Array.from({ length: n }, (_, i) => slotAt(W, -E + (2 * E * (i + 1)) / (n + 1), 3.4)), sq: slotAt(W, -E, 3.1), sd: slotAt(W, E, 3.1) };
}

export function topology(P: boolean) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const W = wOf(P);
  const ZK = P ? [-7.4, 0, 7.4] : [-7, 0, 7];
  const N = { you: W(-12, 0.7, 0), plan: W(-6, 4.8, 0), exec: ZK.map((z, k) => W(0, k === 1 ? 3.8 : 3.1, z)), review: W(6, 4.8, 0), main: W(12, 0.7, 0), sq: W(0, 3.1, -LANE_EDGE), sd: W(0, 3.1, LANE_EDGE), fable: P ? W(-3, 6, 12.6) : W(9.5, 7.5, -8.5) };
  const cv = (pts: THREE.Vector3[]) => new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const C = {
    in: cv([N.you, W(-10.6, 2.4, 0), W(-8.3, 4.3, 0), N.plan]),
    out: N.exec.map((e, k) => cv([N.plan, W(-3.4, 4.4, ZK[k] * 0.55), e])),
    ret: N.exec.map((e, k) => cv([e, W(3.4, 4.4, ZK[k] * 0.55), N.review])),
    ship: cv([N.review, W(8.3, 4.3, 0), W(10.6, 2.4, 0), N.main]),
    esc: P ? cv([N.review, W(3, 7.5, 5.5), W(-0.5, 7.5, 10.5), N.fable]) : cv([N.review, W(7.2, 7.4, -2.8), W(8.8, 8.4, -5.8), N.fable]),
    // progress ring: starts at You, runs the front arc to Ship, returns along the back
    trunk: new THREE.CatmullRomCurve3(Array.from({ length: 96 }, (_, i) => { const a = i / 96 * Math.PI * 2; return W(-12 * Math.cos(a), 0.05, 12 * Math.sin(a), 0.85); }), true, "centripetal"),
  };
  const c = CAM[P ? "portrait" : "landscape"];
  const cam = { fov: c.fov, pos: V(...c.pos), tgt: V(...c.tgt), ref: c.ref };
  const anchor = P ? V(0, 13.4, 0) : V(0, 0.4, -14.5);       // overview name label
  const center = P ? V(0, 0, 1.5) : V(0, 3, 0);
  return { N, C, cam, anchor, center, P };
}
export type Topology = ReturnType<typeof topology>;
