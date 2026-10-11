import { beforeEach, describe, expect, it, vi } from "vitest";
import { pager, pagerTick, step } from "../src/pager";
import { sorted } from "../src/select";
import { store, ui, view } from "../src/state";
import { bindCards, renderCards } from "../src/ui/cards";
import { bindTabs } from "../src/ui/tabs";
import { T0, loadDom, reset, sess } from "./helpers";

const add = (id: string, name: string, dt: number) =>
  store.sessions.set(id, sess(id, { name, openUrl: `vscode://file/${name}`, startedAt: T0 + dt }, dt));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom();
  document.body.className = "portrait"; ui.portrait = true; ui.reduce = true;
  add("a1", "A", 0); add("a2", "A", 10); add("b1", "B", 5);
  pagerTick();
});

describe("portrait pager", () => {
  it("one card; one tab per session; the current tab is on", () => {
    renderCards();
    expect(document.querySelectorAll("#cards .card")).toHaveLength(1);
    expect(document.querySelectorAll("#tabs .tab")).toHaveLength(3);
    expect(document.querySelector("#tabs .tab.on")!.getAttribute("data-id")).toBe(pager.focus);
  });
  it("→ steps by session in project order", () => {
    pager.focus = "a1"; step(1); expect(pager.focus).toBe("a2"); step(1); expect(pager.focus).toBe("b1");
  });
  it("current session ends → next neighbour", () => {
    pager.focus = "a2"; pagerTick(); store.sessions.delete("a2"); pagerTick();
    expect(pager.focus).toBe("b1");
  });
  it("a status change never turns the page", () => {
    pager.focus = "a1"; pagerTick();
    store.sessions.get("b1")!.status = "waiting"; pagerTick();
    expect(pager.focus).toBe("a1");
  });
  it("tab click selects that session", () => {
    bindCards(); bindTabs(); renderCards();
    document.querySelector<HTMLElement>('#tabs .tab[data-id="b1"]')!.click();
    expect(pager.focus).toBe("b1");
  });
  it("need tab for RC takeover", () => {
    store.sessions.get("b1")!.rc = { takenOverAt: T0 }; renderCards();
    expect(document.querySelector('#tabs .tab[data-id="b1"]')!.classList.contains("need")).toBe(true);
  });
  it("a swipe does not also click the card", () => {
    bindCards(); pager.focus = "a1"; renderCards();
    const box = document.querySelector<HTMLElement>("#cards")!;
    const pe = (type: string, x: number) => box.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType: "touch", pointerId: 1, clientX: x, clientY: 100 }));
    pe("pointerdown", 400); pe("pointerup", 200);
    expect(pager.focus).toBe("a2");
    const z = view.zt;
    document.querySelector<HTMLElement>("#cards .card")!.click();
    expect(view.zt).toBe(z);
    expect(pager.focus).toBe("a2");
  });

  describe("swipe robustness", () => {
    const setup = () => {
      bindCards(); pager.focus = "a1"; renderCards();
      const box = document.querySelector<HTMLElement>("#cards")!;
      const pe = (type: string, x: number, id = 1) => box.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType: "touch", pointerId: id, clientX: x, clientY: 100 }));
      return { box, pe };
    };
    it("two-finger touch does not page", () => {
      const { pe } = setup();
      pe("pointerdown", 400, 1); pe("pointerdown", 410, 2);
      pe("pointerup", 200, 1); pe("pointerup", 200, 2);
      expect(pager.focus).toBe("a1");
    });
    it("a pointerup from another pointer is ignored", () => {
      const { pe } = setup();
      pe("pointerdown", 400, 1); pe("pointerup", 200, 2);
      expect(pager.focus).toBe("a1");
      pe("pointerup", 200, 1);
      expect(pager.focus).toBe("a2");
    });
    it("pointercancel then pointerup does not page", () => {
      const { pe } = setup();
      pe("pointerdown", 400); pe("pointercancel", 300); pe("pointerup", 200);
      expect(pager.focus).toBe("a1");
    });
    it("a click 1 s after a swipe is not swallowed", () => {
      const { pe } = setup();
      pe("pointerdown", 400); pe("pointerup", 200);
      expect(pager.focus).toBe("a2");
      vi.advanceTimersByTime(1000);
      const got = vi.fn(); document.addEventListener("click", got);
      document.querySelector<HTMLElement>("#cards .card")!.click();
      document.removeEventListener("click", got);
      expect(got).toHaveBeenCalledTimes(1);
    });
  });
});

describe("landscape unchanged", () => {
  it("step walks today's ranked order", () => {
    document.body.className = "landscape"; ui.portrait = false;
    store.sessions.get("b1")!.status = "waiting";
    pager.focus = "a1";
    const l = sorted().map((s) => s.id);
    step(1);
    expect(pager.focus).toBe(l[(l.indexOf("a1") + 1) % l.length]);
  });
});
