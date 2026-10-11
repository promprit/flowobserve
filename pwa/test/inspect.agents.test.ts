import { beforeEach, expect, it, vi } from "vitest";
import { bindInput } from "../src/input";
import { pager } from "../src/pager";
import { hooks, store, ui, view } from "../src/state";
import { bindInspect, closeInspect, INSPECT } from "../src/ui/inspect";
import { T0, agent, loadDom, reset, sess } from "./helpers";

const ptr = (type: string, x: number, y: number) => {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, buttons: type === "pointerdown" ? 1 : 0 });
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
  document.querySelector("#loop")!.dispatchEvent(e);
};
const pop = () => document.querySelector<HTMLElement>("#inspect")!;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(T0); vi.restoreAllMocks(); reset(); closeInspect(); loadDom(); bindInspect(); bindInput();
  store.sessions.set("a", sess("a", { stage: 3, agents: [agent("e1"), agent("e2")] }, 0));
  store.sessions.set("b", sess("b", { stage: 3, agents: [agent("z9")] }, 1));
  pager.focus = "a"; view.zt = 1;
  hooks.pick = (x) => (x < 50 ? { sessionId: "a", nodeKey: null, agentId: "e1" } : x < 100 ? { sessionId: "b", nodeKey: null, agentId: "z9" } : { sessionId: "a", nodeKey: null });
  hooks.nodeScreen = () => ({ x: 200, y: 200, r: 10 });
});

it("hovering an orb selects it after the 120 ms intent; no popover opens", () => {
  ptr("pointermove", 10, 10);
  vi.advanceTimersByTime(INSPECT.intentMs - 1);
  expect(ui.agentSel).toBeNull();
  vi.advanceTimersByTime(1);
  expect(ui.agentSel).toMatchObject({ sid: "a", aid: "e1" });
  expect(pop().hidden).toBe(true);
});

it("hovering the selected orb again never toggles it off", () => {
  ptr("pointermove", 10, 10); vi.advanceTimersByTime(INSPECT.intentMs);
  ptr("pointermove", 12, 12); vi.advanceTimersByTime(500);
  expect(ui.agentSel?.aid).toBe("e1");
});

it("a tap on an orb toggles its selection", () => {
  expect(hooks.inspectAt(10, 10)).toBe(true);
  expect(ui.agentSel?.aid).toBe("e1");
  expect(hooks.inspectAt(10, 10)).toBe(true);
  expect(ui.agentSel).toBeNull();
});

it("a tap on an orb in the focused view never zooms out", () => {
  ptr("pointerdown", 10, 10); ptr("pointerup", 10, 10);
  expect(view.zt).toBe(1);
  expect(ui.agentSel?.aid).toBe("e1");
});

it("an orb of a session that is not focused is ignored", () => {
  expect(hooks.inspectAt(60, 10)).toBe(false);
  expect(ui.agentSel).toBeNull();
});
