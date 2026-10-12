import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Spec §11 fit rules: several accounts take exactly the room one account takes, in both orientations.
// The board is fed one snapshot over a routed WebSocket (no server state involved).
const SIZES = [[1920, 1080], [1080, 1920], [1440, 2560]] as const;
const COUNTS = [1, 2, 4, 8] as const;
const SHOTS = path.resolve("../.superpowers/sdd/shots"); // playwright runs from pwa/

const LABELS = ["Team", "Pro", "Lab", "Client", "Personal", "Research", "Ops", "Sandbox-very-long-name"];
const USED = [[0.92, 0.4], [0.12, 0.2], [0.45, 0.3], [0.67, 0.55], [0.05, 0.1], [0.3, 0.92], [0.5, 0.5], [0.2, 0.2]];

function snapshot(n: number, now: number) {
  const acc = (i: number) => ({
    label: LABELS[i], session: { used: USED[i][0], startedAt: now - 3600e3, windowMs: 5 * 3600e3 },
    weekly: { used: USED[i][1], resetsAt: now + 3 * 86400e3 }, at: now, ...(i === 0 ? { primary: true } : {}), near: USED[i][0] >= 0.9,
  });
  const accounts = Array.from({ length: n }, (_, i) => acc(i));
  const metric = { model: "x", calls: 0, p50: null, p95: null, signal: null, warn: false };
  const kpi = (id: string, value: number, unit: string) => ({ id, tile: "usage", value, unit, healthy: "", window: "30d", n: 10, ready: true, warn: false, next: null });
  return {
    type: "snapshot", sessions: [], blockedMs: 0, blockedWindowMs: 0,
    metrics: { plan: metric, build: metric, judge: metric, escalate: metric, review: metric },
    kpis: [kpi("EXE-M2", 0.03, "pct"), kpi("EXE-M3", 0.06, "usd")],
    host: { at: now, cpu: 0.23, gpu: 0.12, mem: { used: 0.61, pressure: "normal" }, disks: [
      { label: "System", path: "/", used: 0.58, freeBytes: 412e9 }, { label: "SSD", path: "/Volumes/SSD", used: 0.4, freeBytes: 1.2e12 }] },
    usage: {
      session: accounts[0].session, weekly: accounts[0].weekly, at: now,
      jev: { usedUsd: 1.84, budgetUsd: 5, monthStart: now - 5 * 86400e3 }, fable: { used: 0.3, resetsAt: now + 4 * 86400e3 },
      ...(n > 1 ? { accounts, switch: { from: "Team", to: "Pro", used: 0.92 } } : {}),
    },
  };
}

type Box = { x: number; y: number; w: number; h: number };
interface Fit {
  areas: Record<string, Box>; cols: number; colW: number[];
  outside: string[]; cut: string[]; overlaps: string[];
  row1: Box[]; row2: Box[];
  /** Bottom of the glyph box of the first account label and of the Jev caption (same font and size: equal = same baseline). */
  labelBottom: number | null; jevBottom: number | null;
  /** Left of each column vs left of its first label text (no stray indent before a label without the dot). */
  labelInset: number[];
}

