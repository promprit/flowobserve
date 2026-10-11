import { describe, expect, it } from "vitest";
import type { WireNode } from "@fo/shared";
import { placePopover, popoverContent } from "../src/ui/inspect";
import { T0, sess } from "./helpers";

const N = (p: Partial<WireNode> & Pick<WireNode, "key" | "state">): WireNode => ({ model: null, startedAt: null, task: null, waiting: null, ...p });
const log = ["one", "two", "three", "four"].map((text, i) => ({ t: T0 + i, text }));
const text = (p: ReturnType<typeof popoverContent>) => p!.lines.map((l) => `${l.cls}:${l.text}`);

describe("popoverContent", () => {
  it("builder: model · state · run time, then task, then the last 3 log lines", () => {
    const s = sess("a", { log, nodes: [N({ key: "b1", state: "working", model: "opus", startedAt: T0 - 252_000, task: "Task 2" })] });
    expect(text(popoverContent(s, "b1", T0))).toEqual(["head:Opus · working · 4m 12s", "task:Task 2", "log:two", "log:three", "log:four"]);
  });
  it("builder without a known model or start shows only its state", () => {
    const s = sess("a", { nodes: [N({ key: "b0", state: "done" })] });
    expect(text(popoverContent(s, "b0", T0))).toEqual(["head:done"]);
  });
  it("fable: Fable · escalated · run time + task", () => {
    const s = sess("a", { nodes: [N({ key: "fable", state: "escalated", model: "fable", startedAt: T0 - 63_000, task: "T" })] });
    expect(text(popoverContent(s, "fable", T0))).toEqual(["head:Fable · escalated · 1m 03s", "task:T"]);
  });
  it("you: waiting text, then how long", () => {
    const s = sess("a", { nodes: [N({ key: "you", state: "waiting", startedAt: T0 - 360_000, waiting: "Which DB?" })] });
    expect(text(popoverContent(s, "you", T0))).toEqual(["wait:Which DB?", "head:waiting 6m"]);
  });
  it("plan/review/main: time in stage and cycle time", () => {
    const s = sess("a", { stageAt: [T0 - 1_080_000, T0 - 180_000, null, null, null, null, null], nodes: [N({ key: "plan", state: "current", startedAt: T0 - 180_000 })] });
    expect(text(popoverContent(s, "plan", T0))).toEqual(["head:in stage 3m · cycle 18m"]);
  });
  it("a node with nothing to say, or a session without nodes on the wire, has no popover", () => {
    expect(popoverContent(sess("a", { nodes: [] }), "plan", T0)).toBeNull();
    const old = sess("a"); delete (old as Partial<typeof old>).nodes; delete (old as Partial<typeof old>).stageAt;
    expect(popoverContent(old, "you", T0)).toBeNull();
    expect(popoverContent(undefined, "you", T0)).toBeNull();
  });
  it("only a vscode:// link becomes the Open action", () => {
    const nodes = [N({ key: "b0", state: "done" })];
    expect(popoverContent(sess("a", { nodes, openUrl: "vscode://file/a" }), "b0", T0)!.openUrl).toBe("vscode://file/a");
    expect(popoverContent(sess("a", { nodes, openUrl: "javascript:alert(1)" }), "b0", T0)!.openUrl).toBeNull();
  });
});

describe("placePopover", () => {
  const w = 200, h = 100, r = 20;
  const inside = (p: { x: number; y: number }, W: number, H: number) => p.x >= 8 && p.y >= 8 && p.x + w <= W - 8 && p.y + h <= H - 8;
  const covers = (p: { x: number; y: number }, a: { x: number; y: number }) =>
    p.x < a.x + r && p.x + w > a.x - r && p.y < a.y + r && p.y + h > a.y - r;
  it("sits above the node by default", () => {
    expect(placePopover({ x: 400, y: 300, r }, w, h, 800, 600)).toEqual({ x: 300, y: 170, side: "above" });
  });
  it("flips below near the top edge", () => {
    expect(placePopover({ x: 400, y: 60, r }, w, h, 800, 600).side).toBe("below");
  });
  it("flips left when neither above nor below fit", () => {
    expect(placePopover({ x: 400, y: 100, r }, w, h, 800, 200).side).toBe("left");
  });
  it("flips right when left does not fit either", () => {
    expect(placePopover({ x: 100, y: 100, r }, w, h, 800, 200).side).toBe("right");
  });
  it("slides along the edge instead of flipping when only the side edge is near", () => {
    expect(placePopover({ x: 790, y: 300, r }, w, h, 800, 600)).toEqual({ x: 592, y: 170, side: "above" });
  });
  it("stays inside the 8px margin and never covers its node, across real Loop-zone sizes", () => {
    // 768×1024 portrait (zone 768×512), 1024×768 landscape (614×768), 1440×900 landscape (864×900)
    for (const [W, H] of [[768, 512], [614, 768], [864, 900]]) for (let x = 0; x <= W; x += 32) for (let y = 0; y <= H; y += 32) {
      const p = placePopover({ x, y, r }, w, h, W, H);
      expect(inside(p, W, H), `${W}x${H} @${x},${y}`).toBe(true);
      expect(covers(p, { x, y }), `${W}x${H} @${x},${y} covers`).toBe(false);
    }
  });
});
