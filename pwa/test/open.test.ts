import type { Project } from "@fo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { helperUrl } from "../src/helper";
import { store } from "../src/state";
import { closeDrawer, drawerOpen, openDrawer } from "../src/ui/drawer";
import { bestAction, closeSheet, gridHint, openSheet, renderSheet, sheetOpen } from "../src/ui/open";
import { bindOpen } from "../src/ui/open";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

const TOKEN = "a".repeat(64);
const U = (n: number) => `${String(n).repeat(8)}-1111-1111-1111-111111111111`;
const jump = (p: number, n = 1) => `flowobserve://jump?iterm=w0t${n}p${p}%3A${U(p + 1)}`;
const RID = "22222222-2222-2222-2222-222222222222";
const RID2 = "33333333-3333-3333-3333-333333333333";

const folder = (rel: string, patch: Partial<Project["folders"][number]> = {}) => ({ rel, worktree: null, live: null, restore: [], ...patch });
const proj = (key: string, folders: Project["folders"], patch: Partial<Project> = {}): Project =>
  ({ key, name: key, group: null, color: "#aabbcc", folders, ...patch });
const restore = (...ids: string[]) => ids.map((id) => ({ id, title: null, endedAt: T0 }));

let bound = false;
beforeEach(() => {
  reset(); loadDom(); closeDrawer();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: TOKEN });
  if (!bound) { bindOpen(); bound = true; }
  closeSheet();
  vi.restoreAllMocks();
});
const sheet = () => document.querySelector<HTMLElement>("#sheet")!;
const btn = () => document.querySelector<HTMLElement>("#open-btn")!;
const row = (key: string) => sheet().querySelector<HTMLElement>(`.op-row[data-key="${key}"]`)!;
const rowsText = () => [...sheet().querySelectorAll<HTMLElement>(".op-row")].map((r) => r.dataset.key);
const go = () => vi.spyOn(nav, "go").mockImplementation(() => {});
const key = (k: string, init: KeyboardEventInit = {}) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));

describe("bestAction", () => {
  it("collapsed row shows the single best action: a live iterm folder jumps with the session's bare jumpUrl", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    expect(bestAction(proj("a", [folder("a", { live: "s1" })]))).toEqual({ kind: "jump", url: jump(0) });
  });
  it("a live VS Code session jumps with its openUrl", () => {
    const openUrl = "vscode://file/Users/p/app";
    store.sessions.set("s1", sess("s1", { host: "vscode", openUrl }));
    expect(bestAction(proj("a", [folder("a", { live: "s1" })]))).toEqual({ kind: "jump", url: openUrl });
  });
  it("a live iterm session without a helper token jumps with its vscode link, as in v1", () => {
    store.helperToken = null;
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0), openUrl: "vscode://file/x" }));
    expect(bestAction(proj("a", [folder("a", { live: "s1" })]))).toEqual({ kind: "jump", url: "vscode://file/x" });
  });
  it("a live iterm session with a malformed jumpUrl has no jump url", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: "flowobserve://jump?iterm=bad", openUrl: "vscode://file/x" }));
    expect(bestAction(proj("a", [folder("a", { live: "s1" })])).url).toBeNull();
  });
  it("without a live session the main folder restores its ended sessions", () => {
    const p = proj("a", [folder("a", { restore: restore(RID, RID2) })]);
    expect(bestAction(p)).toEqual({ kind: "restore", url: helperUrl.open("a", [RID, RID2], false, null, "#aabbcc"), n: 2 });
  });
  it("with nothing to resume it opens a new session", () => {
    expect(bestAction(proj("a", [folder("a")]))).toEqual({ kind: "new", url: helperUrl.open("a", [], false, null, "#aabbcc") });
  });
});

describe("open button", () => {
  it("is hidden with no projects and a present root, visible otherwise", () => {
    renderSheet();
    expect(btn().hidden).toBe(true);
    store.projects = [proj("a", [folder("a")])];
    renderSheet();
    expect(btn().hidden).toBe(false);
    store.projects = []; store.rootMissing = true;
    renderSheet();
    expect(btn().hidden).toBe(false);
  });
  it("opens the sheet on click and on O, ignores modified O and typing in another input", () => {
    store.projects = [proj("a", [folder("a")])];
    renderSheet();
    btn().click();
    expect(sheetOpen()).toBe(true);
    closeSheet();
    key("o", { metaKey: true });
    expect(sheetOpen()).toBe(false);
    const input = document.createElement("input");
    document.body.append(input); input.focus();
    key("O");
    expect(sheetOpen()).toBe(false);
    input.remove();
    (document.activeElement as HTMLElement | null)?.blur();
    key("O");
    expect(sheetOpen()).toBe(true);
  });
  it("keeps its pointerdown from the loop, whose pointer capture would retarget the click to #loop", () => {
    const loop = vi.fn();
    document.querySelector("#loop")!.addEventListener("pointerdown", loop);
    btn().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(loop).not.toHaveBeenCalled();
  });
});

