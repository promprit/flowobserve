import * as THREE from "three";
import { HEX, SP } from "../config";
import { easeOut } from "../util";
import { topology } from "./topology";
import { projectSubset, type Galaxy } from "./galaxy";

const CA = topology(false).center, CB = topology(true).center;

export interface ThreadLine { id: string; x1: number; z1: number; x2: number; z2: number }
/** Grid units (x, z) -> world, plus each loop's visual centre (A.center / B.center), blended between the landscape frame (offA: x*SP.A[0], 0, z*SP.A[1]) and the portrait frame (offB: x*SP.B[0], -z*SP.B[1], 0) the loops use. */
export function galaxyFrame(m: number, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  const sx = SP.A[0] + (SP.B[0] - SP.A[0]) * m;
  return out.set(sx, 0, 0, CA.x + (CB.x - CA.x) * m, 0, 1, -SP.B[1] * m, CA.y + (CB.y - CA.y) * m, 0, 0, SP.A[1] * (1 - m), CA.z + (CB.z - CA.z) * m, 0, 0, 0, 1);
}

/** Half-size of one loop's nodes around its visual centre (A.center / B.center), padded for the glow. */
function loopExtent(P: boolean): { min: THREE.Vector3; max: THREE.Vector3 } {
  const T = topology(P), pts = [T.N.you, T.N.plan, ...T.N.exec, T.N.review, T.N.main, T.N.fable, T.anchor, ...T.C.trunk.points];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) { min.min(p); max.max(p); }
  return { min: min.sub(T.center).subScalar(2), max: max.sub(T.center).addScalar(2) };
}
const EXA = loopExtent(false), EXB = loopExtent(true);

const sP = new THREE.Vector3(), sLo = new THREE.Vector3(), sHi = new THREE.Vector3(), sQ = new THREE.Vector3(), sF = new THREE.Matrix4();
const sBack = new THREE.Vector3(), sRight = new THREE.Vector3(), sTop = new THREE.Vector3(), sC = new THREE.Vector3();
const expand2 = (box: THREE.Box3) => { box.expandByPoint(sQ.copy(sP).add(sLo)); box.expandByPoint(sQ.copy(sP).add(sHi)); };

/** World-space box around the galaxy's cores and loops at morph m (0 landscape, 1 portrait). Writes into `out` when given (no allocation). */
export function galaxyBox(g: { cores: { x: number; z: number }[]; loops: { x: number; z: number }[] }, m: number, out: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
  const box = out.makeEmpty(), f = galaxyFrame(m, sF);
  sLo.lerpVectors(EXA.min, EXB.min, m); sHi.lerpVectors(EXA.max, EXB.max, m);
  for (const c of g.cores) box.expandByPoint(sP.set(c.x, 0, c.z).applyMatrix4(f));
  for (const l of g.loops) { sP.set(l.x, 0, l.z).applyMatrix4(f); expand2(box); }
  if (box.isEmpty()) { sP.set(0, 0, 0).applyMatrix4(f); expand2(box); }
  return box;
}

/**
 * Camera pose that frames `box` for a camera looking along -dir (dir points from target to camera) with the given up hint:
 * target = box centre; distance = the smallest that keeps all 8 corners inside the (margin-shrunk) frustum.
 * `inset` = share of the screen height covered at the top (the header): the box is framed in the rest, its centre at NDC y = -inset.
 * `minDistance` = never closer than this (the camera may not sit nearer than the focused pose); the inset aim uses the final distance.
 */
