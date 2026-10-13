import { beforeEach, describe, expect, it, vi } from "vitest";
import { store, ui } from "../src/state";
import { type FetchFn, byProject, closeDrawer, drawerBottom, drawerOpen, openDrawer, spendHints } from "../src/ui/drawer";
import { T0, loadDom, reset } from "./helpers";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); loadDom(); closeDrawer(); });

const rows = [
  { project: "app", model: "claude-opus-5-5", source: "claude" as const, usd: 6.2 },
  { project: "web", model: "claude-opus-5-5", source: "claude" as const, usd: 3.8 },
  { project: "web", model: "claude-sonnet-5-5", source: "claude" as const, usd: 1 },
  { project: "unattributed", model: "jev-1.13", source: "jev" as const, usd: 0.5 },
];
const ok = (body: unknown): FetchFn => vi.fn(async () => ({ ok: true, json: async () => body }));
const drawer = () => document.querySelector<HTMLElement>("#drawer")!;

describe("spendHints", () => {
  it("names a project that uses ≥ 50 % of a model family's spend, with its next step", () => {
    expect(spendHints(rows)).toEqual(["app uses 62% of Opus spend · check escalations"]);
  });
  it("needs two projects, skips unattributed Jev spend, and maps Jev to /tune", () => {
    expect(spendHints(rows.slice(2))).toEqual([]);
    expect(spendHints([
      { project: "app", model: "jev-1.13", source: "jev", usd: 3 },
      { project: "web", model: "jev-1.13", source: "jev", usd: 1 },
    ])).toEqual(["app uses 75% of Jev spend · run /tune"]);
  });
  it("stays quiet while a family's spend is under $1", () => {
    expect(spendHints([
      { project: "app", model: "jev-1.13", source: "jev", usd: 0.03 },
      { project: "web", model: "jev-1.13", source: "jev", usd: 0.0005 },
    ])).toEqual([]);
  });
});

describe("byProject", () => {
  it("puts Claude and Jev side by side, biggest first", () => {
    expect(byProject(rows)).toEqual([
      { project: "app", claude: 6.2, jev: 0 },
      { project: "web", claude: 4.8, jev: 0 },
      { project: "unattributed", claude: 0, jev: 0.5 },
    ]);
  });
});

describe("drawer", () => {
  it("fetches the range, labels Claude as API-equivalent and escapes names", async () => {
    store.spendBase = "http://h";
    const f = ok({ rows: [...rows, { project: "<b>x</b>", model: "m", source: "claude", usd: 0.1 }], totalUsd: 11.6 });
    await openDrawer("7d", f);
    expect(f).toHaveBeenCalledWith("http://h/spend?range=7d", expect.objectContaining({ signal: expect.anything() }));
    expect(drawerOpen()).toBe(true);
    expect(drawer().textContent).toContain("API-EQUIVALENT");
    expect(drawer().textContent).toContain("app uses 62% of Opus spend · check escalations");
    expect(drawer().innerHTML).not.toContain("<b>x</b>");
    expect(drawer().querySelector(".dr-tabs b.on")!.textContent).toBe("7 D");
  });

  it("hides rows that would show $0.00 in every column", async () => {
    store.spendBase = "http://h";
    await openDrawer("today", ok({ rows: [...rows, { project: "Dev", model: "claude-haiku-4-5", source: "claude", usd: 0.004 }], totalUsd: 11.504 }));
    expect(drawer().textContent).not.toContain("Dev");
    expect(drawer().textContent).not.toContain("claude-haiku-4-5");
    expect(drawer().textContent).toContain("unattributed");
  });

  it("shows SPEND UNAVAILABLE when /spend fails", async () => {
    store.spendBase = "http://h";
    await openDrawer("today", vi.fn(async () => { throw new Error("down"); }));
    expect(drawer().textContent).toContain("SPEND UNAVAILABLE");
    await openDrawer("today", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(drawer().textContent).toContain("SPEND UNAVAILABLE");
  });

  it("ignores a slow answer for a tab the user already left", async () => {
    store.spendBase = "http://h";
    let release!: () => void;
    const slow: FetchFn = vi.fn(() => new Promise<{ ok: boolean; json(): Promise<unknown> }>((r) => { release = () => r({ ok: true, json: async () => ({ rows: [{ project: "slow", model: "m", source: "claude", usd: 1 }], totalUsd: 1 }) }); }));
    const first = openDrawer("today", slow);
    await openDrawer("month", ok({ rows: [{ project: "fast", model: "m", source: "claude", usd: 2 }], totalUsd: 2 }));
    release();
    await first;
    expect(drawer().textContent).toContain("fast");
    expect(drawer().textContent).not.toContain("slow");
  });

  it("explains that demo mode has no spend data", async () => {
    await openDrawer("today", ok({ rows: [], totalUsd: 0 }));
    expect(drawer().textContent).toContain("NO SPEND DATA IN DEMO");
  });
});

describe("without Jev", () => {
  it("the report has no JEV total and no JEV column", async () => {
    store.spendBase = "http://x";
    store.jev = false;
    await openDrawer("today", ok({ rows: rows.slice(0, 3) }));
    expect(drawer().textContent).not.toContain("JEV");
    expect(drawer().querySelectorAll(".dr-t.two").length).toBe(2);
    expect(drawer().textContent).toContain("CLAUDE");
    store.jev = true;
  });
});

describe("placeDrawer", () => {
  const top = (sel: string, v: number) => Object.defineProperty(document.querySelector(sel)!, "offsetTop", { configurable: true, value: v });
  it("ends above the usage tiles in landscape and above the slim row in portrait", async () => {
    Object.defineProperty(document.querySelector("#dock")!, "clientHeight", { configurable: true, value: 1000 });
    top("#usage", 700); top("#slim", 900);
    await openDrawer("today");
    expect(drawer().style.bottom).toBe("312px");
    closeDrawer();
    ui.portrait = true;
    await openDrawer("today");
    expect(drawer().style.bottom).toBe("112px");
  });
  it("never goes negative", () => expect(drawerBottom(100, 400)).toBe(12));
});
