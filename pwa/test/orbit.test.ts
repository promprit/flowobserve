import { beforeEach, describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { applyOrbit, goHome, isDrag, ORBIT, orbit, orbitBy, orbitTick, resetOrbit } from "../src/scene/orbit";

beforeEach(() => resetOrbit());
const elev = (v: Vector3, up: Vector3) => Math.asin(v.dot(up) / v.length()) * 180 / Math.PI;

describe("click vs drag", () => {
  it("under 5 px is a click, 5 px or more is a drag", () => {
    expect(isDrag(0, 0, 3, 3)).toBe(false);   // 4.24 px
    expect(isDrag(0, 0, 4, 0)).toBe(false);
    expect(isDrag(0, 0, 5, 0)).toBe(true);
  });
});

describe("orbitBy", () => {
  it("clamps yaw to ±35° landscape and ±25° portrait", () => {
    orbitBy(-10_000, 0, false, 0); expect(orbit.yaw).toBe(35);
    orbitBy(10_000, 0, false, 0); expect(orbit.yaw).toBe(-35);
    resetOrbit(); orbitBy(-10_000, 0, true, 0); expect(orbit.yaw).toBe(25);
  });
  it("records the input time and cancels an ease in progress", () => {
    orbitBy(-40, 0, false, 0); goHome(10, false);
    orbitBy(-4, 0, false, 50);
    expect(orbit.ease).toBeNull();
    expect(orbit.lastInput).toBe(50);
  });
});

describe("ease home", () => {
  it("starts 20 s after the last input and lands in 900 ms", () => {
    orbitBy(-80, 0, false, 0);
    expect(orbitTick(ORBIT.idleMs - 1, false)).toBe(false);
    expect(orbitTick(ORBIT.idleMs, false)).toBe(true);
    orbitTick(ORBIT.idleMs + 450, false);
    expect(Math.abs(orbit.yaw)).toBeGreaterThan(0);
    orbitTick(ORBIT.idleMs + ORBIT.easeMs, false);
    expect(orbit.yaw).toBe(0); expect(orbit.ease).toBeNull();
  });
  it("is a cut under reduced motion, and never runs while dragging", () => {
    orbitBy(-80, 0, false, 0); orbit.dragging = true;
    expect(orbitTick(ORBIT.idleMs * 2, false)).toBe(true);
    expect(orbit.yaw).not.toBe(0);
    orbit.dragging = false; goHome(0, true);
    expect(orbit.yaw).toBe(0); expect(orbit.ease).toBeNull();
  });
});

describe("applyOrbit", () => {
  const up = new Vector3(0, 1, 0), home = () => new Vector3(0, 21.6, 26.5);
  it("is a no-op at home and keeps the camera distance", () => {
    const v = home(); applyOrbit(v, up, 0, 0);
    expect(v.distanceTo(home())).toBeLessThan(1e-9);
    const w = home(); applyOrbit(w, up, 30, -10);
    expect(w.length()).toBeCloseTo(home().length());
  });
  it("never tilts below 8° or above 40° (or above home, if home is higher)", () => {
    const lo = home(); applyOrbit(lo, up, 0, -90); expect(elev(lo, up)).toBeCloseTo(8);
    const hi = home(); applyOrbit(hi, up, 0, 90); expect(elev(hi, up)).toBeCloseTo(40);
    const steep = new Vector3(0, 48, 28); const e0 = elev(steep, up);
    applyOrbit(steep, up, 0, 0); expect(elev(steep, up)).toBeCloseTo(e0);
  });
  it("yaw rotates around the floor normal", () => {
    const v = home(); applyOrbit(v, up, 90, 0);
    expect(v.y).toBeCloseTo(21.6); expect(v.z).toBeCloseTo(0); expect(Math.abs(v.x)).toBeCloseTo(26.5);
  });
});
