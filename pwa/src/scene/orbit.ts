import * as THREE from "three";
import { clamp, easeIO } from "../util";

/** Free camera (spec §4): bounded orbit around the loop, eased home after idle. Angles in degrees; yaw/pitch are offsets from home. */
export const ORBIT = { yaw: 35, yawPortrait: 25, pitchMin: 8, pitchMax: 40, idleMs: 20_000, easeMs: 900, clickPx: 5, degPerPx: 0.25 } as const;
export const orbit = { yaw: 0, pitch: 0, lastInput: -Infinity, dragging: false, ease: null as { yaw: number; pitch: number; at: number } | null };

export const isDrag = (x0: number, y0: number, x1: number, y1: number) => Math.hypot(x1 - x0, y1 - y0) >= ORBIT.clickPx;

export function orbitBy(dx: number, dy: number, portrait: boolean, now: number): void {
  const lim = portrait ? ORBIT.yawPortrait : ORBIT.yaw;
  orbit.ease = null;
  orbit.yaw = clamp(orbit.yaw - dx * ORBIT.degPerPx, -lim, lim);
  orbit.pitch = clamp(orbit.pitch + dy * ORBIT.degPerPx, -ORBIT.pitchMax, ORBIT.pitchMax);
  orbit.lastInput = now;
}

export function goHome(now: number, reduce: boolean): void {
  if (reduce || (!orbit.yaw && !orbit.pitch)) { orbit.yaw = 0; orbit.pitch = 0; orbit.ease = null; return; }
  orbit.ease = { yaw: orbit.yaw, pitch: orbit.pitch, at: now };
}

/** Advances the ease and starts the idle ease home. True while the camera moves. */
export function orbitTick(now: number, reduce: boolean): boolean {
  if (!orbit.dragging && !orbit.ease && (orbit.yaw || orbit.pitch) && now - orbit.lastInput >= ORBIT.idleMs) goHome(now, reduce);
  const e = orbit.ease;
  if (e) {
    const p = clamp((now - e.at) / ORBIT.easeMs, 0, 1), k = 1 - easeIO(p);
    orbit.yaw = e.yaw * k; orbit.pitch = e.pitch * k;
    if (p >= 1) { orbit.yaw = 0; orbit.pitch = 0; orbit.ease = null; }
    return true;
  }
  return orbit.dragging;
}

const D2R = Math.PI / 180, hz = new THREE.Vector3();
/** Rotates the camera offset (camera − target) by yaw around the floor normal and tilts it by pitch, keeping its length.
 *  Elevation stays within [8°, max(40°, home)]. Returns the pitch offset actually applied (degrees). */
export function applyOrbit(off: THREE.Vector3, up: THREE.Vector3, yawDeg: number, pitchDeg: number): number {
  const len = off.length(); if (!len) return 0;
  const e0 = Math.asin(clamp(off.dot(up) / len, -1, 1));
  const e = clamp(e0 + pitchDeg * D2R, Math.min(ORBIT.pitchMin * D2R, e0), Math.max(ORBIT.pitchMax * D2R, e0));
  off.applyAxisAngle(up, yawDeg * D2R);
  hz.copy(off).addScaledVector(up, -off.dot(up));
  const hl = hz.length() || 1;
  off.copy(hz).multiplyScalar(Math.cos(e) * len / hl).addScaledVector(up, Math.sin(e) * len);
  return (e - e0) / D2R;
}

export function resetOrbit(): void { Object.assign(orbit, { yaw: 0, pitch: 0, lastInput: -Infinity, dragging: false, ease: null }); }
