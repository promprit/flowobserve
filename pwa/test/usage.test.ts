import { beforeEach, expect, it, vi } from "vitest";
import type { Kpi } from "@fo/shared";
import { store, ui } from "../src/state";
import { claudeLevel, jevMeter, monthEnd, renderUsage } from "../src/ui/usage";
import { startRingCycle } from "../src/ui/rings";
import { DAYS, clock } from "../src/util";
import { T0, loadDom, reset } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); });
const OCT1 = new Date(2026, 9, 1).getTime();
const usage = (usedUsd: number, at = T0) => ({
  session: { used: 0.5, startedAt: T0 - 3600e3, windowMs: 5 * 3600e3 },
  weekly: { used: 0.3, resetsAt: T0 + 3 * 86400e3 },
  jev: { usedUsd, budgetUsd: 5, monthStart: OCT1 },
  at,
});

it("Claude meters warn at 15 pts ahead of pace or 80 %, go red at 95 %", () => {
  expect(claudeLevel(0.96, 0.99)).toBe("crit");
  expect(claudeLevel(0.81, 0.9)).toBe("warn");
  expect(claudeLevel(0.5, 0.3)).toBe("warn");
  expect(claudeLevel(0.4, 0.3)).toBe("");
});

it("the Jev meter paces against the calendar month and warns only > 10 pts ahead", () => {
  expect(monthEnd(OCT1)).toBe(new Date(2026, 10, 1).getTime());
  const mid = new Date(2026, 9, 11).getTime(); // 10 of 31 days elapsed
  expect(jevMeter({ usedUsd: 3, budgetUsd: 5, monthStart: OCT1 }, mid)).toMatchObject({ used: 0.6, warn: true });
  expect(jevMeter({ usedUsd: 2, budgetUsd: 5, monthStart: OCT1 }, mid).warn).toBe(false);
  expect(jevMeter({ usedUsd: 2, budgetUsd: 5, monthStart: OCT1 }, mid).pace).toBeCloseTo(10 / 31);
});

it("renders budgets as tiles: a session/weekly pair, Fable, Jev numeral; 3 hairlines with pace notch", () => {
  store.usage = { ...usage(4.5), fable: { used: 0.42, resetsAt: T0 + 2 * 86400e3 } };
  renderUsage();
  const el = document.querySelector("#usage")!;
  expect(el.querySelectorAll(".tile")).toHaveLength(3);
  expect(el.querySelectorAll(".tile.pair .r.limit")).toHaveLength(2);
  expect(el.querySelectorAll(".limit .hl s")).toHaveLength(3);
  expect(el.querySelectorAll(".limit .hl u")).toHaveLength(3);
  expect(el.querySelector(".tile.num .big")!.textContent).toMatch(/^\$\d+\.\d\d$/);
});

it("weekly ahead of pace says so in words, in amber", () => {
  store.usage = { ...usage(1), weekly: { used: 0.9, resetsAt: T0 + 3 * 86400e3 } };
  renderUsage();
  const w = [...document.querySelectorAll("#usage .r.limit")].find((t) => t.textContent!.includes("WEEKLY"))!;
  expect(w.classList.contains("hot")).toBe(true);
  expect(w.textContent).toContain("AHEAD OF PACE");
});

it("single account with no weekly limit: WEEKLY row says NO WEEKLY LIMIT, no bar, not hot", () => {
  store.usage = { ...usage(1), weekly: null };
  expect(() => renderUsage()).not.toThrow();
  const w = [...document.querySelectorAll("#usage .r.limit")].find((t) => t.textContent!.includes("WEEKLY"))!;
  expect(w.textContent).toContain("NO WEEKLY LIMIT");
  expect(w.querySelector(".hl")).toBeNull();
  expect(w.classList.contains("hot")).toBe(false);
  expect(w.textContent).not.toContain("%");
});

it("session secondary is time left as h:mm", () => {
  store.usage = { ...usage(1), session: { used: 0.1, startedAt: T0 - 3600e3, windowMs: 5 * 3600e3 } };
  renderUsage();
  expect(document.querySelector("#usage .r .s")!.textContent).toBe("IN 4:00");
});

