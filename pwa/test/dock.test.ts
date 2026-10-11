import { beforeEach, describe, expect, it, vi } from "vitest";
import { pager } from "../src/pager";
import { store, ui } from "../src/state";
import { cpage, renderCards, setCardPage } from "../src/ui/cards";
import { HOVER } from "../src/config";
import { view } from "../src/state";
import { renderFoot } from "../src/ui/foot";
import { renderHead } from "../src/ui/head";
import { renderModels } from "../src/ui/models";
import { nav } from "../src/util";
import { METRICS, T0, loadDom, reset, sess } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); });
const put = (...list: ReturnType<typeof sess>[]) => list.forEach((s) => store.sessions.set(s.id, s));
const card = (name: string) => [...document.querySelectorAll<HTMLElement>(".card")].find((c) => c.dataset.id === [...store.sessions.values()].find((s) => s.name === name)!.id)!;

describe("cards", () => {
  it("shows CTX with its level and a button row; CLEAR is off until a handoff is saved", () => {
    put(sess("app", { ctx: { pct: 0.61, tokens: 122_000, window: 200_000, level: "warn" } }));
    renderCards();
    const c = card("app");
    expect(c.querySelector(".ctx")!.textContent).toBe("39% LEFT");
    expect(c.querySelector(".ctx")!.className).toContain("warn");
    expect(c.className).toContain("show-btns");
    expect(c.querySelector('[data-step="handoff"]')!.className).toContain("next");
    expect(c.querySelector('[data-step="clear"]')!.className).toContain("off");
  });

  it("a button opens the focus-only session link without refocusing the card; nothing while stale", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    put(sess("app", { id: "app0000-0000", openUrl: "vscode://file/x" }), sess("other", { openUrl: "vscode://file/x" }, 1)); // same project: both cards on the shown page
    pager.focus = "other";
    renderCards();
    card("app").querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    expect(go).toHaveBeenCalledWith("vscode://anthropic.claude-code/open?session=app0000-0000");
    expect(pager.focus).toBe("other");
    go.mockClear();
    card("app").querySelector<HTMLElement>('[data-step="clear"]')!.click();
    expect(go).not.toHaveBeenCalled();
    store.link = "stale";
    renderCards();
    card("app").querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    expect(go).not.toHaveBeenCalled();
    go.mockRestore();
  });

  it("HANDOFF copies /handoff before navigating and shows the note; RESUME copies the resume prompt", async () => {
    const order: string[] = [];
    const write = vi.fn(() => { order.push("copy"); return Promise.resolve(); });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const go = vi.spyOn(nav, "go").mockImplementation(() => { order.push("go"); });
    put(sess("app", { id: "app0000-0000", fromClear: true }));
    renderCards();
    const c = card("app");
    c.querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    expect(write).toHaveBeenCalledWith("/handoff");
    expect(order).toEqual(["copy", "go"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.querySelector(".note")!.textContent).toBe("Copied /handoff — paste + Enter");
    vi.advanceTimersByTime(4100);
    expect(c.querySelector(".note")!.textContent).toBe("");
    write.mockClear();
    c.querySelector<HTMLElement>('[data-step="resume"]')!.click();
    expect(write).toHaveBeenCalledWith("Continue from the handoff");
    await vi.advanceTimersByTimeAsync(0);
    expect(c.querySelector(".note")!.textContent).toBe("Copied Continue from the handoff — paste + Enter");
    go.mockRestore();
  });

  it("a rejected or missing clipboard shows Type <text> + Enter, and still navigates", async () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    put(sess("app", { id: "app0000-0000" }));
    renderCards();
    const c = card("app");
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) }, configurable: true });
    c.querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.querySelector(".note")!.textContent).toBe("Type /handoff + Enter");
    expect(go).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4100);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    c.querySelector<HTMLElement>('[data-step="handoff"]')!.click();
    expect(c.querySelector(".note")!.textContent).toBe("Type /handoff + Enter");
    go.mockRestore();
  });

  it("Space activates a button like Enter and is default-prevented", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    put(sess("app", { id: "app0000-0000" }));
    renderCards();
    const b = card("app").querySelector<HTMLElement>('[data-step="handoff"]')!;
    const ev = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    b.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(go).toHaveBeenCalledTimes(1);
    go.mockRestore();
  });

  it("an old payload (no ctx, running, handoff, fromClear) renders without CTX and offers HANDOFF", () => {
    put(sess("old", {}));
    renderCards();
    const c = card("old");
    expect(c.querySelector(".ctx")!.textContent).toBe("");
    expect(c.querySelector('[data-step="handoff"]')!.className).toContain("next");
  });

  it("each terminal line gets its glyph", () => {
    put(sess("app", { log: [{ t: T0, text: "Write · src/a.ts" }, { t: T0 + 1, text: "All green?" }] }));
    renderCards();
    expect([...card("app").querySelectorAll(".term .g")].map((g) => g.textContent)).toEqual(["✎", "·"]);
  });

  it("a stalled builder marks its card STALLED; an open tool or the next event clears it", () => {
    put(sess("app", { stage: 3, builders: ["working", "idle", "idle"], lastEventAt: T0 - 3 * 60_000, running: null }));
    renderCards();
    expect(card("app").querySelector(".lb")!.textContent).toMatch(/ · STALLED 3M$/);
    store.sessions.get("app")!.running = { tool: "Bash", since: T0 - 3 * 60_000 };
    renderCards();
    expect(card("app").querySelector(".lb")!.textContent).not.toContain("STALLED");
    store.sessions.get("app")!.running = null;
    store.sessions.get("app")!.lastEventAt = T0;
    renderCards();
    expect(card("app").querySelector(".lb")!.textContent).not.toContain("STALLED");
  });
  it("dock order: strip, cards, tiles, footer", () => {
    const ids = [...document.querySelector("#dock")!.children].map((c) => c.id).filter(Boolean);
    expect(ids.indexOf("models")).toBeLessThan(ids.indexOf("tabs"));
    expect(ids.indexOf("tabs")).toBeLessThan(ids.indexOf("cards"));
    expect(ids.indexOf("cards")).toBeLessThan(ids.indexOf("usage"));
    expect(ids.indexOf("host")).toBeLessThan(ids.indexOf("foot"));
  });

  it("groups by project; labels main / main 2; start order even when the later one waits", () => {
    const u = "vscode://file/Users/p/app";
    put(sess("app", { id: "a0000000-0001", openUrl: u, title: "Fix tools", startedAt: T0 - 5000 }),
      sess("app", { id: "a0000000-0002", openUrl: u, title: "README", status: "waiting", startedAt: T0 }, 1));
    renderCards();
    const g = document.querySelector("#cards .group")!;
    expect([...g.querySelectorAll(".wt")].map((e) => e.textContent!.toLowerCase())).toEqual(["main", "main 2"]);
  });

  it("one project, 4 calm + 1 waiting: 5 full cards in start order, no rows", () => {
    for (let i = 0; i < 5; i++) put(sess("app", { id: `a000000${i}-0000`, openUrl: "vscode://file/x", status: i === 4 ? "waiting" : "active", startedAt: T0 + i }, i));
    renderCards();
    const cards = [...document.querySelectorAll<HTMLElement>("#cards .card")];
    expect(cards.map((c) => c.dataset.id)).toEqual([0, 1, 2, 3, 4].map((i) => `a000000${i}-0000`));
    expect(document.querySelectorAll("#cards .row").length).toBe(0);
  });

  it("tabs keep their order when the other one starts needing you", () => {
    put(sess("first", { id: "f0000000-0000", openUrl: "vscode://file/f", startedAt: T0 }, 0));
    put(sess("second", { id: "s0000000-0000", openUrl: "vscode://file/s", startedAt: T0 + 1 }, 1));
    renderCards();
    const order = () => [...document.querySelectorAll<HTMLElement>("#tabs .tab")].map((t) => t.dataset.name);
    expect(order()).toEqual(["first", "second"]);
    put(sess("second", { id: "s0000000-0000", openUrl: "vscode://file/s", startedAt: T0 + 1, status: "waiting" }, 1));
    renderCards();
    expect(order()).toEqual(["first", "second"]);
  });

  it("overflowing #cards keeps every card full and makes every card .tight", () => {
    const box = document.querySelector<HTMLElement>("#cards")!;
    Object.defineProperty(box, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 500, configurable: true });
    for (let i = 0; i < 4; i++) put(sess("app", { id: `a000000${i}-0000`, openUrl: "vscode://file/x", status: i === 0 ? "waiting" : "active", startedAt: T0 + i }, i));
    renderCards();
    expect(document.querySelectorAll("#cards .card").length).toBe(4);
    expect(document.querySelectorAll("#cards .row").length).toBe(0);
    expect(document.querySelectorAll("#cards .card.tight").length).toBe(4);
  });

  it("only the card whose content overflows its even share goes .tight; the other keeps its terminal", () => {
    put(sess("busy", { id: "b0000000-0000", openUrl: "vscode://file/b", status: "waiting", startedAt: T0 }, 0));
    put(sess("calm", { id: "c0000000-0000", openUrl: "vscode://file/c", startedAt: T0 + 1 }, 1));
    const proto = HTMLElement.prototype, sh = Object.getOwnPropertyDescriptor(proto, "scrollHeight"), ch = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperty(proto, "scrollHeight", { configurable: true, get() { return this.classList?.contains("card") ? (this.dataset.id === "b0000000-0000" ? 400 : 150) : 0; } });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get() { return this.classList?.contains("card") ? 200 : 0; } });
    try {
      renderCards();
      expect([...document.querySelectorAll<HTMLElement>("#cards .card.tight")].map((c) => c.dataset.id)).toEqual(["b0000000-0000"]);
      renderCards(); // memo path keeps it
      expect([...document.querySelectorAll<HTMLElement>("#cards .card.tight")].map((c) => c.dataset.id)).toEqual(["b0000000-0000"]);
    } finally {
      if (sh) Object.defineProperty(proto, "scrollHeight", sh); else delete (proto as { scrollHeight?: number }).scrollHeight;
      if (ch) Object.defineProperty(proto, "clientHeight", ch); else delete (proto as { clientHeight?: number }).clientHeight;
    }
  });

  it("no .tight when the cards fit", () => {
    for (let i = 0; i < 3; i++) put(sess("app", { id: `a000000${i}-0000`, openUrl: "vscode://file/x", status: "waiting", startedAt: T0 + i }, i));
    renderCards();
    expect(document.querySelectorAll("#cards .card.tight").length).toBe(0);
    expect(document.querySelectorAll("#cards .card").length).toBe(3);
  });

  it("3 projects, the last one waiting: 3 tabs, the waiting one marked", () => {
    put(sess("a", {}), sess("b", {}, 1), sess("c", { status: "waiting" }, 2));
    renderCards();
    expect(document.querySelectorAll("#cards .group").length).toBe(1);
    expect(document.querySelectorAll("#tabs .tab").length).toBe(3);
    expect([...document.querySelectorAll("#tabs .tab")].map((t) => t.classList.contains("need"))).toEqual([false, false, true]);
  });

  it("a waiting card glows and shows its action chip and shared label", () => {
    put(sess("app", { status: "waiting", stage: 1, tasksTotal: 3, action: "APPROVE PLAN", msg: "Waiting on you · approve plan (3 tasks)" }));
    renderCards();
    const c = card("app");
    expect(c.className).toContain("st-waiting");
    expect(c.className).toContain("attn");
    expect(c.className).toContain("has-act");
    expect(c.querySelector(".act")!.textContent).toBe("APPROVE PLAN");
    expect(c.querySelector(".lb")!.textContent).toBe("PLAN · NEEDS YOU");
  });

  it("a stale link dims every card and labels it STALE without changing its status", () => {
    store.link = "stale";
    put(sess("app", { status: "waiting", stage: 3, action: "ANSWER" }));
    renderCards();
    const c = card("app");
    expect(c.className).toContain("stale");
    expect(c.className).not.toContain("attn");
    expect(c.querySelector(".lb")!.textContent).toBe("BUILD · STALE");
  });

  it("renders names and terminal lines as text", () => {
    put(sess("<img src=x onerror=alert(1)>", { id: "x0000000-0001", log: [{ t: T0, text: `<script>x</script> & "q"` }] }));
    renderCards();
    expect(document.querySelector("#cards img, #cards script, #tabs img, #tabs script")).toBeNull();
    expect(document.querySelector("#tabs .tab .nm")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector(".term")!.textContent).toContain(`<script>x</script> & "q"`);
  });

  it("the action chip opens only vscode://file/ links and does not refocus the card", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    put(sess("app", { status: "waiting", action: "APPROVE PLAN", openUrl: "vscode://file/Users/p/app" }),
      sess("bad", { status: "waiting", action: "ANSWER", openUrl: "javascript:alert(1)" }, 1));
    pager.focus = "app"; renderCards(); // one project per page: show app's page, then move focus away without re-rendering
    pager.focus = "bad";
    card("app").querySelector<HTMLElement>(".act")!.click();
    expect(go).toHaveBeenCalledWith("vscode://file/Users/p/app");
    expect(pager.focus).toBe("bad");
    go.mockClear();
    renderCards(); // focus follows to bad's page
    card("bad").querySelector<HTMLElement>(".act")!.click();
    expect(go).not.toHaveBeenCalled();
    store.link = "stale";
    pager.focus = "app";
    renderCards();
    card("app").querySelector<HTMLElement>(".act")!.click();
    expect(go).not.toHaveBeenCalled();
    go.mockRestore();
  });
});

