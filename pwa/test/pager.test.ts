import { beforeEach, expect, it, vi } from "vitest";
import { HOVER, RESUME } from "../src/config";
import { celebrate, hoverEnter, hoverLeave, manual, overview, pager, pagerTick } from "../src/pager";
import { store, view } from "../src/state";
import { setS } from "../src/store";
import { T0, reset, sess } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); });
const add = (...ids: string[]) => ids.forEach((id, i) => store.sessions.set(id, sess(id, {}, i)));
const get = (id: string) => store.sessions.get(id)!;

it("rest view is the overview: with no pin the camera pulls back to every loop", () => {
  add("a", "b");
  pagerTick();
  expect(view.zt).toBe(0);
  expect(pager.focus).toBe("a");
});

it("attention never moves the camera: it only marks the session unseen", () => {
  add("a", "b", "c");
  pagerTick();
  setS(get("b"), { status: "waiting" });
  setS(get("c"), { status: "deny" });
  pagerTick();
  expect([pager.focus, view.zt]).toEqual(["a", 0]);
  expect([get("b").seen, get("c").seen]).toEqual([false, false]);
});

it("shipped celebrates in place without moving the camera", () => {
  add("a", "b");
  pagerTick();
  setS(get("b"), { status: "shipped" });
  expect(celebrate.id).toBe("b");
  expect([pager.focus, view.zt]).toEqual(["a", 0]);
});

it("no auto-cycle: focus stays put however long nothing happens", () => {
  add("a", "b", "c");
  pagerTick();
  for (let k = 0; k < 10; k++) { vi.advanceTimersByTime(30_000); pagerTick(); }
  expect(pager.focus).toBe("a");
});

it("a card click zooms to that loop, marks it seen, holds for RESUME, then returns to the overview", () => {
  add("a", "b");
  setS(get("b"), { status: "waiting" });
  manual("b");
  expect([pager.focus, view.zt, get("b").seen]).toEqual(["b", 1, true]);
  vi.advanceTimersByTime(RESUME - 1000);
  pagerTick();
  expect(view.zt).toBe(1);
  vi.advanceTimersByTime(2000);
  pagerTick();
  expect([pager.focus, view.zt]).toEqual(["b", 0]);
});

it("hover previews a loop after a short delay, and leaving returns to the overview", () => {
  add("a", "b");
  pagerTick();
  setS(get("b"), { status: "waiting" });
  hoverEnter("b");
  vi.advanceTimersByTime(HOVER.inMs - 50);
  expect([pager.focus, view.zt]).toEqual(["a", 0]);
  vi.advanceTimersByTime(100);
  expect([pager.focus, view.zt, get("b").seen]).toEqual(["b", 1, true]);
  vi.advanceTimersByTime(RESUME + 1000);
  pagerTick();
  expect(view.zt).toBe(1); // still hovering: no timeout
  hoverLeave();
  vi.advanceTimersByTime(HOVER.outMs - 50);
  expect(view.zt).toBe(1);
  vi.advanceTimersByTime(100);
  expect(view.zt).toBe(0);
});

it("sweeping across cards: a quick pass never moves the camera, moving on to another card cancels the return", () => {
  add("a", "b", "c");
  pagerTick();
  hoverEnter("b"); vi.advanceTimersByTime(100); hoverLeave(); vi.advanceTimersByTime(HOVER.outMs + 100);
  expect([pager.focus, view.zt]).toEqual(["a", 0]);
  hoverEnter("b"); vi.advanceTimersByTime(HOVER.inMs + 10);
  hoverLeave(); vi.advanceTimersByTime(200);
  hoverEnter("c"); vi.advanceTimersByTime(HOVER.inMs + 10);
  vi.advanceTimersByTime(HOVER.outMs);
  expect([pager.focus, view.zt]).toEqual(["c", 1]);
});

it("leaving a hover while a click pin is active returns to the pinned loop", () => {
  add("a", "b", "c");
  manual("b");
  hoverEnter("c"); vi.advanceTimersByTime(HOVER.inMs + 10);
  expect(pager.focus).toBe("c");
  hoverLeave(); vi.advanceTimersByTime(HOVER.outMs + 10);
  expect([pager.focus, view.zt]).toEqual(["b", 1]);
});

it("a manual page flip moves neither the focus nor the camera", async () => {
  const { setCardPage, cpage } = await import("../src/ui/cards");
  add("a", "b");
  pagerTick();
  cpage.list = [{ groups: [{ key: "k1", name: "a", sessions: [{ id: "a" }] }] }, { groups: [{ key: "k2", name: "b", sessions: [{ id: "b" }] }] }];
  setCardPage(1);
  expect([cpage.i, pager.focus, view.zt]).toEqual([1, "a", 0]);
});

it("a hovered session that ends un-sticks the hover, so the camera can return to the overview", () => {
  add("a", "b");
  pagerTick();
  hoverEnter("b"); vi.advanceTimersByTime(HOVER.inMs + 10);
  expect(pager.hover).toBe("b");
  store.sessions.delete("b");
  pagerTick();
  expect([pager.hover, view.zt]).toEqual([null, 0]);
});

it("a session that ends during the hover dwell is never previewed", () => {
  add("a", "b");
  pagerTick();
  hoverEnter("b"); store.sessions.delete("b"); vi.advanceTimersByTime(HOVER.inMs + 10);
  expect([pager.hover, pager.focus, view.zt]).toEqual([null, "a", 0]);
});

it("flipping the card page under a hover ends the preview (the hovered card left the DOM)", async () => {
  const { setCardPage, cpage } = await import("../src/ui/cards");
  add("a", "b");
  pagerTick();
  cpage.list = [{ groups: [{ key: "k1", name: "a", sessions: [{ id: "a" }] }] }, { groups: [{ key: "k2", name: "b", sessions: [{ id: "b" }] }] }];
  hoverEnter("a"); vi.advanceTimersByTime(HOVER.inMs + 10);
  setCardPage(1); vi.advanceTimersByTime(HOVER.outMs + 10);
  expect([pager.hover, view.zt]).toEqual([null, 0]);
});

it("Esc/- (overview) drops the click pin: a later hover leave returns to the overview, not the old loop", () => {
  add("a", "b", "c");
  manual("b");
  overview();
  expect([pager.pinned, view.zt]).toEqual([null, 0]);
  hoverEnter("c"); vi.advanceTimersByTime(HOVER.inMs + 10);
  hoverLeave(); vi.advanceTimersByTime(HOVER.outMs + 10);
  expect(view.zt).toBe(0);
});

it("hover leave after the click pin expired returns to the overview", () => {
  add("a", "b", "c");
  manual("b");
  hoverEnter("c"); vi.advanceTimersByTime(HOVER.inMs + 10);
  vi.advanceTimersByTime(RESUME);
  hoverLeave(); vi.advanceTimersByTime(HOVER.outMs + 10);
  expect(view.zt).toBe(0);
});