it("the Jev tile carries its next step on hover and its reset", () => {
  store.usage = usage(4.5);
  renderUsage();
  const ms = document.querySelectorAll<HTMLElement>("#usage .tile");
  expect(ms).toHaveLength(2);
  expect(ms[1].className).toContain("num");
  expect(ms[1].className).toContain("hot");
  expect(ms[1].title).toBe("Jev ahead of pace · run /tune");
  expect(ms[1].textContent).toContain("$4.50");
  expect(ms[1].textContent).toContain("AHEAD OF PACE");
  store.usage = usage(0.1);
  renderUsage();
  expect(document.querySelectorAll<HTMLElement>("#usage .tile")[1].textContent).toContain("OF $5");
  expect(document.querySelector("#usage")!.className).not.toContain("dim");
});

it("stale Claude meters dim and say when they were read; the live Jev tile stays lit", () => {
  const at = T0 - 5 * 3600e3 - 1;
  store.usage = { ...usage(1, at), session: { used: 0.5, startedAt: T0 - 3600e3, windowMs: 5 * 3600e3 } };
  renderUsage();
  const el = document.querySelector("#usage")!;
  expect(el.className).not.toContain("dim");
  expect(el.querySelector(".tile.pair")!.className).toContain("stale");
  expect(el.querySelector(".tile.num")!.className).not.toContain("stale");
  const asOf = `AS OF ${DAYS[new Date(at).getDay()]} ${clock(at)}`;
  for (const s of el.querySelectorAll(".r.limit .s")) expect(s.textContent).toBe(asOf);
});

it("a session window that already reset shows no number, not a frozen 0:00", () => {
  const at = T0 - 6 * 3600e3;
  store.usage = { ...usage(1, at), session: { used: 0.25, startedAt: T0 - 6 * 3600e3, windowMs: 5 * 3600e3 } };
  renderUsage();
  const s = document.querySelector("#usage .r.limit")!;
  expect(s.querySelector(".n")!.textContent).toBe("—");
  expect(s.querySelector(".hl s")!.getAttribute("style")).toContain("width:0.0%");
  expect(s.textContent).not.toContain("0:00");
});

it("fresh data is not stale even if old-looking fields are fine", () => {
  store.usage = usage(1);
  renderUsage();
  expect(document.querySelector("#usage .tile.pair")!.className).not.toContain("stale");
});

it("a zero Jev budget renders 0% without NaN", () => {
  expect(jevMeter({ usedUsd: 1, budgetUsd: 0, monthStart: OCT1 }, T0).used).toBe(0);
  store.usage = { ...usage(1), jev: { usedUsd: 1, budgetUsd: 0, monthStart: OCT1 } };
  renderUsage();
  const t = document.querySelectorAll("#usage .tile")[1].textContent!;
  expect(t).toContain("$1.00");
  expect(t).not.toContain("NaN");
});

it("before the first statusline payload the row still renders a clickable placeholder", () => {
  renderUsage();
  expect(document.querySelector("#usage")!.textContent).toBe("USAGE · NO DATA YET");
});

const keys = () => [...document.querySelectorAll("#usage .cap")].map((k) => k.textContent!.trim());

it("renders a Fable meter when usage.fable is present", () => {
  const resetsAt = T0 + 2 * 86400e3;
  store.usage = { ...usage(1), fable: { used: 0.42, resetsAt } };
  renderUsage();
  const ms = document.querySelectorAll<HTMLElement>("#usage .tile");
  expect(ms).toHaveLength(3);
  expect(keys()).toEqual(["SESSION 5H", "WEEKLY", "FABLE", "JEV"]);
  const f = ms[1];
  expect(f.className).toContain("fable");
  expect(f.textContent).toContain("42%");
  expect(f.querySelector(".hl s")).not.toBeNull();
  expect(f.querySelector(".hl u")).not.toBeNull();
  expect(f.querySelector(".cap .dot")).not.toBeNull();
  const d = new Date(resetsAt);
  const day = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()];
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  expect(f.querySelector(".s")!.textContent).toBe(`${day} ${hhmm}`);
  expect(ms[2].className).toContain("num");
  expect(ms[0].querySelector(".dot")).toBeNull();
});

