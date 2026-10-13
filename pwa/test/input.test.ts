import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindInput } from "../src/input";
import { pager } from "../src/pager";
import { hooks, store, ui, view } from "../src/state";
import { orbit, resetOrbit } from "../src/scene/orbit";
import { bindCards, renderCards } from "../src/ui/cards";
import { bindTabs } from "../src/ui/tabs";
import { pagerTick } from "../src/pager";
import { drawerOpen, openDrawer } from "../src/ui/drawer";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); loadDom(); });
const key = (k: string) => dispatchEvent(new KeyboardEvent("keydown", { key: k }));

it("arrows page through sessions; Escape closes the drawer before zooming out", async () => {
  bindInput();
  store.sessions.set("a", sess("a", {}, 0));
  store.sessions.set("b", sess("b", {}, 1));
  pager.focus = "a";
  key("ArrowRight");
  expect(pager.focus).toBe("b");
  await openDrawer("today");
  key("Escape");
  expect(drawerOpen()).toBe(false);
  expect(view.zt).toBe(1);
  key("Escape");
  expect(view.zt).toBe(0);
});

it("demo keys reach the simulator only in demo mode", () => {
  const sim = { key: vi.fn(() => true) };
  bindInput(sim);
  key("4");
  expect(sim.key).not.toHaveBeenCalled();
  store.demo = true;
  key("4");
  expect(sim.key).toHaveBeenCalledWith("4");
});

describe("Enter and the open link", () => {
  const press = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
  beforeEach(() => { vi.restoreAllMocks(); });

  it("Enter never navigates to a non-vscode URL", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    bindInput();
    store.sessions.set("a", sess("a", { openUrl: "javascript:alert(1)" }, 0));
    pager.focus = "a";
    press("Enter");
    expect(go).not.toHaveBeenCalled();
    store.sessions.get("a")!.openUrl = "vscode://file/Users/p/app";
    press("Enter");
    expect(go).toHaveBeenCalledWith("vscode://file/Users/p/app");
  });

  it("ignores modified keys, and Enter on the usage meter or inside the drawer", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    bindInput();
    store.sessions.set("a", sess("a", { openUrl: "vscode://file/a" }, 0));
    store.sessions.set("b", sess("b", {}, 1));
    pager.focus = "a";
    press("Enter", { metaKey: true });
    press("Enter", { ctrlKey: true });
    press("Enter", { altKey: true });
    press("Enter", {}, document.querySelector("#usage")!);
    const d = document.querySelector("#drawer")!;
    d.innerHTML = "<button>x</button>";
    press("Enter", {}, d.querySelector("button")!);
    expect(go).not.toHaveBeenCalled();
    press("ArrowRight", { metaKey: true });
    expect(pager.focus).toBe("a");
    press("-", { ctrlKey: true });
    expect(view.zt).toBe(1);
    view.zt = 0;
    press("+", { altKey: true });
    expect(view.zt).toBe(0);
  });
});

it("a wheel pick zooms to the loop under the pointer and leaves other attention unseen", async () => {
  vi.resetModules();
  const { bindInput: bind } = await import("../src/input");
  const P = await import("../src/pager");
  const S = await import("../src/state");
  const { sess: mk } = await import("./helpers");
  bind();
  S.store.sessions.set("a", mk("a", { status: "waiting" }, 0));
  S.store.sessions.set("b", mk("b", { status: "waiting" }, 1));
  S.store.sessions.set("c", mk("c", {}, 2));
  Object.assign(P.pager, { focus: "a" });
  S.hooks.pick = () => ({ sessionId: "c", nodeKey: null });
  document.querySelector("#loop")!.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 5, clientY: 5, cancelable: true }));
  expect(P.pager.focus).toBe("c");
  expect(S.store.sessions.get("b")!.seen).toBe(false);
});

const ptr = (type: string, x: number, y: number, id = 1, pointerType = "mouse", buttons = type === "pointerup" ? 0 : 1) => {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, buttons });
  Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: pointerType } });
  document.querySelector("#loop")!.dispatchEvent(e);
};
const three = () => { for (const [id, o] of [["a", 0], ["b", 1], ["c", 2]] as const) store.sessions.set(id, sess(id, {}, o)); pager.focus = "a"; };

