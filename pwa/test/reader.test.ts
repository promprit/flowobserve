import { beforeEach, describe, expect, it, vi } from "vitest";
import { hooks, store } from "../src/state";
import type { FetchFn } from "../src/ui/drawer";
import { bindReader, closeReader, openReader, readerOpen } from "../src/ui/reader";
import { jumpTarget } from "../src/ui/verbs";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess } from "./helpers";

const U = "0123abcd-4567-89ab-cdef-0123456789ab";
const JUMP = `flowobserve://jump?iterm=w0t1p2%3A${U}`;
const TOKEN = "a".repeat(64);
const BASE = "http://127.0.0.1:4317";
const PLAN = "# Plan\n\n## Goal\n\ntext\n\n### Task 1: X\n\n## Done\n";
const SPEC = "# Spec\n\n## Why\n";

beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); loadDom();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: TOKEN, spendBase: BASE });
  hooks.openReader = undefined;
  bindReader();
  closeReader();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const panel = () => document.querySelector<HTMLElement>("#reader")!;
const q = <T extends HTMLElement = HTMLElement>(s: string) => panel().querySelector<T>(s)!;
const doc = (markdown: string) => ({ ok: true, status: 200, json: async () => ({ path: "docs/x.md", markdown, mtime: 1 }) });
const miss = { ok: false, status: 404, json: async () => ({}) };
const byKind = (spec: unknown, plan: unknown): FetchFn => vi.fn(async (u: string) => (u.includes("kind=spec") ? spec : plan) as never);
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("reader", () => {
  it("opens the plan and jumps to approve", async () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    const a = sess("a", { host: "iterm", jumpUrl: JUMP, status: "waiting", stage: 1, action: "APPROVE PLAN", docs: { spec: 1, plan: 1, at: T0 } });
    store.sessions.set("a", a);
    const f = byKind(doc(SPEC), doc(PLAN));
    await openReader("a", "plan", f);
    expect(f).toHaveBeenCalledWith(`${BASE}/api/doc?session=a&kind=plan`, expect.anything());
    expect(readerOpen()).toBe(true);
    expect(panel().hidden).toBe(false);
    expect(q(".rd-doc").innerHTML).toContain('<h2 id="goal">Goal</h2>');
    expect(panel().querySelectorAll(".rd-toc [data-id]").length).toBe(3);
    expect(panel().querySelector("input, textarea")).toBeNull();
    expect(q(".rd-go").textContent).toBe("Jump to approve ↵");
    (document.activeElement as HTMLElement).blur();
    key("Enter");
    expect(go).toHaveBeenCalledWith(`${jumpTarget(a)}&t=${TOKEN}`);
  });

  it("Enter on a vscode session opens its vscode link", async () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    store.sessions.set("v", sess("v", { host: "vscode", openUrl: "vscode://file/Users/p/app", status: "waiting", stage: 0, docs: { spec: 1, plan: 0, at: T0 } }));
    await openReader("v", "spec", byKind(doc(SPEC), miss));
    q(".rd-go").click();
    expect(go).toHaveBeenCalledWith("vscode://file/Users/p/app");
  });

  it("disables the SPEC tab with 'No spec yet' when the spec is 404", async () => {
    store.sessions.set("a", sess("a", { docs: { spec: 0, plan: 1, at: T0 } }));
    await openReader("a", "plan", byKind(miss, doc(PLAN)));
    const tab = q<HTMLButtonElement>('[data-tab="spec"]');
    expect(tab.disabled || tab.classList.contains("off") || tab.getAttribute("aria-disabled") === "true").toBe(true);
    expect(panel().textContent).toContain("No spec yet");
  });

  it("clicking an outline item scrolls to its heading", async () => {
    store.sessions.set("a", sess("a"));
    await openReader("a", "plan", byKind(doc(SPEC), doc(PLAN)));
    const spy = vi.fn();
    q(".rd-doc #task-1-x").scrollIntoView = spy;
    q<HTMLElement>('.rd-toc [data-id="task-1-x"]').click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("s and p switch tabs; Escape closes and hides", async () => {
    store.sessions.set("a", sess("a"));
    const f = byKind(doc(SPEC), doc(PLAN));
    await openReader("a", "plan", f);
    key("s"); await vi.advanceTimersByTimeAsync(0);
    expect(q(".rd-doc").innerHTML).toContain('id="why"');
    key("p"); await vi.advanceTimersByTimeAsync(0);
    expect(q(".rd-doc").innerHTML).toContain('id="goal"');
    key("Escape");
    expect(readerOpen()).toBe(false);
    expect(panel().hidden).toBe(true);
  });

  it("a late response for A never paints over B", async () => {
    store.sessions.set("a", sess("a")); store.sessions.set("b", sess("b", {}, 1));
    let release!: () => void;
    const slowA: FetchFn = vi.fn((u: string) => new Promise<never>((res) => { release = () => res(doc("## From A") as never); void u; }));
    const pa = openReader("a", "plan", slowA);
    await openReader("b", "plan", byKind(miss, doc("## From B")));
    release(); await pa;
    expect(q(".rd-doc").innerHTML).toContain("From B");
    expect(q(".rd-doc").innerHTML).not.toContain("From A");
  });

  it("shows 'Couldn't load the plan' when the fetch rejects", async () => {
    store.sessions.set("a", sess("a"));
    await openReader("a", "plan", vi.fn(async () => { throw new Error("down"); }));
    expect(panel().textContent).toContain("Couldn't load the plan");
  });

  it("shows markdown with <script> as inert text", async () => {
    store.sessions.set("a", sess("a"));
    await openReader("a", "plan", byKind(miss, doc("## Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>")));
    expect(panel().querySelector("script, img")).toBeNull();
    expect(q(".rd-doc").textContent).toContain("<script>alert(1)</script>");
  });

  it("bindReader wires hooks.openReader; r opens the focused card on the plan if there is one, else the spec", async () => {
    store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 1, at: T0 } }));
    const f = byKind(doc(SPEC), doc(PLAN));
    vi.stubGlobal("fetch", f);
    expect(typeof hooks.openReader).toBe("function");
    const { pager } = await import("../src/pager");
    pager.focus = "a";
    key("r"); await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledWith(expect.stringContaining("kind=plan"), expect.anything());
    closeReader();
    store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 0, at: T0 } }));
    key("R"); await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenLastCalledWith(expect.stringContaining("kind=spec"), expect.anything());
    vi.unstubAllGlobals();
  });

  describe("modal", () => {
    const seed = async () => {
      store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 1, at: T0 } }));
      await openReader("a", "plan", byKind(doc(SPEC), doc(PLAN)));
    };
    const spy = (type: string) => { const f = vi.fn(); window.addEventListener(type, f); return f; };

    it("keys do not reach the board while the reader is open", async () => {
      await seed();
      const doc_ = vi.fn(), win = vi.fn();
      document.addEventListener("keydown", doc_); window.addEventListener("keydown", win);
      for (const k of ["o", "j", "ArrowDown", "-", "+", "0"]) key(k);
      expect(doc_).not.toHaveBeenCalled();
      expect(win).not.toHaveBeenCalled();
      expect(readerOpen()).toBe(true);
    });

    it("Escape closes only the reader", async () => {
      await seed();
      const win = vi.fn(); window.addEventListener("keydown", win);
      const sheet = document.querySelector<HTMLElement>("#sheet");
      if (sheet) sheet.hidden = true;
      key("Escape");
      expect(readerOpen()).toBe(false);
      expect(win).not.toHaveBeenCalled();
      if (sheet) expect(sheet.hidden).toBe(true);
    });

    it("Enter on a focused reader button lets the button act instead of jumping", async () => {
      const go = vi.spyOn(nav, "go").mockImplementation(() => {});
      await seed();
      q<HTMLElement>(".rd-x").focus();
      key("Enter");
      expect(go).not.toHaveBeenCalled();
    });

    it("a backdrop covers the board; clicking it closes the reader", async () => {
      await seed();
      const bd = document.querySelector<HTMLElement>("#reader-bd")!;
      expect(bd.hidden).toBe(false);
      const c = spy("click");
      bd.click();
      expect(readerOpen()).toBe(false);
      expect(bd.hidden).toBe(true);
      expect(c).toHaveBeenCalled();
    });

    it("is a labelled modal dialog; focus goes to .rd-go and returns on close", async () => {
      store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 1, at: T0 } }));
      const b = document.createElement("button"); document.body.appendChild(b); b.focus();
      await openReader("a", "plan", byKind(doc(SPEC), doc(PLAN)));
      expect(panel().getAttribute("role")).toBe("dialog");
      expect(panel().getAttribute("aria-modal")).toBe("true");
      expect(panel().getAttribute("aria-label")).toBeTruthy();
      expect(document.activeElement).toBe(q(".rd-go"));
      closeReader();
      expect(document.activeElement).toBe(b);
    });

    it("with no spendBase nothing is fetched and both tabs say there is nothing yet", async () => {
      store.spendBase = null;
      store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 1, at: T0 } }));
      const f = byKind(doc(SPEC), doc(PLAN));
      await openReader("a", "plan", f);
      expect(f).not.toHaveBeenCalled();
      expect(panel().textContent).toContain("No plan yet");
      expect(panel().textContent).toContain("No spec yet");
    });
  });
});