it("renders exactly three meters when usage.fable is null or absent", () => {
  store.usage = { ...usage(1), fable: null };
  renderUsage();
  expect(document.querySelectorAll("#usage .tile")).toHaveLength(2);
  expect(keys()).toEqual(["SESSION 5H", "WEEKLY", "JEV"]);
  store.usage = usage(1);
  renderUsage();
  expect(document.querySelectorAll("#usage .tile")).toHaveLength(2);
  expect(document.querySelector("#usage .fable")).toBeNull();
});

it("the Jev tile adds one quiet judge-share and cost-per-task line; hot only when EXE-M2 warns", () => {
  const kp = (o: Partial<Kpi>): Kpi => ({ id: "EXE-M2", tile: "usage", value: 0.03, unit: "pct", healthy: "<5%", window: "7d", n: 1, ready: true, warn: false, next: null, ...o });
  store.usage = usage(1);
  store.kpis = [kp({}), kp({ id: "EXE-M3", unit: "usd", value: 1.8, window: "30d", healthy: "trend" })];
  renderUsage();
  const line = () => document.querySelector("#usage .tile.num .s.kpi");
  expect(line()!.textContent).toBe("3% OF SPEND · $1.80/TASK");
  expect(line()!.classList.contains("hot")).toBe(false);
  store.kpis = [kp({ value: 0.08, warn: true, next: "judge asked too often; check judged share in /tune" })];
  renderUsage();
  expect(line()!.textContent).toBe("8% OF SPEND");
  expect(line()!.classList.contains("hot")).toBe(true);
  store.kpis = [kp({ value: null, ready: false })];
  renderUsage();
  expect(line()).toBeNull();
});

it("a hot Jev tile (budget pace) does not make the KPI line hot when EXE-M2 is fine", () => {
  const kp: Kpi = { id: "EXE-M2", tile: "usage", value: 0.03, unit: "pct", healthy: "<5%", window: "7d", n: 1, ready: true, warn: false, next: null };
  store.usage = usage(4.5);
  store.kpis = [kp];
  renderUsage();
  const tile = document.querySelector("#usage .tile.num")!;
  expect(tile.classList.contains("hot")).toBe(true);
  expect(tile.querySelector(".s.kpi")!.classList.contains("hot")).toBe(false);
});

const acct = (label: string, used: number, at = T0, extra: object = {}) => ({
  label, session: { used, startedAt: T0 - 3600e3, windowMs: 5 * 3600e3 }, weekly: { used: 0.3, resetsAt: T0 + 3 * 86400e3 }, at, ...extra,
});

it("several accounts: one rings tile and the Jev tile; no pair, no Fable tile, no switch hint", () => {
  store.usage = { ...usage(0.1), fable: { used: 0.3, resetsAt: T0 + 4 * 86400e3 },
    accounts: [acct("Team", 0.92, T0, { primary: true, near: true }), acct("Pro", 0.1)], switch: { from: "Team", to: "Pro", used: 0.92 } };
  renderUsage();
  const el = document.querySelector<HTMLElement>("#usage")!;
  expect([...el.children].map((c) => c.className)).toEqual(["tile claude", "tile num"]);
  expect(el.classList.contains("multi")).toBe(true);
  expect(el.querySelectorAll(".tile.claude .rings .rcol")).toHaveLength(2);
  expect(el.querySelector(".tile.claude .rcol .you")).not.toBeNull();
  expect(el.querySelectorAll(".tile.pair, .tile.fable, .sw")).toHaveLength(0);
  expect(el.textContent).not.toContain("/handoff");
  expect(el.querySelector(".tile.num .big")!.textContent).toBe("$0.10");
});

it("several accounts without Jev: the rings tile alone", () => {
  store.usage = { ...usage(1), jev: null, accounts: [acct("Team", 0.5, T0, { primary: true }), acct("Pro", 0.1)] };
  renderUsage();
  const el = document.querySelector<HTMLElement>("#usage")!;
  expect([...el.children].map((c) => c.className)).toEqual(["tile claude"]);
  expect(el.classList.contains("nojev")).toBe(true);
});

