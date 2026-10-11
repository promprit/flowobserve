import { beforeEach, expect, it, vi } from "vitest";
import type { WireNode } from "@fo/shared";
import { bindInput } from "../src/input";
import { pager, pagerTick } from "../src/pager";
import { hooks, store, ui, view } from "../src/state";
import { bindInspect, closeInspect, INSPECT, inspectState, openInspect, tickInspect } from "../src/ui/inspect";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

const N = (p: Partial<WireNode> & Pick<WireNode, "key" | "state">): WireNode => ({ model: null, startedAt: null, task: null, waiting: null, ...p });
const pop = () => document.querySelector<HTMLElement>("#inspect")!;
const move = (x: number, y: number) => {
  const e = new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true });
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
  document.querySelector("#loop")!.dispatchEvent(e);
};
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(T0); vi.restoreAllMocks(); reset(); closeInspect(); loadDom(); bindInspect(); bindInput();
  store.sessions.set("a", sess("a", {
    stage: 3, builders: ["working", "done", "idle"], openUrl: "vscode://file/a",
    nodes: [N({ key: "b0", state: "working", model: "sonnet", startedAt: T0 - 252_000 }), N({ key: "b1", state: "done" })],
    log: ["one", "two", "three", "four"].map((text, i) => ({ t: T0 + i, text })),
  }, 0));
  store.sessions.set("b", sess("b", {}, 1));
  pager.focus = "a"; view.zt = 1;
  hooks.pick = (x) => (x < 50 ? { sessionId: "a", nodeKey: "b0" } : x < 100 ? { sessionId: "a", nodeKey: "plan" } : { sessionId: "a", nodeKey: null });
  hooks.nodeScreen = () => ({ x: 200, y: 200, r: 10 });
});

it("hover opens after the 120 ms intent with the node's detail", () => {
  move(10, 10);
  vi.advanceTimersByTime(INSPECT.intentMs - 1);
  expect(pop().hidden).toBe(true);
  vi.advanceTimersByTime(1);
  expect(pop().hidden).toBe(false);
  expect(ui.inspecting).toBe(true);
  expect(pop().textContent).toContain("Sonnet · working · 4m 12s");
  expect(pop().textContent).toContain("four");
  expect(pop().textContent).not.toContain("one");
  expect(pop().getAttribute("role")).toBe("dialog");
});

it("a node with nothing to say opens nothing", () => {
  move(60, 10); vi.advanceTimersByTime(500);
  expect(pop().hidden).toBe(true);
});

it("closes 200 ms after the pointer leaves node and popover; entering the popover keeps it", () => {
  move(10, 10); vi.advanceTimersByTime(INSPECT.intentMs);
  move(300, 10);
  pop().dispatchEvent(new MouseEvent("pointerenter"));
  vi.advanceTimersByTime(1000);
  expect(pop().hidden).toBe(false);
  pop().dispatchEvent(new MouseEvent("pointerleave"));
  vi.advanceTimersByTime(INSPECT.leaveMs);
  expect(pop().hidden).toBe(true);
});

it("Escape closes it, returns focus to the loop, and pins the pager for INSPECT.pinMs", () => {
  openInspect("a", "b0");
  key("Escape");
  expect(pop().hidden).toBe(true);
  expect(document.activeElement).toBe(document.querySelector("#loop"));
  expect(pager.pinUntil).toBeGreaterThanOrEqual(T0 + INSPECT.pinMs);
  expect(view.zt).toBe(1); // the Escape closed the popover, not the zoom
});

it("the return to the overview waits while it is open", () => {
  openInspect("a", "b0");
  pager.pinUntil = 0;
  pagerTick();
  expect([pager.focus, view.zt]).toEqual(["a", 1]);
});

it("closes quietly when the session leaves or the pager pages away", () => {
  openInspect("a", "b0");
  store.sessions.delete("a");
  expect(() => tickInspect()).not.toThrow();
  expect(inspectState()).toBeNull();
  store.sessions.set("a", sess("a", { nodes: [N({ key: "b0", state: "working" })] }, 0));
  openInspect("a", "b0");
  pager.focus = "b";
  tickInspect();
  expect(inspectState()).toBeNull();
});