describe("gestures", () => {
  beforeEach(() => {
    resetOrbit(); vi.restoreAllMocks();
    hooks.pick = () => null; hooks.inspectAt = () => true; hooks.inspectClose = () => false;
  });

  it("a tap with 4 px of jitter inspects; a 5 px move orbits and never inspects", () => {
    bindInput();
    const at = vi.fn(); hooks.inspectAt = at;
    ptr("pointerdown", 100, 100); ptr("pointermove", 103, 102); ptr("pointerup", 103, 102);
    expect(at).toHaveBeenCalledTimes(1);
    expect(orbit.yaw).toBe(0);
    ptr("pointerdown", 100, 100); ptr("pointermove", 105, 100); ptr("pointermove", 160, 100); ptr("pointerup", 160, 100);
    expect(at).toHaveBeenCalledTimes(1);
    expect(orbit.yaw).toBeLessThan(0);
    expect(orbit.dragging).toBe(false);
  });

  it("a tap on empty space in the focused view, with no popover to close, returns to the overview", () => {
    bindInput();
    view.zt = 1;
    hooks.inspectAt = () => false;
    ptr("pointerdown", 100, 100); ptr("pointerup", 100, 100);
    expect(view.zt).toBe(0);
  });

  it("a drag that starts closes an open popover", () => {
    bindInput();
    const close = vi.fn(() => true); hooks.inspectClose = close;
    ptr("pointerdown", 100, 100); ptr("pointermove", 120, 100);
    expect(close).toHaveBeenCalled();
    ptr("pointerup", 120, 100);
  });

  it("mouse drag released outside: a buttons=0 move ends the drag, touch is untouched, blur clears", () => {
    bindInput();
    ptr("pointerdown", 100, 100); ptr("pointermove", 120, 100); ptr("pointermove", 140, 100);
    expect(orbit.dragging).toBe(true);
    const yaw = orbit.yaw;
    ptr("pointermove", 200, 100, 1, "mouse", 0);
    expect(orbit.dragging).toBe(false);
    expect(orbit.yaw).toBe(yaw);
    ptr("pointermove", 260, 100);
    expect(orbit.yaw).toBe(yaw);
    ptr("pointerdown", 100, 100, 2, "touch", 0); ptr("pointermove", 120, 100, 2, "touch", 0); ptr("pointermove", 140, 100, 2, "touch", 0);
    expect(orbit.dragging).toBe(true);
    dispatchEvent(new Event("blur"));
    expect(orbit.dragging).toBe(false);
  });

  it("lostpointercapture ends the drag", () => {
    bindInput();
    ptr("pointerdown", 100, 100); ptr("pointermove", 140, 100);
    expect(orbit.dragging).toBe(true);
    ptr("lostpointercapture", 140, 100);
    expect(orbit.dragging).toBe(false);
  });

  it("Enter inside the popover does not also open VS Code; F is ignored once handled", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    const sim = { key: vi.fn(() => true) };
    bindInput(sim); store.demo = true;
    store.sessions.set("a", sess("a", { openUrl: "vscode://file/a" }, 0)); pager.focus = "a";
    const btn = document.querySelector("#inspect button.focus")!;
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(go).not.toHaveBeenCalled();
    const e = new KeyboardEvent("keydown", { key: "f", cancelable: true }); e.preventDefault(); dispatchEvent(e);
    expect(sim.key).not.toHaveBeenCalled();
  });

  it("a click in overview focuses the picked loop", () => {
    bindInput(); three(); view.zt = 0;
    hooks.pick = () => ({ sessionId: "b", nodeKey: null });
    ptr("pointerdown", 50, 50); ptr("pointerup", 50, 50);
    expect(pager.focus).toBe("b");
    expect(view.zt).toBe(1);
  });

  it("a two-finger horizontal swipe pages once and does not zoom", () => {
    bindInput(); three();
    ptr("pointerdown", 300, 200, 1, "touch"); ptr("pointerdown", 360, 200, 2, "touch");
    for (let d = 10; d <= 150; d += 10) { ptr("pointermove", 300 - d, 200, 1, "touch"); ptr("pointermove", 360 - d, 200, 2, "touch"); }
    ptr("pointerup", 150, 200, 1, "touch"); ptr("pointerup", 210, 200, 2, "touch");
    expect(pager.focus).toBe("b");
    expect(view.zt).toBe(1);
    expect(orbit.yaw).toBe(0);
  });

  it("two-finger jitter below the lock threshold neither zooms nor pages", () => {
    bindInput(); three(); view.zt = 0.8;
    ptr("pointerdown", 300, 200, 1, "touch"); ptr("pointerdown", 400, 200, 2, "touch");
    for (const [a, b] of [[3, -2], [-4, 5], [6, 1], [-5, -6], [4, 3]]) {
      ptr("pointermove", 300 + a, 200 + b, 1, "touch"); ptr("pointermove", 400 - b, 200 + a, 2, "touch");
    }
    ptr("pointerup", 300, 200, 1, "touch"); ptr("pointerup", 400, 200, 2, "touch");
    expect(view.zt).toBe(0.8);
    expect(pager.focus).toBe("a");
    expect(orbit.yaw).toBe(0);
  });

  it("a two-finger pinch zooms out and does not page", () => {
    bindInput(); three();
    ptr("pointerdown", 200, 200, 1, "touch"); ptr("pointerdown", 400, 200, 2, "touch");
    for (let d = 10; d <= 80; d += 10) { ptr("pointermove", 200 + d, 200, 1, "touch"); ptr("pointermove", 400 - d, 200, 2, "touch"); }
    ptr("pointerup", 280, 200, 1, "touch"); ptr("pointerup", 320, 200, 2, "touch");
    expect(view.zt).toBeLessThan(1);
    expect(pager.focus).toBe("a");
  });

  describe("trackpad", () => {
    let t = T0;
    const wheel = (dx: number, dy: number, gapMs = 16, init: WheelEventInit = {}) => {
      t += gapMs; vi.setSystemTime(t);
      document.querySelector("#loop")!.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy, cancelable: true, ...init }));
    };
    beforeEach(() => { t = T0; });

    it("a two-finger horizontal swipe pages once per gesture, momentum tail included", () => {
      bindInput(); three();
      for (let i = 0; i < 6; i++) wheel(40, 0);
      expect(pager.focus).toBe("b");
      for (let i = 0; i < 30; i++) wheel(Math.max(1, 30 - i), 0);  // inertia keeps arriving every 16 ms
      expect(pager.focus).toBe("b");
      wheel(40, 0, 400); for (let i = 0; i < 3; i++) wheel(40, 0);   // a new gesture after a quiet gap
      expect(pager.focus).toBe("c");
      expect(view.zt).toBe(1);
    });

    it("a swipe that drifts vertically stays a swipe and never zooms", () => {
      bindInput(); three(); view.zt = 0.8;
      wheel(30, 10);
      for (let i = 0; i < 8; i++) wheel(5, 40);
      expect(view.zt).toBe(0.8);
    });

    it("tiny horizontal wheel jitter neither pages nor zooms", () => {
      bindInput(); three(); view.zt = 0.8;
      for (let i = 0; i < 10; i++) wheel(i % 2 ? 3 : -3, 0);
      wheel(4, 0, 16, { ctrlKey: false });
      expect(pager.focus).toBe("a");
      expect(view.zt).toBe(0.8);
    });

    it("two-finger vertical scroll zooms", () => {
      bindInput(); three(); view.zt = 0.5;
      wheel(0, -100);
      expect(view.zt).toBeCloseTo(0.66);
    });

    it("pinch zooms: ctrl+wheel (Chrome/Firefox) and gesturechange (Safari)", () => {
      bindInput(); three(); view.zt = 0.5;
      wheel(0, -20, 16, { ctrlKey: true });
      expect(view.zt).toBeCloseTo(0.7);
      const loop = document.querySelector("#loop")!;
      const g = (type: string, scale: number) => { const e = new Event(type, { cancelable: true }); Object.defineProperty(e, "scale", { value: scale }); loop.dispatchEvent(e); };
      view.zt = 0.5;
      g("gesturestart", 1); g("gesturechange", 1.25);
      expect(view.zt).toBeCloseTo(0.7);
      g("gesturechange", 1.0); g("gestureend", 1.0);
      expect(view.zt).toBeCloseTo(0.5);
    });
  });

  it("0 and Home ease the camera home; Escape closes the popover before zooming out", () => {
    bindInput();
    orbit.yaw = 20; key("0");
    expect(orbit.ease).not.toBeNull();
    resetOrbit(); orbit.yaw = 20; ui.reduce = true; key("Home"); ui.reduce = false;
    expect(orbit.yaw).toBe(0);
    hooks.inspectClose = () => true;
    key("Escape");
    expect(view.zt).toBe(1);
  });
});

