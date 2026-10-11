import { beforeEach, describe, expect, it, vi } from "vitest";
import { helperUrl, safeHelperUrl } from "../src/helper";
import { pager } from "../src/pager";
import { store } from "../src/state";
import { renderCards } from "../src/ui/cards";
import { diffUrl } from "../src/ui/verbs";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

const TOKEN = "a".repeat(64);
beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom();
  Object.assign(store, { helperToken: TOKEN, projects: [{ key: "app", name: "app", group: null, color: "#112233", folders: [{ rel: "app", worktree: null, live: "a", restore: [] }] }] });
});

describe("DIFF", () => {
  it("url shape is a safe helper link", () => {
    const u = helperUrl.diff("app")!;
    expect(u).toBe(`flowobserve://diff?path=app&t=${TOKEN}`);
    expect(safeHelperUrl(u)).toBe(u);
    expect(helperUrl.diff("../x")).toBeNull();
  });
  it("only iTerm2 sessions at stage ≥ 3 with the helper", () => {
    expect(diffUrl(sess("a", { host: "iterm", stage: 3 }))).toBe(`flowobserve://diff?path=app&t=${TOKEN}`);
    expect(diffUrl(sess("a", { host: "iterm", stage: 2 }))).toBeNull();
    expect(diffUrl(sess("a", { host: "vscode", stage: 5 }))).toBeNull();
    expect(diffUrl(sess("z", { host: "iterm", stage: 5 }))).toBeNull();
    store.helperToken = null;
    expect(diffUrl(sess("a", { host: "iterm", stage: 5 }))).toBeNull();
  });
  it("chip shows and opens without changing focus", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    store.sessions.set("a", sess("a", { host: "iterm", stage: 5 }));
    pager.focus = "a"; renderCards();
    const c = document.querySelector<HTMLElement>('.card[data-id="a"]')!;
    expect(c.classList.contains("has-diff")).toBe(true);
    expect(c.querySelector(".diff")!.textContent).toBe("DIFF");
    c.querySelector<HTMLElement>(".diff")!.click();
    expect(go).toHaveBeenLastCalledWith(`flowobserve://diff?path=app&t=${TOKEN}`);
    expect(pager.focus).toBe("a");
  });
  it("no chip for a VS Code session", () => {
    store.sessions.set("a", sess("a", { host: "vscode", stage: 5 }));
    renderCards();
    expect(document.querySelector<HTMLElement>('.card[data-id="a"]')!.classList.contains("has-diff")).toBe(false);
  });
});