describe("footer", () => {
  it("counts sessions and who needs you, and shows server blocked time with the 5 h window on hover", () => {
    put(sess("a", { status: "waiting" }), sess("b", { status: "deny" }, 1), sess("c", {}, 2));
    store.blockedMs = 25 * 60000;
    store.blockedWindowMs = 12 * 60000;
    renderCards(); renderFoot();
    const f = document.querySelector("#foot")!;
    expect(f.textContent).toContain("3 sessions");
    expect(f.textContent).toContain("2 need you");
    const b = [...f.querySelectorAll("span")].find((s) => s.textContent!.includes("blocked"))!;
    expect(b.textContent).toContain("blocked 25m today");
    expect(b.textContent).not.toContain("on you");
    expect(b.title).toBe("Blocked on you 12m in this 5 h window");
  });

  it("needs-you means the human must act: escalated does not count (footer, tabs)", () => {
    put(sess("a", { status: "escalated" }), sess("b", { status: "escalated" }, 1), sess("c", { status: "escalated" }, 2));
    renderCards(); renderFoot();
    expect(document.querySelector("#foot")!.textContent).not.toMatch(/needs? you/);
    expect(document.querySelectorAll("#tabs .tab.need")).toHaveLength(0);
  });

  it("says offline only when the link is offline", () => {
    store.link = "offline";
    renderFoot();
    expect(document.querySelector("#foot")!.textContent).toContain("offline");
  });
});

