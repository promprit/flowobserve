import { beforeEach, describe, expect, it, vi } from "vitest";
import { helperUrl, itermOf } from "../src/helper";
import { pager } from "../src/pager";
import { hooks, store } from "../src/state";
import { renderCards } from "../src/ui/cards";
import { jumpTarget } from "../src/ui/verbs";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

const U = "0123abcd-4567-89ab-cdef-0123456789ab";
const JUMP = `flowobserve://jump?iterm=w0t1p2%3A${U}`;
const TOKEN = "a".repeat(64);

beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: TOKEN });
  hooks.openReader = undefined;
});
const put = (...list: ReturnType<typeof sess>[]) => list.forEach((s) => store.sessions.set(s.id, s));
const card = (id: string) => document.querySelector<HTMLElement>(`.card[data-id="${id}"]`)!;
const spyGo = () => vi.spyOn(nav, "go").mockImplementation(() => {});

describe("card click", () => {
  it("a plain click focuses the card and never navigates", () => {
    const go = spyGo();
    put(sess("app0000-0000", { openUrl: "vscode://file/a" }), sess("other000-0001", { openUrl: "vscode://file/a" }, 1)); // same project: both cards on the shown page
    pager.focus = "other000-0001";
    renderCards();
    card("app0000-0000").click();
    expect(pager.focus).toBe("app0000-0000");
    expect(go).not.toHaveBeenCalled();
  });

  it("a command-click jumps to the session and does not focus the card", () => {
    const go = spyGo();
    const a = sess("app0000-0000", { host: "iterm", jumpUrl: JUMP, openUrl: null });
    put(a, sess("other000-0001", { name: a.name }, 1)); // same project (no openUrl: keyed by name): both cards on the shown page
    pager.focus = "other000-0001";
    renderCards();
    card(a.id).dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(`${jumpTarget(a)}&t=${TOKEN}`);
    expect(pager.focus).toBe("other000-0001");
  });

  it("a command-click on a vscode session opens its vscode link", () => {
    const go = spyGo();
    put(sess("app0000-0000", { openUrl: "vscode://file/Users/p/app" }));
    renderCards();
    card("app0000-0000").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    expect(go).toHaveBeenCalledWith("vscode://file/Users/p/app");
  });

  it("a command-click on an iterm session without a token opens its vscode link, as in v1", () => {
    const go = spyGo();
    store.helperToken = null;
    put(sess("app0000-0000", { host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" }));
    renderCards();
    card("app0000-0000").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    expect(go).toHaveBeenCalledWith("vscode://file/x");
  });
});

describe("action chip", () => {
  it("shows the session action when set, and keeps its click behaviour", () => {
    const go = spyGo();
    put(sess("app0000-0000", { status: "waiting", stage: 1, action: "APPROVE PLAN", openUrl: "vscode://file/Users/p/app", docs: { spec: 1, plan: 0, at: T0 } }));
    renderCards();
    const c = card("app0000-0000");
    expect(c.querySelector(".act")!.textContent).toBe("APPROVE PLAN");
    c.querySelector<HTMLElement>(".act")!.click();
    expect(go).toHaveBeenCalledWith("vscode://file/Users/p/app");
  });

  it("an iterm session's action chip jumps through the helper with the token", () => {
    const go = spyGo();
    put(sess("app0000-0000", { host: "iterm", jumpUrl: JUMP, status: "waiting", stage: 1, action: "APPROVE PLAN" }));
    renderCards();
    card("app0000-0000").querySelector<HTMLElement>(".act")!.click();
    expect(go).toHaveBeenCalledWith(`${JUMP}&t=${TOKEN}`);
  });

  it("shows the verb label when there is no action, and clicking runs the verb", () => {
    const go = spyGo();
    put(sess("term0000-0001", { host: "iterm", status: "active", jumpUrl: JUMP }, 1));
    renderCards();
    const t = card("term0000-0001");
    expect(t.querySelector(".act")!.textContent).toBe("JUMP");
    t.querySelector<HTMLElement>(".act")!.click();
    expect(go).toHaveBeenCalledWith(`${JUMP}&t=${TOKEN}`);
  });

  it("a waiting session with a spec but no action has no READ SPEC chip", () => {
    put(sess("app0000-0000", { status: "waiting", stage: 0, docs: { spec: 1, plan: 0, at: T0 } }));
    renderCards();
    expect(card("app0000-0000").querySelector(".act")!.textContent).not.toBe("READ SPEC");
  });

  it("REVIEW SPEC opens the reader on the spec, without navigating", () => {
    const go = spyGo();
    const open = vi.fn(); hooks.openReader = open;
    put(sess("app0000-0000", { status: "waiting", stage: 0, action: "REVIEW SPEC", openUrl: "vscode://file/x", docs: { spec: 1, plan: 0, at: T0 } }));
    renderCards();
    card("app0000-0000").querySelector<HTMLElement>(".act")!.click();
    expect(open).toHaveBeenCalledWith("app0000-0000", "spec", expect.any(Function));
    expect(go).not.toHaveBeenCalled();
  });

  it("APPROVE PLAN opens the reader on the plan when plan exists, else jumps as today", () => {
    const go = spyGo();
    const open = vi.fn(); hooks.openReader = open;
    put(sess("app0000-0000", { status: "waiting", stage: 1, action: "APPROVE PLAN", openUrl: "vscode://file/x", docs: { spec: 1, plan: 1, at: T0 } }),
      sess("b0000000-0001", { status: "waiting", stage: 1, action: "APPROVE PLAN", openUrl: "vscode://file/y", docs: { spec: 1, plan: 0, at: T0 } }, 1),
      sess("c0000000-0002", { status: "waiting", stage: 1, action: "ANSWER", openUrl: "vscode://file/z", docs: { spec: 1, plan: 1, at: T0 } }, 2));
    pager.focus = "app0000-0000"; renderCards();
    card("app0000-0000").querySelector<HTMLElement>(".act")!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("app0000-0000", "plan", expect.any(Function));
    expect(go).not.toHaveBeenCalled();
    pager.focus = "b0000000-0001"; renderCards(); // one project per page: show b's page first
    card("b0000000-0001").querySelector<HTMLElement>(".act")!.click();
    pager.focus = "c0000000-0002"; renderCards();
    card("c0000000-0002").querySelector<HTMLElement>(".act")!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith("vscode://file/y");
    expect(go).toHaveBeenCalledWith("vscode://file/z");
  });

  it("a vscode session with nothing to offer has no chip text", () => {
    put(sess("app0000-0000", { host: "vscode", status: "active" }));
    renderCards();
    const c = card("app0000-0000");
    expect(c.querySelector(".act")!.textContent).toBe("");
    expect(c.className).not.toContain("has-act");
  });
});

describe("steps", () => {
  it("an iterm session's HANDOFF goes through the helper, sends instead of copying", async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const go = spyGo();
    const s = sess("app0000-0000", { host: "iterm", jumpUrl: JUMP });
    put(s);
    renderCards();
    const c = card(s.id);
    c.querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    expect(go).toHaveBeenCalledWith(helperUrl.step(itermOf(JUMP)!, "handoff"));
    expect(go).toHaveBeenCalledWith(`flowobserve://step?iterm=w0t1p2%3A${U}&do=handoff&t=${TOKEN}`);
    expect(write).not.toHaveBeenCalled();
    expect(c.querySelector(".note")!.textContent).toBe("Sent /handoff");
  });

  it("an iterm step without a token copies and opens vscode, as in v1", async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const go = spyGo();
    store.helperToken = null;
    put(sess("app0000-0000", { host: "iterm", jumpUrl: JUMP }));
    renderCards();
    const c = card("app0000-0000");
    c.querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    expect(write).toHaveBeenCalledWith("/handoff");
    expect(go).toHaveBeenCalledWith("vscode://anthropic.claude-code/open?session=app0000-0000");
    await vi.advanceTimersByTimeAsync(0);
    expect(c.querySelector(".note")!.textContent).toBe("Copied /handoff — paste + Enter");
  });

  it("a vscode session still copies the text and shows the paste note", async () => {
    const order: string[] = [];
    const write = vi.fn(() => { order.push("copy"); return Promise.resolve(); });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const go = vi.spyOn(nav, "go").mockImplementation(() => { order.push("go"); });
    put(sess("app0000-0000", { host: "vscode" }));
    renderCards();
    const c = card("app0000-0000");
    c.querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    expect(order).toEqual(["copy", "go"]);
    expect(go).toHaveBeenCalledWith("vscode://anthropic.claude-code/open?session=app0000-0000");
    await vi.advanceTimersByTimeAsync(0);
    expect(c.querySelector(".note")!.textContent).toBe("Copied /handoff — paste + Enter");
  });
});

describe("results and colour", () => {
  it("a ready card shows its results line with failures marked", () => {
    put(sess("app0000-0000", { ready: { tests: true, build: false, review: null } }));
    renderCards();
    const res = card("app0000-0000").querySelector(".res")!;
    expect(res.textContent).toBe("tests ✓ · build ✗");
    expect(res.querySelector(".ko")!.textContent).toBe("build ✗");
  });

  it("a card without results has an empty line", () => {
    put(sess("app0000-0000", { ready: null }));
    renderCards();
    expect(card("app0000-0000").querySelector(".res")!.textContent).toBe("");
  });

  it("a card with a colour carries it as --pc", () => {
    put(sess("app0000-0000", { color: "#ff8800" }), sess("none0000-0001", { color: null }, 1));
    pager.focus = "app0000-0000"; renderCards();
    expect(card("app0000-0000").style.getPropertyValue("--pc")).toBe("#ff8800");
    pager.focus = "none0000-0001"; renderCards(); // one project per page
    expect(card("none0000-0001").style.getPropertyValue("--pc")).toBe("transparent");
  });
});

describe("dismiss and background", () => {
  it("the x button posts the sid with the token and removes the card", () => {
    const f = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", f);
    put(sess("app0000-0000", { openUrl: "vscode://file/a" }), sess("other000-0001", { openUrl: "vscode://file/a" }, 1));
    renderCards();
    const x = card("app0000-0000").querySelector<HTMLButtonElement>(".dismiss")!;
    expect(x.getAttribute("aria-label")).toBe("Dismiss session");
    x.click();
    expect(f).toHaveBeenCalledWith("/api/dismiss", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "x-fo-token": TOKEN }), body: JSON.stringify({ sid: "app0000-0000" }),
    }));
    expect(store.sessions.has("app0000-0000")).toBe(false);
    renderCards();
    expect(document.querySelector('.card[data-id="app0000-0000"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it("a background session's card is dimmed with a BACKGROUND chip", () => {
    put(sess("app0000-0000", { kind: "bg", openUrl: "vscode://file/a" }), sess("other000-0001", { openUrl: "vscode://file/a" }, 1));
    renderCards();
    expect(card("app0000-0000").classList.contains("bg")).toBe(true);
    expect(card("app0000-0000").querySelector(".bgc")!.textContent).toBe("BACKGROUND");
    expect(card("other000-0001").classList.contains("bg")).toBe(false);
  });
});
