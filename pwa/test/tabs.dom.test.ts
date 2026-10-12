import { beforeEach, describe, expect, it, vi } from "vitest";
import { pager, pagerTick, step } from "../src/pager";
import { store, ui, view } from "../src/state";
import { bindCards, cpage, renderCards } from "../src/ui/cards";
import { bindInput } from "../src/input";
import { SWIPE } from "../src/config";
import { bindTabs, renderTabs, selectTabAt } from "../src/ui/tabs";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

const add = (id: string, name: string, dt: number) =>
  store.sessions.set(id, sess(id, { name, openUrl: `vscode://file/${name}`, startedAt: T0 + dt }, dt));
const tabs = () => [...document.querySelectorAll<HTMLElement>("#tabs .tab")];
const text = (t: HTMLElement) => t.querySelector(".nm")!.textContent + (t.querySelector(".no") ? " " + t.querySelector(".no")!.textContent : "");
const tab = (id: string) => [...document.querySelectorAll<HTMLElement>("#tabs .tab")].find((t) => t.dataset.id === id)!;
const waiting = (id: string) => Object.assign(store.sessions.get(id)!, { status: "waiting", action: "APPROVE PLAN" });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); ui.reduce = true; bindCards(); bindTabs(); });

describe("portrait tabs", () => {
  beforeEach(() => {
    document.body.className = "portrait"; ui.portrait = true;
    add("f1", "flowobserve", 0); add("f2", "flowobserve", 10); add("b1", "meadow", 5);
    pagerTick(); renderCards();
  });
  it("one tab per session with running numbers; current is on", () => {
    expect(tabs().map(text)).toEqual(["flowobserve 1", "flowobserve 2", "meadow"]);
    expect(document.querySelector("#tabs .tab.on")!.getAttribute("data-id")).toBe(pager.focus);
    expect(document.querySelector("#tabs .tab.on")!.getAttribute("aria-selected")).toBe("true");
  });
  it("clicking a tab selects that session without zooming", () => {
    view.zt = 0;
    tab("b1").click();
    expect(pager.focus).toBe("b1");
    expect(view.zt).toBe(0);
    expect(document.querySelector("#cards .card")!.getAttribute("data-id")).toBe("b1");
  });
  it("need: a NEEDS status and an RC takeover both mark the tab", () => {
    waiting("f2"); store.sessions.get("b1")!.rc = { takenOverAt: T0 }; renderCards();
    expect(tab("f2").classList.contains("need")).toBe(true);
    expect(tab("b1").classList.contains("need")).toBe(true);
    expect(tab("f1").classList.contains("need")).toBe(false);
  });
  it("current session ends: renumber, selection moves to the neighbour by id", () => {
    pager.focus = "f1"; pagerTick(); store.sessions.delete("f1"); pagerTick(); renderCards();
    expect(tabs().map(text)).toEqual(["flowobserve", "meadow"]);
    expect(pager.focus).toBe("f2");
    expect(tab("f2").classList.contains("on")).toBe(true);
  });
  it("arrow step still walks session order and moves the on tab", () => {
    pager.focus = "f1"; step(1); renderCards();
    expect(tab("f2").classList.contains("on")).toBe(true);
  });
  it("OPEN IN VS CODE opens the current tab's project", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    pager.focus = "b1"; renderCards();
    document.querySelector<HTMLElement>("#tabs .open")!.click();
    expect(go).toHaveBeenCalledWith("vscode://file/meadow");
  });
  it("offline: a tab still selects, the open link does nothing", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    store.link = "offline"; renderCards();
    tab("b1").click(); expect(pager.focus).toBe("b1");
    document.querySelector<HTMLElement>("#tabs .open")!.click();
    expect(go).not.toHaveBeenCalled();
  });
  it("a project name with markup renders as text", () => {
    add("x1", "<b>x</b>", 20); pagerTick(); renderCards();
    expect(tab("x1").querySelector(".nm")!.textContent).toBe("<b>x</b>");
    expect(tab("x1").querySelector("b")).toBeNull();
  });
  it("no dots, no project header", () => {
    expect(document.querySelector("#dots")).toBeNull();
    expect(document.querySelector(".gh")).toBeNull();
  });
});

