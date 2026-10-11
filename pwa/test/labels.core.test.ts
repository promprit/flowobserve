import { describe, expect, it } from "vitest";
import { LABEL_DEFS, coreHidden, nodeOf } from "../src/scene/labels";
import { topology } from "../src/scene/topology";
describe("coreHidden", () => {
  it("hidden only when every loop of that core shows the same name", () => {
    const c = { key: "k", name: "app" };
    expect(coreHidden(c, [{ key: "k", name: "app" }, { key: "k", name: "app" }, { key: "z", name: "x" }])).toBe(true);
    expect(coreHidden(c, [{ key: "k", name: "app" }, { key: "k", name: "app2" }])).toBe(false);
    expect(coreHidden(c, [])).toBe(false);
  });
});
it("no floating count label defs", () => {
  const keys = LABEL_DEFS.map((d) => d[0]);
  expect(keys).not.toContain("sq"); expect(keys).not.toContain("sd");
  const T = topology(false);
  expect(nodeOf(T, "plan")).toBe(T.N.plan);
});
