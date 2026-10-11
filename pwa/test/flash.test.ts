import { describe, expect, it } from "vitest";
import { FLASH_MS, FLASH_STALE_MS, flashLit, flashSeen } from "../src/scene/flash";

describe("flashLit", () => {
  it("one bell over 1.2 s", () => {
    expect(flashLit(-1, false)).toBe(0);
    expect(flashLit(0, false)).toBe(0);
    expect(flashLit(FLASH_MS / 2, false)).toBeCloseTo(0.9);
    expect(flashLit(FLASH_MS, false)).toBe(0);
  });
  it("reduced motion: steady brighten for the same span", () => {
    expect(flashLit(10, true)).toBe(0.5);
    expect(flashLit(FLASH_MS - 1, true)).toBe(0.5);
    expect(flashLit(FLASH_MS, true)).toBe(0);
  });
});

describe("flashSeen", () => {
  it("first sighting never flashes (load, reconnect)", () => {
    const m = new Map<string, number>();
    expect(flashSeen(m, "a", 100, 100)).toBe(false);
    expect(flashSeen(m, "a", 100, 100)).toBe(false);
    expect(flashSeen(m, "a", 200, 200)).toBe(true);
  });
  it("seen without a flash, then one arrives → flashes", () => {
    const m = new Map<string, number>();
    expect(flashSeen(m, "b", null, 0)).toBe(false);
    expect(flashSeen(m, "b", 50, 50)).toBe(true);
  });
  it("an older at never flashes", () => {
    expect(flashSeen(new Map([["c", 300]]), "c", 200, 200)).toBe(false);
  });
  it("stale flash never flashes", () => {
    const m = new Map([["d", 100]]);
    expect(flashSeen(m, "d", 200, 200 + FLASH_STALE_MS + 1)).toBe(false);
    expect(m.get("d")).toBe(200);
    expect(flashSeen(m, "d", 300, 300 + FLASH_STALE_MS)).toBe(true);
  });
});
