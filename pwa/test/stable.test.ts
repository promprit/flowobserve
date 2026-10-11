import { beforeEach, expect, it, vi } from "vitest";
import { store } from "../src/state";
import { renderFoot } from "../src/ui/foot";
import { bindInput } from "../src/input";
import { drawerOpen } from "../src/ui/drawer";
import { bindUsage, renderUsage } from "../src/ui/usage";
import { T0, loadDom, reset, sess } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); });

it("renderUsage keeps child node identity when nothing changed", () => {
  store.usage = {
    session: { used: 0.5, startedAt: T0 - 3600e3, windowMs: 5 * 3600e3 },
    weekly: { used: 0.3, resetsAt: T0 + 3 * 86400e3 },
    jev: { usedUsd: 2.1, budgetUsd: 5, monthStart: new Date(2026, 9, 1).getTime() },
    at: T0,
  };
  renderUsage();
  const a = document.querySelector("#usage")!.firstElementChild;
  renderUsage();
  expect(document.querySelector("#usage")!.firstElementChild).toBe(a);
});

it("renderFoot keeps child node identity when nothing changed", () => {
  store.sessions.set("a", sess("a"));
  renderFoot();
  const a = document.querySelector("#foot")!.firstElementChild;
  renderFoot();
  expect(document.querySelector("#foot")!.firstElementChild).toBe(a);
});

it("Escape on the focused meter row still reaches the window", () => {
  bindUsage(); bindInput();
  const drawer = document.querySelector<HTMLElement>("#drawer")!;
  drawer.hidden = false;
  const usage = document.querySelector<HTMLElement>("#usage")!;
  let reached = false;
  const spy = (e: KeyboardEvent) => { if (e.key === "Escape") reached = true; };
  window.addEventListener("keydown", spy);
  usage.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.removeEventListener("keydown", spy);
  expect(reached).toBe(true);
  expect(drawerOpen()).toBe(false);
});
