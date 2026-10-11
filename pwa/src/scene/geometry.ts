import * as THREE from "three";
import type { Topology } from "./topology";

type Curve = THREE.CatmullRomCurve3;
export interface Gate { pa: THREE.Vector3; pb: THREE.Vector3; qa: THREE.Quaternion; qb: THREE.Quaternion }

/** Shared morphing point clouds and gate definitions (built once, used by every loop). */
export function buildGeometry(A: Topology, B: Topology) {
  const geo = (pa: Float32Array, pb: Float32Array, at: Float32Array, sd: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pa, 3)); g.setAttribute("position2", new THREE.BufferAttribute(pb, 3));
    g.setAttribute("aT", new THREE.BufferAttribute(at, 1)); g.setAttribute("aSeed", new THREE.BufferAttribute(sd, 1)); return g;
  };
  const tube = (ca: Curve, cb: Curve, count: number, radius: number) => {
    const pa = new Float32Array(count * 3), pb = new Float32Array(count * 3), at = new Float32Array(count), sd = new Float32Array(count), ta = new THREE.Vector3(), tb = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const t = Math.random(); ca.getPointAt(t, ta); cb.getPointAt(t, tb);
      const r = radius * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const ox = r * Math.sin(ph) * Math.cos(th), oy = r * Math.cos(ph), oz = r * Math.sin(ph) * Math.sin(th);
      pa.set([ta.x + ox, ta.y + oy, ta.z + oz], i * 3); pb.set([tb.x + ox, tb.y + oy, tb.z + oz], i * 3);
      at[i] = t; sd[i] = Math.random();
    }
    return geo(pa, pb, at, sd);
  };
  const orb = (na: THREE.Vector3, nb: THREE.Vector3, radius: number, count: number) => {
    const pa = new Float32Array(count * 3), pb = new Float32Array(count * 3), at = new Float32Array(count), sd = new Float32Array(count), d = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const r = Math.random() < 0.8 ? radius * (0.82 + 0.18 * Math.random()) : radius * Math.random() * 0.8;
      pa.set([na.x + d.x * r, na.y + d.y * r, na.z + d.z * r], i * 3); pb.set([nb.x + d.x * r, nb.y + d.y * r, nb.z + d.z * r], i * 3);
      at[i] = Math.random(); sd[i] = Math.random();
    }
    return geo(pa, pb, at, sd);
  };
  // offset-only tube: the lane vertex shader bends it along a Bézier, so one geometry serves every lane
  const unit = (count: number, radius: number) => {
    const pa = new Float32Array(count * 3), at = new Float32Array(count), sd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = radius * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pa.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
      at[i] = Math.random(); sd[i] = Math.random();
    }
    return geo(pa, pa.slice(), at, sd);
  };
  const n = (c: number) => Math.round(c * 0.75);
  let agentGeo: THREE.BufferGeometry | undefined, laneGeo: THREE.BufferGeometry | undefined;
  const G = {
    in: tube(A.C.in, B.C.in, n(800), 0.16),
    out: [0, 1, 2].map(i => tube(A.C.out[i], B.C.out[i], n(800), 0.2)),
    ret: [0, 1, 2].map(i => tube(A.C.ret[i], B.C.ret[i], n(800), 0.2)),
    ship: tube(A.C.ship, B.C.ship, n(800), 0.16),
    esc: tube(A.C.esc, B.C.esc, n(700), 0.14),
    trunk: tube(A.C.trunk, B.C.trunk, n(4000), 0.09),
    teth: tube(A.C.esc, B.C.esc, 160, 0.015),
    you: orb(A.N.you, B.N.you, 0.45, n(320)), plan: orb(A.N.plan, B.N.plan, 1.15, n(1700)),
    exec: [0, 1, 2].map(i => orb(A.N.exec[i], B.N.exec[i], 0.9, n(1000))),
    // unit orb at the origin (each agent slot positions and scales it), built on first use: a builders-only board draws no
    // Math.random for it, so the demo's random stream (and its fast-forward) matches a board without agents
    get agent(): THREE.BufferGeometry { return (agentGeo ??= orb(new THREE.Vector3(), new THREE.Vector3(), 1, n(560))); },
    // lazy like agent: built when the first lane material binds (LaneObj.build), so a board without agents draws no Math.random for lanes
    get lane(): THREE.BufferGeometry { return (laneGeo ??= unit(n(800), 0.2)); },
    review: orb(A.N.review, B.N.review, 1.15, n(1700)), main: orb(A.N.main, B.N.main, 0.6, n(500)), fable: orb(A.N.fable, B.N.fable, 1.0, n(1000)),
  };
  const gateDef = (ca: Curve, cb: Curve, t: number): Gate => ({
    pa: ca.getPointAt(t), pb: cb.getPointAt(t),
    qa: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ca.getTangentAt(t).normalize()),
    qb: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cb.getTangentAt(t).normalize()),
  });
  const GD: Record<string, Gate> = { route: gateDef(A.C.in, B.C.in, 0.55), commit: gateDef(A.C.ship, B.C.ship, 0.45) };
  [0, 1, 2].forEach(i => { GD["d" + i] = gateDef(A.C.out[i], B.C.out[i], 0.5); GD["r" + i] = gateDef(A.C.ret[i], B.C.ret[i], 0.5); });
  const curveOf = (key: string, P: 0 | 1): Curve => { const C = P ? B.C : A.C; return key.startsWith("out") ? C.out[+key[3]] : key.startsWith("ret") ? C.ret[+key[3]] : C[key as "in" | "ship" | "esc" | "trunk"]; };
  return { G, GD, curveOf };
}
export type Geometry = ReturnType<typeof buildGeometry>;
