import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindInput } from "../src/input";
import { pager } from "../src/pager";
import { store } from "../src/state";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

const U = "0123abcd-4567-89ab-cdef-0123456789ab";
const JUMP = `flowobserve://jump?iterm=w0t1p2%3A${U}`;
const TOKEN = "a".repeat(64);
const SIGNED = `${JUMP}&t=${TOKEN}`;

beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); loadDom();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: TOKEN });
});
const press = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
const setup = (patch: Parameters<typeof sess>[1]) => {
  const go = vi.spyOn(nav, "go").mockImplementation(() => {});
  bindInput();
  store.sessions.set("a", sess("a", patch, 0));
  pager.focus = "a";
  return go;
};

describe("Enter by host", () => {
  it("Enter on an iterm session jumps through the helper with the token", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" });
    press("Enter");
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(SIGNED);
  });

  it("Enter on an iterm session without a token opens its vscode link, as in v1", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" });
    store.helperToken = null;
    press("Enter");
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith("vscode://file/x");
  });

  it("J on an iterm session without a token opens its vscode link, as in v1", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" });
    store.helperToken = null;
    press("j");
    expect(go).toHaveBeenCalledWith("vscode://file/x");
  });

  it("Enter on a vscode session still opens its vscode link", () => {
    const go = setup({ host: "vscode", openUrl: "vscode://file/Users/p/app" });
    press("Enter");
    expect(go).toHaveBeenCalledWith("vscode://file/Users/p/app");
  });
});

describe("J jumps", () => {
  it("j and J go to the session's host", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP });
    press("j");
    press("J");
    expect(go).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenNthCalledWith(1, SIGNED);
    expect(go).toHaveBeenNthCalledWith(2, SIGNED);
  });

  it("j on a vscode session opens its vscode link", () => {
    const go = setup({ host: "vscode", openUrl: "vscode://file/Users/p/app" });
    press("j");
    expect(go).toHaveBeenCalledWith("vscode://file/Users/p/app");
  });

  it("j with a modifier does nothing", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP });
    press("j", { metaKey: true });
    press("j", { ctrlKey: true });
    press("j", { altKey: true });
    expect(go).not.toHaveBeenCalled();
  });

  it("j with no focused session does nothing", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP });
    pager.focus = null;
    press("j");
    expect(go).not.toHaveBeenCalled();
  });
});

describe("typing in a field", () => {
  it("typing in the Open sheet filter fires no board shortcut", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" });
    store.sessions.set("b", sess("b", {}, 1));
    const inp = document.createElement("input");
    document.querySelector("#sheet")!.appendChild(inp);
    inp.focus();
    for (const k of ["j", "J", "Enter", "-", "ArrowDown", "ArrowRight", "0", "+"]) press(k, {}, inp);
    expect(go).not.toHaveBeenCalled();
    expect(pager.focus).toBe("a");
  });

  it("any key inside #sheet, even off an input, is not a board shortcut", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP });
    const b = document.createElement("button");
    document.querySelector("#sheet")!.appendChild(b);
    press("Enter", {}, b);
    expect(go).not.toHaveBeenCalled();
  });

  it("contentEditable and textarea targets are skipped too", () => {
    const go = setup({ host: "iterm", jumpUrl: JUMP });
    const ta = document.createElement("textarea"), ce = document.createElement("div");
    Object.defineProperty(ce, "isContentEditable", { value: true });
    document.body.append(ta, ce);
    press("j", {}, ta); press("j", {}, ce);
    expect(go).not.toHaveBeenCalled();
  });
});

describe("D opens the branch diff", () => {
  const APP = [{ key: "app", name: "app", group: null, color: "#112233", folders: [{ rel: "app", worktree: null, live: "a", restore: [] }] }];
  it("d and D on an iTerm2 session at Build or later open the helper diff", () => {
    const go = setup({ host: "iterm", stage: 5, jumpUrl: JUMP });
    store.projects = APP;
    press("d");
    press("D");
    expect(go).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenNthCalledWith(1, `flowobserve://diff?path=app&t=${TOKEN}`);
    expect(go).toHaveBeenNthCalledWith(2, `flowobserve://diff?path=app&t=${TOKEN}`);
  });
  it("d on a VS Code session does not navigate", () => {
    const go = setup({ host: "vscode", stage: 5, openUrl: "vscode://file/x" });
    store.projects = APP;
    press("d");
    expect(go).not.toHaveBeenCalled();
  });
});