describe("group row acts on the group folder", () => {
  const self = (patch: Partial<Project["folders"][number]> = {}) => proj("dryas", [folder("dryas", patch)], { group: "dryas" });
  const members = () => [proj("site", [folder("dryas/site")], { group: "dryas" }), proj("os", [folder("dryas/os")], { group: "dryas" })];
  const keys = () => rowsText().filter(Boolean);
  const grow = () => sheet().querySelector<HTMLElement>('.op-row[data-group="dryas"]')!;
  // Expanded state is module-level and survives between tests, so start every test collapsed.
  const open = (ps: Project[]) => {
    store.projects = ps;
    openSheet();
    if (grow().textContent!.includes("▾")) grow().click();
  };

  it("group row opens the group folder itself", () => {
    const spy = go();
    open([self(), ...members()]);
    const b = grow().querySelector<HTMLElement>(".op-b");
    expect(b).not.toBeNull();
    expect(b!.textContent).toBe("New");
    b!.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(helperUrl.open("dryas", [], false, null, "#aabbcc"));
  });
  it("a live group folder jumps with the session's jump url", () => {
    const spy = go();
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    open([self({ live: "s1" }), ...members()]);
    const b = grow().querySelector<HTMLElement>(".op-b")!;
    expect(b.textContent).toBe("Jump");
    b.click();
    expect(spy).toHaveBeenLastCalledWith(`${jump(0)}&t=${TOKEN}`);
  });
  it("a group folder with ended sessions restores them", () => {
    const spy = go();
    open([self({ restore: restore(RID) }), ...members()]);
    const b = grow().querySelector<HTMLElement>(".op-b")!;
    expect(b.textContent).toBe("Restore 1");
    b.click();
    expect(spy).toHaveBeenLastCalledWith(helperUrl.open("dryas", [RID], false, null, "#aabbcc"));
  });
  it("the subtitle lists only the member repos, not the group itself", () => {
    open([self(), ...members()]);
    expect(grow().querySelector(".op-sub")!.textContent).toBe("group · site · os");
  });
  it("expanding shows only the member repos, with no duplicate group row", () => {
    open([self(), ...members()]);
    grow().click();
    expect(keys()).toEqual(["site", "os"]);
    expect(grow().querySelector(".op-b")).not.toBeNull();
    expect(grow().textContent).toContain("▾");
  });
  it("clicking the row outside the button toggles; clicking the button does not", () => {
    go();
    open([self(), ...members()]);
    expect(keys()).toEqual([]);
    grow().querySelector<HTMLElement>(".op-b")!.click();
    expect(keys()).toEqual([]);
    grow().querySelector<HTMLElement>(".op-n")!.click();
    expect(keys()).toEqual(["site", "os"]);
    grow().querySelector<HTMLElement>(".op-b")!.click();
    expect(keys()).toEqual(["site", "os"]);
    grow().querySelector<HTMLElement>(".op-n")!.click();
    expect(keys()).toEqual([]);
  });
  it("filtering by the group name keeps the group row with its button", () => {
    open([self(), ...members(), proj("solo", [folder("solo")])]);
    const f = sheet().querySelector<HTMLInputElement>("input")!;
    f.value = "dryas";
    f.dispatchEvent(new Event("input", { bubbles: true }));
    expect(grow().querySelector(".op-b")).not.toBeNull();
    expect(keys().filter((k) => k === "dryas")).toEqual([]);
  });
  it("without a group folder project the group row has no button", () => {
    open(members());
    expect(grow().querySelector(".op-b")).toBeNull();
    expect(grow().querySelector(".op-sub")!.textContent).toBe("group · site · os");
  });
});