export function overviewFrame(box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3, fovDeg: number, aspect: number, margin = 0.92, out: { target: THREE.Vector3; distance: number } = { target: new THREE.Vector3(), distance: 0 }, inset = 0, minDistance = 0): { target: THREE.Vector3; distance: number } {
  const target = box.getCenter(out.target), back = sBack.copy(dir).normalize();
  const right = sRight.crossVectors(up, back).normalize(), top = sTop.crossVectors(back, right);
  const tan = Math.tan(fovDeg * Math.PI / 360), ht = tan * margin * aspect, vt = tan * margin * (1 - inset);
  let distance = 0; const c = sC;
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
    distance = Math.max(distance, c.dot(back) + Math.abs(c.dot(right)) / ht, c.dot(back) + Math.abs(c.dot(top)) / vt);
  }
  out.distance = distance = Math.max(distance, minDistance);
  if (inset) target.addScaledVector(top, inset * distance * tan); // aim above the centre so it sits mid-way down the free area
  return out;
}

export interface Threads {
  frame(m: number): void;
  fade(o: number): void;
  set(lines: ThreadLine[]): void;
  pulse(id: string, nowMs: number): void;
  tick(nowMs: number, reduce: boolean): boolean;
  dispose(): void;
}

const PULSE_MS = 1500, BASE = [0.949, 0.941, 0.918, 0.22] as const;

/** Spec §3.6: the threads between a project core and its chat loops, one LineSegments for all of them. */
export function makeThreads(scene: THREE.Scene): Threads {
  const geo = new THREE.BufferGeometry(), mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true });
  const obj = new THREE.LineSegments(geo, mat); obj.frustumCulled = false; obj.matrixAutoUpdate = false; scene.add(obj);
  const paper = new THREE.Color(HEX.paper), at = new Map<string, number>();
  let lines: ThreadLine[] = [], sig = "", pos = new Float32Array(0), col = new Float32Array(0);
  const write = (i: number, k: number) => { // k 0..1: base -> full paper
    dirty = true;
    const a = BASE[3] + (1 - BASE[3]) * k;
    for (let v = 0; v < 2; v++) {
      const o = (i * 2 + v) * 4;
      col[o] = BASE[0] + (paper.r - BASE[0]) * k; col[o + 1] = BASE[1] + (paper.g - BASE[1]) * k; col[o + 2] = BASE[2] + (paper.b - BASE[2]) * k; col[o + 3] = a;
    }
  };
  let dirty = false;
  const flush = () => { if (!dirty) return; dirty = false; const c = geo.getAttribute("color"); if (c) c.needsUpdate = true; };
  return {
    frame(m) { galaxyFrame(m, obj.matrix); obj.matrixWorldNeedsUpdate = true; },
    fade(o) { mat.opacity = o; obj.visible = o > 0.01; },
    set(next) {
      const s = next.map((l) => `${l.id}:${l.x1},${l.z1},${l.x2},${l.z2}`).join("|");
      if (s === sig) return;
      sig = s; lines = next;
      pos = new Float32Array(next.length * 6); col = new Float32Array(next.length * 8);
      next.forEach((l, i) => { pos.set([l.x1, 0, l.z1, l.x2, 0, l.z2], i * 6); write(i, 0); });
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
      geo.setDrawRange(0, next.length * 2);
    },
    pulse(id, nowMs) { at.set(id, nowMs); },
    tick(nowMs, reduce) {
      if (reduce) { if (at.size) { at.clear(); lines.forEach((_, i) => write(i, 0)); flush(); } return false; }
      let live = false;
      lines.forEach((l, i) => {
        const t0 = at.get(l.id);
        if (t0 === undefined) return;
        const p = (nowMs - t0) / PULSE_MS;
        if (p >= 1) { at.delete(l.id); write(i, 0); return; }
        live = true; write(i, 1 - easeOut(Math.max(0, p)));
      });
      flush();
      return live;
    },
    dispose() { scene.remove(obj); geo.dispose(); mat.dispose(); },
  };
}

/** What the overview pose frames: in portrait the current tab's project (spec 2026-10-08 §3), in landscape every project. */
export function poseBox(g: Galaxy, focus: string | null, portrait: boolean, m: number, out: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
  return galaxyBox(portrait ? projectSubset(g, focus) : g, m, out);
}
