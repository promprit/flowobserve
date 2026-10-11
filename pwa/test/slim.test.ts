import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Host, Kpi, Usage } from "@fo/shared";
import { store, ui } from "../src/state";
import { hostSlim, renderSlim, usageCells } from "../src/ui/slim";
import { T0, loadDom, reset } from "./helpers";

const U: Usage = {
  session: { used: 0.02, startedAt: T0 - (5 * 3600e3 - (4 * 60 + 51) * 60e3), windowMs: 5 * 3600e3 },
  weekly: { used: 0.3, resetsAt: Date.parse("2026-10-04T10:00:00Z") },
  jev: { usedUsd: 0.33, budgetUsd: 5, monthStart: Date.parse("2026-09-30T17:00:00Z") },
  fable: { used: 0.02, resetsAt: Date.parse("2026-10-04T09:59:00Z") }, at: T0,
};
const H = (o: Partial<Host> = {}): Host => ({ at: T0, cpu: 0.94, gpu: 0.17, mem: { used: 0.79, pressure: "normal" },
  disks: [{ label: "sys", path: "/", used: 0.97, freeBytes: 25e9 }, { label: "External", path: "/Volumes/External", used: 0.04, freeBytes: 958e9 }], ...o });
const M3: Kpi = { id: "EXE-M3", tile: "usage", value: 2.64, unit: "usd", healthy: "", window: "30d", n: 5, ready: true, warn: false, next: null };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); });

const view = (c: { k: string; v: string; n: string }) => [c.k, c.v, c.n];

describe("usageCells", () => {
  it("every usage cell, exact copy and fill", () => {
    const c = usageCells(U, [], T0);
    expect(c.map(view)).toEqual([["5H", "2%", "4:51"], ["WEEK", "30%", "SUN 17:00"], ["FABLE", "2%", "SUN 16:59"], ["JEV", "$0.33", "OF $5"]]);
    expect(c.map((x) => x.fill)).toEqual([0.02, 0.3, 0.02, 0.33 / 5]);
    expect(c.map((x) => x.dot)).toEqual([undefined, undefined, true, undefined]);
  });
  it("no Fable cell without usage.fable", () => expect(usageCells({ ...U, fable: undefined }, [], T0).map((c) => c.k)).toEqual(["5H", "WEEK", "JEV"]));
  it("has no JEV cell without Jev", () => expect(usageCells({ ...U, jev: null }, [M3], T0).map((c) => c.k)).toEqual(["5H", "WEEK", "FABLE"]));
  it("cost per task when EXE-M3 is ready", () => expect(usageCells(U, [M3], T0).at(-1)!.n).toBe("OF $5 · $2.64/TASK"));
  it("window already reset: dash, no fill", () => {
    const c = usageCells({ ...U, session: { ...U.session, startedAt: T0 - 6 * 3600e3 } }, [], T0)[0];
    expect([c.v, c.fill, c.dim]).toEqual(["—", null, true]);
  });
  it("never amber; stale Claude cells dim, Jev not", () => {
    const c = usageCells({ ...U, at: T0 - 6 * 3600e3 }, [], T0);
    expect(c.every((x) => !x.hot)).toBe(true);
    expect(c.slice(0, 3).every((x) => x.dim)).toBe(true);
    expect(c.at(-1)!.dim).toBe(false);
  });
  it("no data", () => expect(usageCells(null, [], T0)).toEqual([{ k: "USAGE", v: "NO DATA YET", n: "", fill: null, hot: false, dim: true }]));
});

describe("hostSlim", () => {
  it("cells, copy and fill", () => {
    const c = hostSlim(H(), 0.5, 0.17);
    expect(c.map(view)).toEqual([["CPU", "94%", "GPU 17%"], ["MEM", "79%", ""], ["SYS", "25 GB", "LOW"], ["EXTERNAL", "958 GB", "FREE"]]);
    expect(c.map((x) => x.fill)).toEqual([0.94, 0.79, 0.97, 0.04]);
  });
  it("amber thresholds", () => {
    const hot = (h: Host, avg: number) => hostSlim(h, avg, h.gpu).filter((c) => c.hot).map((c) => c.k);
    expect(hot(H(), 0.86)).toEqual(["CPU", "SYS"]);
    expect(hot(H(), 0.85)).toEqual(["SYS"]);
    expect(hot(H({ mem: { used: 0.86, pressure: "normal" } }), 0)).toContain("MEM");
    const w = hostSlim(H({ mem: { used: 0.5, pressure: "warn" } }), 0, 0.1).find((c) => c.k === "MEM")!;
    expect([w.hot, w.n]).toEqual([true, "PRESSURE"]);
  });
  it("offline disk dim; no GPU sample", () => {
    const c = hostSlim(H({ disks: [{ label: "External", path: "/V", used: null, freeBytes: null }] }), 0, null);
    expect(c.at(-1)).toEqual({ k: "EXTERNAL", v: "OFFLINE", n: "", fill: null, hot: false, dim: true });
    expect(c[0].n).toBe("GPU —");
  });
});

describe("renderSlim", () => {
  it("portrait: two line groups (usage, hardware); landscape: hidden", () => {
    ui.portrait = true; document.body.className = "portrait"; store.usage = U; store.host = H();
    renderSlim();
    const el = document.querySelector<HTMLElement>("#slim")!;
    expect(el.hidden).toBe(false);
    expect(el.querySelectorAll(":scope > div")).toHaveLength(2);
    expect(el.querySelectorAll(".c")).toHaveLength(8);
    expect(el.querySelectorAll(".c.hot .m s")).toHaveLength(1);
    ui.portrait = false; renderSlim();
    expect(el.hidden).toBe(true);
  });
  it("four disks keep two rows", () => {
    ui.portrait = true; document.body.className = "portrait"; store.usage = U;
    store.host = H({ disks: [1, 2, 3, 4].map((i) => ({ label: `d${i}`, path: `/d${i}`, used: 0.1, freeBytes: 5e11 })) });
    renderSlim();
    const el = document.querySelector<HTMLElement>("#slim")!;
    const rows = el.querySelectorAll<HTMLElement>(".sr");
    expect(rows).toHaveLength(2);
    expect(rows[1].style.getPropertyValue("--cols")).toBe("6");
    expect(el.querySelectorAll(".r")).toHaveLength(0);
  });
});