it("8 accounts: four columns, the 4th follows the cycle counter", () => {
  const L = ["Team", "Pro", "Lab", "Client", "Personal", "Research", "Ops", "Sandbox"];
  store.usage = { ...usage(1), accounts: L.map((l, i) => acct(l, 0.1, T0, i ? {} : { primary: true })) };
  ui.cycle = 2;
  renderUsage();
  const al = [...document.querySelectorAll("#usage .rcol .al")].map((x) => x.textContent);
  expect(al).toEqual(["Team", "Pro", "Lab", "Research"]);
});

it("without accounts: one unlabelled pair, as before", () => {
  store.usage = usage(1);
  renderUsage();
  expect(document.querySelectorAll("#usage .tile.pair")).toHaveLength(1);
  expect(document.querySelector("#usage .al")).toBeNull();
  expect(document.querySelector("#usage")!.className).not.toContain("multi");
});

it("single account: today's markup, byte for byte (captured before the rings change)", () => {
  store.usage = { ...usage(1.84), fable: { used: 0.3, resetsAt: T0 + 4 * 86400e3 } };
  store.kpis = [{ id: "EXE-M3", tile: "usage", value: 0.06, unit: "usd", healthy: "", window: "30d", n: 5, ready: true, warn: false, next: null }];
  renderUsage();
  expect(document.querySelector("#usage")!.outerHTML).toMatchInlineSnapshot(`"<div id="usage" role="button" tabindex="0" aria-label="Usage, open spend drawer" class="four" title="Click for spend by project and model"><div class="tile pair"><div class="r limit hot"><span class="cap">SESSION 5H</span><span class="n">50%</span><div class="hl"><s style="width:50.0%"></s><u style="left:20.0%"></u></div><span class="s"><b>AHEAD OF PACE</b></span></div><div class="r limit"><span class="cap">WEEKLY</span><span class="n">30%</span><div class="hl"><s style="width:30.0%"></s><u style="left:57.1%"></u></div><span class="s">TUE 10:00</span></div></div><div class="tile limit fable"><div class="top"><span class="cap"><i class="dot"></i>FABLE</span><span class="n">30%</span></div><div class="hl"><s style="width:30.0%"></s><u style="left:42.9%"></u></div><div class="s">WED 10:00</div></div><div class="tile num hot" title="Jev ahead of pace · run /tune"><span class="cap">JEV</span><span class="big">$1.84</span><div class="s"><b>AHEAD OF PACE</b></div><div class="s kpi" title="EXE-M3 $0.06 · healthy  · 30d · n=5">$0.06/TASK</div></div></div>"`);
});

it("the 4th column cycles every 8 s with a 0.35 s fade, only from 5 accounts; no fade under reduced motion", () => {
  const L = ["Team", "Pro", "Lab", "Client", "Personal"];
  store.usage = { ...usage(1), accounts: L.slice(0, 4).map((l, i) => acct(l, 0.1, T0, i ? {} : { primary: true })) };
  ui.cycle = 0; ui.reduce = false;
  renderUsage();
  const stop = startRingCycle(renderUsage);
  vi.advanceTimersByTime(8000 + 400);
  expect(ui.cycle).toBe(0);                                   // 4 accounts: nothing cycles
  store.usage = { ...store.usage!, accounts: L.map((l, i) => acct(l, 0.1, T0, i ? {} : { primary: true })) };
  renderUsage();
  vi.advanceTimersByTime(8000 - 400);
  expect(document.querySelector("#usage .rcol.cyc")!.classList.contains("out")).toBe(true);
  expect(ui.cycle).toBe(0);
  vi.advanceTimersByTime(350);
  expect(ui.cycle).toBe(1);
  const c = document.querySelector("#usage .rcol.cyc")!;
  expect(c.querySelector(".al")!.textContent).toBe("Personal");
  expect(c.classList.contains("out")).toBe(false);
  expect(c.classList.contains("in")).toBe(true);
  ui.reduce = true;
  vi.advanceTimersByTime(8000);
  expect(ui.cycle).toBe(2);
  expect(document.querySelector("#usage .rcol.cyc")!.classList.contains("in")).toBe(false);
  stop(); ui.reduce = false;
});