describe("models", () => {
  it("shows five tiles; a warning tile is amber with its next step on hover", () => {
    store.metrics = { ...METRICS, build: { model: "sonnet", calls: 12, p50: 6000, p95: 28000, signal: "Build pass 58% · split plan tasks smaller", warn: true } };
    renderModels();
    const tiles = document.querySelectorAll<HTMLElement>("#models .mt");
    expect(tiles).toHaveLength(5);
    expect(tiles[1].className).toContain("hot");
    expect(tiles[1].title).toBe("Build pass 58% · split plan tasks smaller");
    expect(tiles[1].querySelector(".l")!.textContent).toBe("p95 28s");
    expect(tiles[0].title).toBe("0 calls · p50 — · p95 —");
  });
});

describe("headline", () => {
  it("shows the offline state with a retry countdown", () => {
    store.link = "offline";
    store.retryAt = T0 + 4000;
    renderHead();
    expect(document.querySelector("#name")!.textContent).toBe("Observer offline");
    expect(document.querySelector("#meta")!.textContent).toContain("RETRY IN 4S");
  });

  it("hero timer shows time in the current state, not session age", () => {
    put(sess("app", { startedAt: T0 - 3 * 3600_000, since: T0 - 5 * 60_000 }));
    pager.focus = "app";
    renderHead();
    const meta = document.querySelector("#meta")!.textContent!;
    expect(meta).toContain("00:05:00");
    expect(meta).not.toContain("03:00:00");
  });

  it("shows the focused session's stage, tasks and attention message", () => {
    put(sess("app", { status: "deny", stage: 3, tasksDone: 1, tasksTotal: 3, msg: "Jev denied B3 · rm -rf <x>" }));
    pager.focus = "app";
    renderHead();
    expect(document.querySelector("#name")!.textContent).toBe("app");
    expect(document.querySelector("#meta")!.textContent).toContain("BUILD");
    expect(document.querySelector("#meta")!.textContent).toContain("TASK 1/3");
    expect(document.querySelector("#msg")!.textContent).toBe("Jev denied B3 · rm -rf <x>");
  });

  it("portrait head: project name and the focused session's meta, even zoomed out", () => {
    document.body.className = "portrait"; ui.portrait = true;
    put(sess("flowobserve", { stage: 2, tasksDone: 1, tasksTotal: 3 }), sess("meadow", {}, 1));
    pager.focus = "flowobserve"; view.zt = 0;
    try {
      renderHead();
      expect(document.querySelector("#name")!.textContent).toBe("flowobserve");
      expect(document.querySelector("#meta")!.textContent).toContain("TASK 1/3");
    } finally { ui.portrait = false; document.body.className = ""; }
  });

  it("landscape head zoomed out keeps the fleet summary", () => {
    put(sess("a", {}), sess("b", {}, 1)); pager.focus = "a"; view.zt = 0;
    renderHead();
    expect(document.querySelector("#name")!.textContent).toBe("2 sessions");
  });
});

