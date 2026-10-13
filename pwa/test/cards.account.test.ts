import { beforeEach, expect, it, vi } from "vitest";
import { hooks, store } from "../src/state";
import { renderCards } from "../src/ui/cards";
import { T0, loadDom, reset, sess } from "./helpers";

beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: null });
  hooks.openReader = undefined;
});
const card = (id: string) => document.querySelector<HTMLElement>(`.card[data-id="${id}"]`)!;

it("names the account and tags a Dryas-less one", () => {
  store.sessions.set("a", sess("a", { name: "app", account: { label: "Team", dryas: true } }));
  store.sessions.set("b", sess("b", { name: "app", account: { label: "Pro", dryas: false } }, 1));
  renderCards();
  expect(card("a").querySelector(".acct")!.textContent).toBe("TEAM");
  expect(card("a").querySelector(".acct .nd")).toBeNull();
  expect(card("b").querySelector(".acct")!.firstChild!.textContent).toBe("PRO");
  expect(card("b").querySelector(".acct .nd")!.textContent).toBe("NO DRYAS");
});

it("one account: the account slot stays empty", () => {
  store.sessions.set("a", sess("a", { name: "app" }));
  renderCards();
  expect(card("a").querySelector(".acct")!.innerHTML).toBe("");
});
