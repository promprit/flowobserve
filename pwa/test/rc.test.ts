import { beforeEach, describe, expect, it, vi } from "vitest";
import { needsYou } from "../src/layout";
import { hooks, store } from "../src/state";
import { renderCards } from "../src/ui/cards";
import { renderFoot } from "../src/ui/foot";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); hooks.openReader = undefined; });

describe("RC takeover on the board", () => {
  it("needsYou: NEEDS statuses or rc", () => {
    expect(needsYou({ rc: null }, "active")).toBe(false);
    expect(needsYou({ rc: { takenOverAt: 1 } }, "active")).toBe(true);
    expect(needsYou({}, "waiting")).toBe(true);
  });
  it("card shows RC TAKEN OVER and the foot counts it", () => {
    store.sessions.set("a", sess("a", { rc: { takenOverAt: T0 } }));
    store.sessions.set("b", sess("b", { name: "a" }, 1)); // same project: both cards on the shown page
    renderCards(); renderFoot();
    const a = document.querySelector<HTMLElement>('.card[data-id="a"]')!;
    expect(a.classList.contains("has-rc")).toBe(true);
    expect(a.querySelector(".rc")!.textContent).toBe("RC TAKEN OVER");
    expect(document.querySelector<HTMLElement>('.card[data-id="b"]')!.classList.contains("has-rc")).toBe(false);
    expect(document.querySelector("#foot")!.textContent).toContain("1 needs you");
  });
  it("stale link hides the chip", () => {
    store.link = "stale";
    store.sessions.set("a", sess("a", { rc: { takenOverAt: T0 } }));
    renderCards();
    expect(document.querySelector<HTMLElement>('.card[data-id="a"]')!.classList.contains("has-rc")).toBe(false);
  });
  it("REVIEW SPEC falls back to the open link when the reader reports the doc missing", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    hooks.openReader = (_id, _k, miss) => miss?.();
    store.sessions.set("a", sess("a", { status: "waiting", stage: 0, action: "REVIEW SPEC", docs: { spec: 1, plan: 0, at: T0 }, host: "vscode", openUrl: "vscode://file/a" }));
    renderCards();
    document.querySelector<HTMLElement>('.card[data-id="a"] .act')!.click();
    expect(go).toHaveBeenCalledWith("vscode://file/a");
  });
});