describe("card hover and paging", () => {
  const ptr = (el: HTMLElement, type: string, pointerType: string) => { const e = new Event(type); Object.defineProperty(e, "pointerType", { value: pointerType }); el.dispatchEvent(e); };
  it("mouse hover previews the loop; touch never does", () => {
    put(sess("app", { openUrl: "vscode://file/x" }, 0), sess("web", { openUrl: "vscode://file/x" }, 1)); // same project: both cards on the shown page
    pager.focus = "app"; view.zt = 0;
    renderCards();
    ptr(card("web"), "pointerenter", "touch"); vi.advanceTimersByTime(HOVER.inMs + 10);
    expect([pager.focus, view.zt]).toEqual(["app", 0]);
    ptr(card("web"), "pointerenter", "mouse"); vi.advanceTimersByTime(HOVER.inMs + 10);
    expect([pager.focus, view.zt]).toEqual([card("web").dataset.id, 1]);
  });
  it("a manual page flip is not undone by the next render", () => {
    put(sess("a", { name: "a", openUrl: "/p/a" }, 0), sess("b", { name: "b", openUrl: "/p/b" }, 1), sess("c", { name: "c", openUrl: "/p/c" }, 2));
    pager.focus = "a";
    renderCards();
    expect(cpage.pages).toBeGreaterThan(1);
    expect(cpage.i).toBe(0);
    setCardPage(1);
    renderCards(); renderCards();
    expect(cpage.i).toBe(1);
  });
});
