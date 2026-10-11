import { describe, expect, it } from "vitest";
import { layoutPages, type LayoutSession } from "../src/layout";
import { portraitOrder } from "../src/portrait";
import { landscapeTabs, portraitTabs } from "../src/tabs";

const S = (id: string, name: string, startedAt: number, openUrl: string | null = `vscode://file/${name}`): LayoutSession =>
  ({ id, name, openUrl, status: "active", startedAt, lastEventAt: startedAt });
const none = () => false;
const labels = (ts: { name: string; num: number | null }[]) => ts.map((t) => (t.num ? `${t.name} ${t.num}` : t.name));

describe("portraitTabs", () => {
  const list = [S("f1", "flowobserve", 0), S("b1", "meadow", 5), S("f2", "flowobserve", 10)];
  const order = portraitOrder(list, new Map());
  it("one tab per session, pager order, number only with 2+ live sessions", () => {
    expect(labels(portraitTabs(list, order, none))).toEqual(["flowobserve 1", "flowobserve 2", "meadow"]);
    expect(portraitTabs(list, order, none).map((t) => t.id)).toEqual(["f1", "f2", "b1"]);
  });
  it("a session ends: the rest of its project renumber by position", () => {
    const left = list.filter((s) => s.id !== "f1"), o = order.filter((id) => id !== "f1");
    expect(labels(portraitTabs(left, o, none))).toEqual(["flowobserve", "meadow"]);
    expect(portraitTabs(left, o, none)[0].id).toBe("f2");
  });
  it("numbers by start order within the project even if order lists them otherwise", () => {
    expect(portraitTabs(list, ["f2", "f1", "b1"], none).map((t) => `${t.id}:${t.num}`)).toEqual(["f2:2", "f1:1", "b1:null"]);
  });
  it("need is per session", () => {
    expect(portraitTabs(list, order, (id) => id === "f2").map((t) => t.need)).toEqual([false, true, false]);
  });
  it("same name, different project key: numbered separately", () => {
    const two = [S("a", "app", 0, "vscode://file/x/app"), S("b", "app", 1, "vscode://file/y/app")];
    expect(labels(portraitTabs(two, portraitOrder(two, new Map()), none))).toEqual(["app", "app"]);
  });
  it("ids in order that are no longer live are skipped", () => {
    expect(portraitTabs(list, [...order, "gone"], none)).toHaveLength(3);
  });
});

describe("landscapeTabs", () => {
  const list = [S("f1", "flowobserve", 0), S("b1", "meadow", 5), S("f2", "flowobserve", 10)];
  it("one tab per project, no number, need if any session needs you", () => {
    const ts = landscapeTabs(layoutPages(list), (id) => id === "f2");
    expect(ts.map((t) => [t.name, t.num, t.need])).toEqual([["flowobserve", null, true], ["meadow", null, false]]);
    expect(ts[0].id).toBe("vscode://file/flowobserve");
  });
  it("same display name, two keys → two tabs", () => {
    const two = [S("a", "app", 0, "vscode://file/x/app"), S("b", "app", 1, "vscode://file/y/app")];
    expect(landscapeTabs(layoutPages(two), none).map((t) => t.name)).toEqual(["app", "app"]);
  });
  it("no pages → no tabs", () => expect(landscapeTabs([], none)).toEqual([]));
});