describe("reader focus trap", () => {
  const tab = (shiftKey = false) => {
    const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(e);
    return e;
  };
  const controls = () => [...panel().querySelectorAll<HTMLElement>("button:not([disabled])")];

  it("tab stays inside the reader", async () => {
    store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 1, at: T0 } }));
    await openReader("a", "plan", byKind(doc(SPEC), doc(PLAN)));
    const c = controls();
    c[c.length - 1].focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c[0]);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c[c.length - 1]);
  });

  it("tab from the document reaches the jump button", async () => {
    store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 1, at: T0 } }));
    await openReader("a", "plan", byKind(doc(SPEC), doc(PLAN)));
    q(".rd-doc").focus();
    expect(document.activeElement).toBe(q(".rd-doc"));
    tab();
    expect(document.activeElement).toBe(q(".rd-go"));
    tab(true);
    expect(document.activeElement).toBe(q(".rd-doc"));
  });

  it("tab with focus outside the reader pulls it in", async () => {
    store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 1, at: T0 } }));
    const b = document.createElement("button");
    document.body.appendChild(b);
    await openReader("a", "plan", byKind(doc(SPEC), doc(PLAN)));
    b.focus();
    tab();
    expect(panel().contains(document.activeElement)).toBe(true);
  });
});

describe("reader fallback", () => {
  it("404 on the primary doc closes the reader and calls onMissing", async () => {
    store.spendBase = BASE;
    store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 0, at: T0 } }));
    const onMissing = vi.fn();
    await openReader("a", "spec", async () => miss as Response, onMissing);
    expect(onMissing).toHaveBeenCalledOnce();
    expect(readerOpen()).toBe(false);
    expect(panel().hidden).toBe(true);
  });
  it("a fetch error shows the reader error and does not jump", async () => {
    store.spendBase = BASE;
    store.sessions.set("a", sess("a", { docs: { spec: 1, plan: 0, at: T0 } }));
    const onMissing = vi.fn();
    await openReader("a", "spec", async () => { throw new Error("timeout"); }, onMissing);
    expect(onMissing).not.toHaveBeenCalled();
    expect(readerOpen()).toBe(true);
    expect(panel().hidden).toBe(false);
  });
});