it("tap inspects via inspectAt; tapping empty space closes", () => {
  hooks.inspectAt(10, 10);
  expect(inspectState()).toEqual({ id: "a", key: "b0" });
  hooks.inspectAt(400, 10);
  expect(inspectState()).toBeNull();
});

it("Tab cycles the focused loop's nodes; past the last it lets focus leave", () => {
  const loop = document.querySelector<HTMLElement>("#loop")!;
  loop.focus();
  key("Tab", {}, loop);
  expect(inspectState()?.key).toBe("b0");
  key("Tab", {}, loop);
  expect(inspectState()?.key).toBe("b1");
  key("Tab", {}, loop);
  expect(inspectState()).toBeNull();
});

it("Open carries only the vscode link; F focuses (pins) the session", () => {
  openInspect("a", "b0");
  const a = pop().querySelector<HTMLAnchorElement>("a.open")!;
  expect(a.hidden).toBe(false);
  expect(a.getAttribute("href")).toBe("vscode://file/a");
  const go = vi.spyOn(nav, "go").mockImplementation(() => {});
  a.click();
  expect(go).toHaveBeenCalledWith("vscode://file/a");
  key("f");
  expect(inspectState()).toBeNull();
  expect(pager.focus).toBe("a");
  expect(pager.pinUntil).toBeGreaterThan(T0 + INSPECT.pinMs); // manual() pins for RESUME (120 s)
  store.sessions.get("a")!.openUrl = "javascript:alert(1)";
  openInspect("a", "b0");
  expect(pop().querySelector<HTMLAnchorElement>("a.open")!.hidden).toBe(true);
});

const loopEl = () => document.querySelector<HTMLElement>("#loop")!;
const mouse = (type: string, target: EventTarget = loopEl()) => {
  const e = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  target.dispatchEvent(e);
};

it("loop pointerleave closes", () => {
  move(10, 10); vi.advanceTimersByTime(INSPECT.intentMs);
  expect(pop().hidden).toBe(false);
  mouse("pointerleave");
  vi.advanceTimersByTime(INSPECT.leaveMs);
  expect(pop().hidden).toBe(true);
});

it("auto-close leaves focus alone when it is outside the loop and popover", () => {
  const b = document.createElement("button"); document.body.append(b); b.focus();
  openInspect("a", "b0");
  closeInspect();
  expect(document.activeElement).toBe(b);
  openInspect("a", "b0"); pop().querySelector<HTMLElement>("button.focus")!.focus();
  closeInspect();
  expect(document.activeElement).toBe(loopEl());
});

it("F is ignored while typing, and prevents default when it acts", () => {
  openInspect("a", "b0");
  const inp = document.createElement("input"); document.body.append(inp);
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(inspectState()).not.toBeNull();
  const e = new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(inspectState()).toBeNull();
});

it("the live region holds only the node's lines; the ticking run time is outside it", () => {
  openInspect("a", "b0");
  const live = pop().querySelector(".body")!;
  expect(live.getAttribute("aria-live")).toBe("off");
  expect(pop().getAttribute("aria-live")).not.toBe("polite");
});

it("a stale row class is repainted when the text is unchanged", () => {
  openInspect("a", "b0");
  const row = () => pop().querySelector<HTMLElement>(".body > div")!;
  const good = row().className, text = row().textContent;
  expect(good).toBe("head");
  row().className = "stale"; // same text, wrong class
  tickInspect();
  expect(row().textContent).toBe(text);
  expect(row().className).toBe(good);
  expect(row().className).not.toBe("stale");
});

it("pointerdown outside popover and loop closes it; inside loop does not", () => {
  openInspect("a", "b0");
  loopEl().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(inspectState()).not.toBeNull();
  pop().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(inspectState()).not.toBeNull();
  document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(inspectState()).toBeNull();
});

it("cursor: default in focus view, zoom-in kept for overview", () => {
  view.zt = 1; tickInspect();
  expect(loopEl().dataset.view).toBe("focus");
  view.zt = 0; tickInspect();
  expect(loopEl().dataset.view).toBe("overview");
});