describe("⌘1–⌘9 select a tab", () => {
  const press = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) => {
    const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e); return e;
  };
  beforeEach(() => {
    document.body.className = "portrait"; ui.portrait = true;
    bindCards(); bindTabs(); bindInput();
    for (let i = 0; i < 3; i++) store.sessions.set("s" + i, sess("s" + i, { name: "p" + i }, i * 10));
    pagerTick(); renderCards(); pager.focus = "s2";
  });
  it("⌘2 selects tab 2 and is prevented", () => {
    const e = press("2", { metaKey: true });
    expect(pager.focus).toBe("s1");
    expect(e.defaultPrevented).toBe(true);
  });
  it("a missing tab is not prevented", () => {
    const e = press("5", { metaKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(pager.focus).toBe("s2");
  });
  it("ctrl, ⌘+shift and ⌘+alt do nothing", () => {
    expect(press("1", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press("1", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press("1", { metaKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(pager.focus).toBe("s2");
  });
  it("typing in an input does nothing", () => {
    const i = document.createElement("input"); document.body.append(i);
    press("1", { metaKey: true }, i);
    expect(pager.focus).toBe("s2");
  });
  it("does nothing while the spend drawer is open", async () => {
    await openDrawer("today");
    const e = press("1", { metaKey: true });
    expect(pager.focus).toBe("s2");
    expect(e.defaultPrevented).toBe(false);
  });
  it("body.cmd follows the Meta key and window blur", () => {
    press("Meta", { metaKey: true });
    expect(document.body.classList.contains("cmd")).toBe(true);
    dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    expect(document.body.classList.contains("cmd")).toBe(false);
    press("Meta", { metaKey: true });
    dispatchEvent(new Event("blur"));
    expect(document.body.classList.contains("cmd")).toBe(false);
  });
});
