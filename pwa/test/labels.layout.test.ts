import { describe, expect, it } from "vitest";
import { layoutLabels, type Box, type LItem } from "../src/scene/labels";

const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("layoutLabels", () => {
  // agents-d: the "4 AGENTS" group label sat on the REVIEW tally because every other spot in reach crossed the review rings,
  // and covering a placed label cost less than touching a ring. Text over text is unreadable; text over a ring is not.
  it("never lays a label over an already-placed label, even when the only alternative crosses a ring", () => {
    const placed: Box = { x: 0, y: 380, w: 1000, h: 90 }, ring: Box = { x: 0, y: 480, w: 1000, h: 520 };
    const item: LItem = { key: "agg", r: 1, mode: "below", x: 500, y: 500, rpx: 10, w: 80, h: 40 };
    const out = layoutLabels([item], 1000, 1000, [placed], [ring], []);
    expect(hit(out.agg, placed)).toBe(false);
  });
});