async function measure(page: Page, sel: string[]): Promise<Fit> {
  return page.evaluate((sels) => {
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const name = (e: Element) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} "${(e.textContent ?? "").slice(0, 20)}"`;
    const areas: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const outside: string[] = [], cut: string[] = [], overlaps: string[] = [];
    for (const s of sels) {
      const a = document.querySelector(s)!, A = box(a);
      areas[s] = A;
      for (const e of a.querySelectorAll("*")) {
        const b = box(e);
        if (b.w === 0 && b.h === 0) continue;
        if (b.x < A.x - 1 || b.y < A.y - 1 || b.x + b.w > A.x + A.w + 1 || b.y + b.h > A.y + A.h + 1) outside.push(`${s} ${name(e)}`);
        const he = e as HTMLElement;
        if (he.clientWidth > 0 && he.scrollWidth > he.clientWidth + 1 && getComputedStyle(he).textOverflow !== "ellipsis") cut.push(`${s} ${name(e)} ${he.scrollWidth}>${he.clientWidth}`);
      }
      // Leaves that must never overlap each other: rings, ring captions, labels, slim cells, disk lines.
      const leaves = [...a.querySelectorAll(".ring, .rg .cap, .rcol .hd, .c, .dl, .tile.arcs .a, .tile.num .big, .tile.num .s")];
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
        const p = leaves[i], q = leaves[j];
        if (p.contains(q) || q.contains(p)) continue;
        const r = box(p), t = box(q);
        const ox = Math.min(r.x + r.w, t.x + t.w) - Math.max(r.x, t.x), oy = Math.min(r.y + r.h, t.y + t.h) - Math.max(r.y, t.y);
        if (ox > 1 && oy > 1) overlaps.push(`${name(p)} × ${name(q)}`);
      }
    }
    const cols = [...document.querySelectorAll(sels.map((s) => `${s} .rcol`).join(","))];
    const rows = [...document.querySelectorAll("#slim > .sr")];
    const kids = (r: Element | undefined) => (r ? [...r.children].map(box) : []);
    const glyph = (e: Element | null) => { if (!e?.firstChild) return null; const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
    const jev = [...document.querySelectorAll(sels.map((s) => `${s} .tile.num>.cap, ${s} .c .k`).join(","))].find((k) => k.textContent === "JEV") ?? null;
    const al = document.querySelector(sels.map((s) => `${s} .rcol .al`).join(","));
    const labelInset = cols.filter((c) => !c.querySelector(".you")).map((c) => glyph(c.querySelector(".al"))!.left - box(c).x);
    return { areas, cols: cols.length, colW: cols.map((c) => box(c).w), outside, cut, overlaps, row1: kids(rows[0]), row2: kids(rows[1]),
      labelBottom: glyph(al)?.bottom ?? null, jevBottom: glyph(jev)?.bottom ?? null, labelInset };
  }, sel);
}

for (const [w, h] of SIZES) {
  const portrait = h > w;
  test(`${w}x${h}: 1, 2, 4 and 8 accounts fit the room one account takes`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "sizes are set per test");
    test.setTimeout(60_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: w, height: h });
    const areas = portrait ? ["#slim"] : ["#usage", "#host"];
    let base: Record<string, Box> | null = null, cur = 1;
    await page.routeWebSocket("**/ws", (ws) => { ws.send(JSON.stringify(snapshot(cur, Date.now()))); });
    for (const n of COUNTS) {
      cur = n;
      await page.goto("/");
      await page.waitForSelector(portrait ? "#slim .sr + .sr" : "#host .tile");
      if (n > 1) await page.waitForSelector(portrait ? "#slim .rcol" : "#usage .rcol");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const f = await measure(page, areas);
      await page.locator("#dock").screenshot({ path: path.join(SHOTS, `fit-${w}x${h}-n${n}.png`) });
      const tag = `${w}x${h} n=${n}`;
      base ??= f.areas;
      for (const a of areas) expect(Math.abs(f.areas[a].h - base[a].h), `${tag} ${a} height ${f.areas[a].h} vs ${base[a].h}`).toBeLessThanOrEqual(1);
      expect(f.outside, `${tag} outside its area`).toEqual([]);
      expect(f.cut, `${tag} clipped without an ellipsis`).toEqual([]);
      expect(f.overlaps, `${tag} overlaps`).toEqual([]);
      expect(f.cols, `${tag} Claude columns`).toBe(n === 1 ? 0 : Math.min(n, 4));
      if (f.colW.length) expect(Math.max(...f.colW) - Math.min(...f.colW), `${tag} equal columns ${f.colW}`).toBeLessThanOrEqual(1);
      if (n > 1) expect(Math.abs(f.labelBottom! - f.jevBottom!), `${tag} account label and JEV share a baseline`).toBeLessThanOrEqual(1);
      if (portrait) for (const x of f.labelInset) expect(Math.abs(x), `${tag} label starts at its column edge`).toBeLessThanOrEqual(1);
      if (portrait) {
        const [a, b] = [f.row1, f.row2];
        expect(Math.abs(a[0].x - b[0].x), `${tag} left edges`).toBeLessThanOrEqual(1);
        const r = (x: Box) => x.x + x.w;
        expect(Math.abs(r(a[a.length - 1]) - r(b[b.length - 1])), `${tag} right edges`).toBeLessThanOrEqual(1);
        if (n > 1) expect(Math.abs(r(a[0]) - r(b[2])), `${tag} rings end where the 3rd column ends`).toBeLessThanOrEqual(1);
      } else {
        const [u, ho] = [f.areas["#usage"], f.areas["#host"]];
        expect(Math.abs(u.x - ho.x) + Math.abs(u.x + u.w - ho.x - ho.w), `${tag} usage and host edges`).toBeLessThanOrEqual(1);
      }
    }
  });
}

test("8 accounts: the 4th column moves on to the next account within 8 s, with a fade", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.routeWebSocket("**/ws", (ws) => { ws.send(JSON.stringify(snapshot(8, Date.now()))); });
  await page.goto("/");
  const cyc = page.locator("#usage .rcol.cyc");
  await expect(cyc.locator(".al")).toHaveText("Client");
  // The fade-out lasts 0.35 s: record it with an observer rather than hoping a poll lands inside it.
  await page.evaluate(() => {
    const w = window as unknown as { faded: boolean };
    w.faded = false;
    new MutationObserver(() => { if (document.querySelector("#usage .rcol.cyc.out")) w.faded = true; })
      .observe(document.querySelector("#usage")!, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await expect(cyc.locator(".al")).toHaveText("Personal", { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { faded: boolean }).faded)).toBe(true);
  await expect(cyc).toHaveClass(/\bin\b/);
  await expect(page.locator("#usage .rcol.cyc .dots i.on")).toHaveCount(1);
  expect(await page.locator("#usage .rcol .al").allTextContents()).toEqual(["Team", "Pro", "Lab", "Personal"]);
});