describe("landscape tabs", () => {
  beforeEach(() => {
    document.body.className = "landscape"; ui.portrait = false;
    add("f1", "flowobserve", 0); add("f2", "flowobserve", 10); add("b1", "meadow", 5);
    pager.focus = "f2"; renderCards();
  });
  it("one tab per project, no numbers; the shown project is on", () => {
    expect(tabs().map(text)).toEqual(["flowobserve", "meadow"]);
    expect(document.querySelectorAll("#cards .group")).toHaveLength(1);
    expect(document.querySelectorAll("#cards .card")).toHaveLength(2);
    expect(tab("vscode://file/flowobserve").classList.contains("on")).toBe(true);
  });
  it("clicking a tab shows that project and focuses its first card by start", () => {
    tab("vscode://file/meadow").click();
    expect(cpage.i).toBe(1);
    expect(pager.focus).toBe("b1");
    expect(document.querySelector("#cards .group")!.getAttribute("data-name")).toBe("meadow");
  });
  it("a focus change by arrow key moves the shown tab, and a re-render keeps it", () => {
    tab("vscode://file/flowobserve").click();
    pager.focus = "b1"; renderCards(); renderCards();
    expect(tab("vscode://file/meadow").classList.contains("on")).toBe(true);
  });
  const wheel = (n: number, dy = 100) => { for (let k = 0; k < n; k++) document.querySelector("#cards")!.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, cancelable: true })); };
  it("wheel over the cards steps tabs and focuses that project's first card", () => {
    pager.focus = "f1"; renderCards();
    wheel(2);
    expect(cpage.i).toBe(1);
    expect(pager.focus).toBe("b1");
  });
  it("a wheel burst steps exactly one tab; a new burst after the quiet gap steps again", () => {
    add("c1", "cat", 30); renderCards();
    pager.focus = "f1"; renderCards();
    wheel(5); expect(cpage.i).toBe(1);
    vi.setSystemTime(T0 + SWIPE.quietMs + 10); wheel(5); expect(cpage.i).toBe(2);
  });
  const dock = (top: number) => {
    const c = document.querySelector<HTMLElement>("#cards")!; c.classList.add("scroll");
    Object.defineProperty(c, "scrollTop", { value: top, configurable: true, writable: true });
    Object.defineProperty(c, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(c, "scrollHeight", { value: 400, configurable: true });
    return c;
  };
  it("a scrolling dock with room left scrolls natively: no tab step", () => {
    add("c1", "cat", 30); pager.focus = "f1"; renderCards(); dock(50);
    wheel(5);
    expect(cpage.i).toBe(0);
  });
  it("a gesture that scrolls the dock to its end does not then flip the tab", () => {
    add("c1", "cat", 30); pager.focus = "f1"; renderCards(); const c = dock(50);
    wheel(2);
    (c as unknown as { scrollTop: number }).scrollTop = 300; // now at the end
    vi.setSystemTime(T0 + 100); wheel(5);
    expect(cpage.i).toBe(0);
    vi.setSystemTime(T0 + 100 + SWIPE.quietMs + 10); wheel(5);
    expect(cpage.i).toBe(1);
  });
  it("line-mode wheel deltas are normalised", () => {
    pager.focus = "f1"; renderCards();
    document.querySelector("#cards")!.dispatchEvent(new WheelEvent("wheel", { deltaY: 4, deltaMode: 1, cancelable: true }));
    expect(cpage.i).toBe(1);
  });
  it("clicking the shown project's tab keeps the focused session", () => {
    pager.focus = "f2"; renderCards();
    tab("vscode://file/flowobserve").click();
    expect(pager.focus).toBe("f2");
  });
  it("aria-label names the strip by mode", () => {
    expect(document.querySelector("#tabs")!.getAttribute("aria-label")).toBe("Projects");
  });
  it("need marks the project tab", () => {
    waiting("f2"); renderCards();
    expect(tab("vscode://file/flowobserve").classList.contains("need")).toBe(true);
  });
  it("no page dots, no PAGE x OF y line", () => {
    expect(document.querySelector("#foot .pg")).toBeNull();
    expect(document.querySelector("#pgnext")).toBeNull();
  });
});

