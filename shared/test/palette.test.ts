import { describe, expect, it } from "vitest";
import { PALETTE, isPaletteColor, nameColor } from "../src/palette";

describe("palette", () => {
  it("has 10 distinct lower-case hex colours", () => {
    expect(PALETTE).toHaveLength(10);
    expect(new Set(PALETTE).size).toBe(10);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("accepts only palette values", () => {
    expect(isPaletteColor("#e06c75")).toBe(true);
    expect(isPaletteColor("#E06C75")).toBe(false);
    expect(isPaletteColor("#123456")).toBe(false);
    expect(isPaletteColor(null)).toBe(false);
  });
  it("nameColor matches the server/helper FNV-1a hash", () => {
    // Values pinned from the previous server implementation (Buffer-based).
    expect(nameColor("flowapp")).toBe("#69c5d3");
    expect(nameColor("ember")).toBe("#698cd3");
    expect(nameColor("meadow")).toBe("#d36969");
    expect(nameColor("ä")).toBe("#69d36c");
  });
});