describe("sheet", () => {
  it("lists projects but disables every button and explains why when there is no helper token", () => {
    store.helperToken = null;
    store.projects = [proj("a", [folder("a")]), proj("b", [folder("b", { restore: restore(RID) })])];
    openSheet();
    const bs = [...sheet().querySelectorAll<HTMLButtonElement>(".op-b")];
    expect(bs.length).toBeGreaterThan(0);
    expect(bs.every((b) => b.disabled)).toBe(true);
    expect(sheet().textContent).toContain("Re-run scripts/install.sh to enable opening sessions");
    expect(rowsText()).toEqual(["a", "b"]);
  });
  it("says so when the projects folder is missing", () => {
    store.rootMissing = true;
    openSheet();
    expect(sheet().textContent).toContain("Projects folder not found — SSD mounted?");
  });
  it("the filter narrows rows case-insensitively", () => {
    store.projects = [proj("Alpha", [folder("Alpha")]), proj("beta", [folder("beta")])];
    openSheet();
    const f = sheet().querySelector<HTMLInputElement>("input")!;
    f.value = "ALP";
    f.dispatchEvent(new Event("input", { bubbles: true }));
    expect(rowsText()).toEqual(["Alpha"]);
  });
  it("each collapsed row carries one best-action button; jump is filled, restore is outlined", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    store.projects = [
      proj("live", [folder("live", { live: "s1" })]),
      proj("old", [folder("old", { restore: restore(RID) })]),
      proj("fresh", [folder("fresh")]),
    ];
    openSheet();
    const b = (k: string) => row(k).querySelectorAll<HTMLElement>(".op-b");
    expect(b("live")[0].className).toContain("jump");
    expect(b("old")).toHaveLength(1);
    expect(b("old")[0].className).toContain("restore");
    expect(b("old")[0].textContent).toBe("Restore 1");
    expect(b("fresh")).toHaveLength(1);
    expect(b("fresh")[0].textContent).toBe("New");
    expect(b("fresh")[0].dataset.url).not.toContain("wt=");
  });
  it("collapsed row with a live main offers Jump and New", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    store.projects = [proj("livemain", [folder("livemain", { live: "s1" })])];
    openSheet();
    const bs = [...row("livemain").querySelectorAll<HTMLElement>(".op-b")];
    expect(bs.map((x) => x.textContent)).toEqual(["Jump", "New"]);
    expect(bs[1].dataset.url).toBe(helperUrl.open("livemain", [], true, null, "#aabbcc"));
    expect(bs[1].dataset.url).toContain("&wt=1");
    expect(bs[1].title).toBe("New session in a fresh worktree from main");
  });
  it("a collapsed row whose only live session is a worktree stays a single Jump", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    store.projects = [proj("wtonly", [folder("wtonly"), folder("wtonly/wt-x", { worktree: "wt-x", live: "s1" })])];
    openSheet();
    expect([...row("wtonly").querySelectorAll(".op-b")].map((x) => x.textContent)).toEqual(["Jump"]);
  });
  it("expanding lists main first then worktrees, each with its own actions", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    store.projects = [proj("app", [
      folder("app/wt-x", { worktree: "wt-x", live: "s1" }),
      folder("app"),
      folder("app/wt-y", { worktree: "wt-y", restore: restore(RID) }),
    ].sort((a) => (a.worktree ? 1 : -1)))];
    openSheet();
    expect(sheet().querySelectorAll(".op-f")).toHaveLength(0);
    row("app").click();
    const fs = [...sheet().querySelectorAll<HTMLElement>(".op-f")];
    expect(fs.map((f) => f.dataset.rel)).toEqual(["app", "app/wt-x", "app/wt-y"]);
    const labels = (f: HTMLElement) => [...f.querySelectorAll(".op-b")].map((b) => b.textContent);
    expect(labels(fs[0])).toEqual(["New"]);
    expect(labels(fs[1])).toEqual(["Jump"]);
    expect(labels(fs[2])).toEqual(["Restore 1", "New"]);
    expect(fs[1].querySelector(".op-b")!.className).toContain("jump");
  });
  it("a live main row offers New in a fresh worktree", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    store.projects = [proj("app", [folder("app", { live: "s1" })])];
    openSheet();
    if (!sheet().querySelector(".op-f")) row("app").click();   // expanded state persists across tests
    const bs = [...sheet().querySelectorAll<HTMLElement>('.op-f[data-rel="app"] .op-b')];
    expect(bs.map((b) => b.textContent)).toEqual(["Jump", "New"]);
    expect(bs[1].dataset.url).toBe(helperUrl.open("app", [], true, null, "#aabbcc"));
    expect(bs[1].dataset.url).toContain("&wt=1");
    expect(bs[1].title).toBe("New session in a fresh worktree from main");
  });
  it("a live worktree row offers only Jump, and a free main row's New has no wt", () => {
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    store.projects = [proj("app", [folder("app"), folder("app/wt-x", { worktree: "wt-x", live: "s1" })])];
    openSheet();
    if (!sheet().querySelector(".op-f")) row("app").click();
    const bs = (rel: string) => [...sheet().querySelectorAll<HTMLElement>(`.op-f[data-rel="${rel}"] .op-b`)];
    expect(bs("app/wt-x").map((b) => b.textContent)).toEqual(["Jump"]);
    expect(bs("app").map((b) => b.textContent)).toEqual(["New"]);
    expect(bs("app")[0].dataset.url).not.toContain("wt=");
    expect(bs("app")[0].title).toBe("");
  });
  it("a group row expands to its repos", () => {
    store.projects = [
      proj("site", [folder("dryas/site")], { group: "dryas" }),
      proj("os", [folder("dryas/os")], { group: "dryas" }),
      proj("solo", [folder("solo")]),
    ];
    openSheet();
    const g = sheet().querySelector<HTMLElement>('.op-row[data-group="dryas"]')!;
    expect(g).toBeTruthy();
    expect(row("site")).toBeNull();
    g.click();
    expect(rowsText()).toContain("site");
    expect(rowsText()).toContain("os");
    expect(rowsText()).toContain("solo");
  });
  it("buttons navigate through go() with the expected urls", () => {
    const spy = go();
    store.sessions.set("s1", sess("s1", { host: "iterm", jumpUrl: jump(0) }));
    store.projects = [
      proj("live", [folder("live", { live: "s1" })]),
      proj("old", [folder("old", { restore: restore(RID) })]),
      proj("fresh", [folder("fresh")]),
    ];
    openSheet();
    row("live").querySelector<HTMLElement>(".op-b")!.click();
    expect(spy).toHaveBeenLastCalledWith(`${jump(0)}&t=${TOKEN}`);
    row("old").querySelector<HTMLElement>(".op-b")!.click();
    expect(spy).toHaveBeenLastCalledWith(helperUrl.open("old", [RID], false, null, "#aabbcc"));
    row("fresh").querySelector<HTMLElement>(".op-b")!.click();
    expect(spy).toHaveBeenLastCalledWith(helperUrl.open("fresh", [], false, null, "#aabbcc"));
    expect(spy).toHaveBeenCalledTimes(3);
  });
  it("escapes project names", () => {
    store.projects = [proj("x", [folder("x")], { name: "<i>boo</i>" })];
    openSheet();
    expect(sheet().innerHTML).not.toContain("<i>boo</i>");
  });
});