describe("tab strip keyboard", () => {
  beforeEach(() => {
    bindInput();
    document.body.className = "portrait"; ui.portrait = true;
    add("f1", "flowobserve", 0); add("b1", "meadow", 5);
    pagerTick(); pager.focus = "f1"; renderCards();
  });
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  it("Enter on a focused tab does not jump the previous session", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    tab("b1").focus(); key(tab("b1"), "Enter");
    expect(go).not.toHaveBeenCalled();
  });
  it("Enter on OPEN opens once with the project url", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    key(document.querySelector("#tabs .open")!, "Enter");
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith("vscode://file/flowobserve");
  });
  it("Space on OPEN opens and is prevented", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    document.querySelector("#tabs .open")!.dispatchEvent(e);
    expect(go).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });
  it("aria-label is Sessions in portrait, on the strip and the tablist", () => {
    expect(document.querySelector("#tabs")!.getAttribute("aria-label")).toBe("Sessions");
    expect(document.querySelector("#tabs .tl")!.getAttribute("aria-label")).toBe("Sessions");
  });
  it("focus on the current tab follows it when an arrow key steps", () => {
    tab("f1").focus(); step(1); renderCards();
    expect(tab("b1").classList.contains("on")).toBe(true);
    expect(document.activeElement).toBe(tab("b1"));
  });
  it("keyboard focus survives the repaint a click causes; only the current tab is tabbable", () => {
    tab("b1").focus(); tab("b1").click();
    expect(document.activeElement).toBe(tab("b1"));
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0]);
  });
  it("a changed strip width re-scrolls the current tab into view", () => {
    const sv = vi.fn(); Element.prototype.scrollIntoView = sv;
    const tl = document.querySelector<HTMLElement>("#tabs .tl")!;
    Object.defineProperty(tl, "clientWidth", { value: 300, configurable: true });
    renderCards(); const n0 = sv.mock.calls.length;
    Object.defineProperty(tl, "clientWidth", { value: 500, configurable: true });
    renderCards();
    expect(sv.mock.calls.length).toBe(n0 + 1);
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("empty", () => {
  it("no sessions: strip hidden", () => {
    renderCards();
    expect(tabs()).toHaveLength(0);
    expect(document.querySelector<HTMLElement>("#tabs")!.hidden).toBe(true);
  });
});

describe("selectTabAt (⌘1–⌘9)", () => {
  const portrait = (n: number) => {
    document.body.className = "portrait"; ui.portrait = true;
    for (let i = 0; i < n; i++) add("s" + i, "p" + i, i * 10);
    pagerTick(); renderCards();
  };
  it("selects the nth portrait tab; a missing one returns false and changes nothing", () => {
    portrait(3);
    expect(selectTabAt(2)).toBe(true);
    expect(pager.focus).toBe("s1");
    expect(selectTabAt(1)).toBe(true);
    expect(pager.focus).toBe("s0");
    expect(selectTabAt(5)).toBe(false);
    expect(pager.focus).toBe("s0");
  });
  it("9 selects the last tab when there are more than nine", () => {
    portrait(12);
    expect(selectTabAt(9)).toBe(true);
    expect(pager.focus).toBe("s11");
  });
  it("landscape: selects the nth project", () => {
    document.body.className = "landscape"; ui.portrait = false;
    add("f1", "flowobserve", 0); add("b1", "meadow", 5); pager.focus = "f1"; renderCards();
    expect(selectTabAt(2)).toBe(true);
    expect(cpage.i).toBe(1);
    expect(pager.focus).toBe("b1");
  });
  it("tabs 1-9 carry aria-keyshortcuts, a badge and a title hint; the 10th has none", () => {
    portrait(10);
    const t = tabs();
    expect(t.slice(0, 9).map((b) => b.getAttribute("aria-keyshortcuts"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => "Meta+" + n));
    expect(t[9].hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(t[9].querySelector(".kb")).toBeNull();
    expect(t[0].title.endsWith(" · ⌘1")).toBe(true);
    expect(t[0].querySelector(".kb")!.textContent).toBe("⌘1");
  });
  it("shown follows the latest tabs even when the strip skips re-render", () => {
    portrait(2);
    expect(selectTabAt(2)).toBe(true);
    store.sessions.delete("s1"); pagerTick(); renderCards();
    expect(selectTabAt(2)).toBe(false);
  });
});
