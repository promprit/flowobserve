import { describe, expect, it } from "vitest";
import type { LayoutSession } from "../src/layout";
import { pageAfter, portraitOrder, stepIn } from "../src/portrait";

const L = (id: string, proj: string, startedAt: number): LayoutSession =>
  ({ id, name: proj, openUrl: `vscode://file/${proj}`, status: "active", startedAt, lastEventAt: startedAt });

describe("portraitOrder", () => {
  it("project order, then start order", () => {
    expect(portraitOrder([L("b1", "B", 5), L("a2", "A", 10), L("a1", "A", 0)], new Map())).toEqual(["a1", "a2", "b1"]);
  });
  it("a new session joins its project's run", () => {
    const r = new Map<string, number>();
    portraitOrder([L("a1", "A", 0), L("b1", "B", 5)], r);
    expect(portraitOrder([L("a1", "A", 0), L("b1", "B", 5), L("a3", "A", 20)], r)).toEqual(["a1", "a3", "b1"]);
  });
  it("ending a project's oldest session never reorders the rest", () => {
    const r = new Map<string, number>();
    portraitOrder([L("a1", "A", 0), L("a2", "A", 10), L("b1", "B", 5)], r);
    expect(portraitOrder([L("a2", "A", 10), L("b1", "B", 5)], r)).toEqual(["a2", "b1"]);
  });
  it("stable across status changes", () => {
    const r = new Map<string, number>(), a = [L("a1", "A", 0), L("b1", "B", 5)];
    const x = portraitOrder(a, r);
    expect(portraitOrder(a.map((s) => ({ ...s, status: "waiting", lastEventAt: 99 })), r)).toEqual(x);
  });
});

describe("pageAfter", () => {
  it("stays on the same id", () => expect(pageAfter(["a", "b", "c"], ["a", "b", "c", "d"], "b")).toBe("b"));
  it("current ended → next neighbour, else previous", () => {
    expect(pageAfter(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
    expect(pageAfter(["a", "b", "c"], ["a", "b"], "c")).toBe("b");
  });
  it("empty → null; unknown → first", () => {
    expect(pageAfter(["a"], [], "a")).toBeNull();
    expect(pageAfter([], ["x", "y"], null)).toBe("x");
  });
});

describe("stepIn", () => {
  it("wraps", () => { expect(stepIn(["a", "b", "c"], "c", 1)).toBe("a"); expect(stepIn(["a", "b", "c"], "a", -1)).toBe("c"); });
  it("< 2 → null", () => expect(stepIn(["a"], "a", 1)).toBeNull());
});