describe("review fixes", () => {
  it("repaint without changes keeps the same buttons", () => {
    store.projects = [proj("a", [folder("a")])];
    openSheet();
    const b = sheet().querySelector(".op-b");
    renderSheet();
    expect(sheet().querySelector(".op-b")).toBe(b);
    store.projects = [proj("a", [folder("a", { restore: restore(RID) })])];
    renderSheet();
    expect(sheet().querySelector(".op-b")).not.toBe(b);
  });
  it("O does nothing and is not swallowed in demo mode", () => {
    store.projects = [proj("a", [folder("a")])];
    renderSheet();
    store.demo = true;
    const e = new KeyboardEvent("keydown", { key: "o", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    store.demo = false;
    expect(e.defaultPrevented).toBe(false);
    expect(sheetOpen()).toBe(false);
  });
  it("O opens nothing while the Open button is hidden", () => {
    renderSheet();
    const e = new KeyboardEvent("keydown", { key: "o", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(sheetOpen()).toBe(false);
  });
  it("opening the spend drawer closes the sheet", async () => {
    store.projects = [proj("a", [folder("a")])];
    openSheet();
    await openDrawer();
    expect(sheetOpen()).toBe(false);
    expect(sheet().hidden).toBe(true);
    expect(drawerOpen()).toBe(true);
  });
});

describe("exclusivity", () => {
  it("openSheet closes the spend drawer and Escape closes the sheet", async () => {
    store.projects = [proj("a", [folder("a")])];
    await openDrawer();
    expect(drawerOpen()).toBe(true);
    openSheet();
    expect(drawerOpen()).toBe(false);
    expect(sheetOpen()).toBe(true);
    expect(sheet().hidden).toBe(false);
    key("Escape");
    expect(sheetOpen()).toBe(false);
    expect(sheet().hidden).toBe(true);
  });
});

describe("gridHint", () => {
  const iterm = (p: number, at: number, t = 1) => sess(`i${t}${p}`, { host: "iterm", jumpUrl: jump(p, t), lastEventAt: at });
  it("counts the splits used in the most recent tab", () => {
    expect(gridHint([iterm(0, T0), iterm(1, T0 + 1), iterm(2, T0 + 2)])).toBe("3 of 4 splits used · next opens here, then a new tab");
  });
  it("says the tab is full at four", () => {
    expect(gridHint([iterm(0, T0), iterm(1, T0), iterm(2, T0), iterm(3, T0 + 1)])).toBe("Tab full · next opens in a new tab");
  });
  it("opens a new window with no live iterm session", () => {
    expect(gridHint([])).toBe("Opens in a new iTerm2 window");
    expect(gridHint([sess("v", { host: "vscode" })])).toBe("Opens in a new iTerm2 window");
  });
});
