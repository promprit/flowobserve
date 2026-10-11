import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { APP, SPOOL, line } from "./env";

/** Landscape shows one project per tab: click its tab, then return its group. */
const project = async (page: Page, name: string) => {
  const t = page.locator(`#tabs .tab[data-name="${name}"]`);
  await expect(t.first()).toBeVisible();
  await t.first().click();
  return page.locator(`.group[data-name="${name}"]`);
};
/** The session's full card. */
const card = async (page: Page, name: string) => (await project(page, name)).locator(".card");

test("a session waiting on a plan shows its action chip and the footer counts it", async ({ page }) => {
  await page.goto("/");
  const app = await card(page, "app");
  await expect(app).toHaveClass(/st-waiting/);
  await expect(app.locator(".act")).toHaveText("APPROVE PLAN");
  await expect(app.locator(".lb")).toHaveText("PLAN · NEEDS YOU");
  await expect((await card(page, "web"))).toHaveClass(/st-active/);
  await expect(page.locator("#foot")).toContainText("1 needs you");
});

test("the link stays live through a quiet wait (heartbeat)", async ({ page }) => {
  await page.goto("/");
  await expect((await card(page, "web"))).toBeVisible();
  await page.waitForTimeout(12_000);
  await expect((await card(page, "web"))).not.toHaveClass(/stale/);
});

test("the usage drawer opens from the meter row and closes on Escape", async ({ page }) => {
  await page.goto("/");
  await page.locator("#usage").click();
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.locator("#drawer")).toContainText(/NO SPEND IN THIS RANGE|API-EQUIVALENT/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();
});

test("an unreachable server shows the offline headline", async ({ page }) => {
  await page.routeWebSocket("**/ws", (ws) => ws.close());
  await page.goto("/");
  await expect(page.locator("#name")).toHaveText("Observer offline", { timeout: 25_000 });
});

test("a foreign ?src is ignored in production", async ({ page }) => {
  await page.goto("/?src=ws://127.0.0.1:1/ws");
  const app = await card(page, "app");
  await expect(app).toBeVisible();
  await expect(app).toHaveClass(/st-waiting/);
});

test("demo mode runs the simulator with dimmed cards when offline", async ({ page }) => {
  await page.goto("/?demo=offline");
  // one project per tab: the visible session (card or row) dims, whichever form the fit chose
  await expect(page.locator("#cards .group")).toHaveCount(1);
  const items = page.locator("#cards .card, #cards .row");
  await expect(items).toHaveCount(1);
  await expect(page.locator("#cards .card.stale, #cards .row.stale")).toHaveCount(1);
});

test("every question and action stays inside its card, and the cards inside the dock", async ({ page }) => {
  await page.goto("/?demo=4");
  await expect(page.locator("#cards .group")).toHaveCount(1);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const box = (e: Element) => e.getBoundingClientRect();
    const zone = document.querySelector("#cards")!;
    return {
      scroll: zone.classList.contains("scroll"), zone: box(zone), usageTop: box(document.querySelector("#usage")!).top,
      cards: [...document.querySelectorAll("#cards .card")].map((c) => ({
        c: box(c), need: c.classList.contains("need"),
        inner: [...c.querySelectorAll(".q,.act")].filter((e) => (e.textContent ?? "").trim()).map((e) => ({ n: e.className, b: box(e) })),
      })),
      groups: [...document.querySelectorAll("#cards .group")].map((g) => box(g)),
    };
  });
  for (const c of r.cards) for (const i of c.inner) {
    expect(i.b.bottom, `${i.n} inside its card`).toBeLessThanOrEqual(c.c.bottom + 0.5);
    expect(i.b.top).toBeGreaterThanOrEqual(c.c.top - 0.5);
  }
  if (!r.scroll) for (const g of [...r.groups, ...r.cards.map((c) => c.c)]) expect(g.bottom, "inside #cards").toBeLessThanOrEqual(r.zone.bottom + 1);
  expect(r.zone.bottom, "#cards stops above #usage").toBeLessThanOrEqual(r.usageTop + 1);
});

// Last: it changes the fixture's state (tablet project runs after desktop).
test("a new prompt reaches the card live, without a reload", async ({ page }, info) => {
  test.skip(info.project.name !== "tablet", "mutates the shared fixture; runs once, last");
  await page.goto("/");
  await expect((await card(page, "app"))).toHaveClass(/st-waiting/);
  fs.appendFileSync(SPOOL, line("s-app-0001", APP, "UserPromptSubmit", { prompt: "go" }));
  await expect((await card(page, "app"))).not.toHaveClass(/st-waiting/, { timeout: 5_000 });
});

// Real-like long values injected after the first render, then measured synchronously (no re-render in between).
test("right panel text never overlaps or truncates", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "sizes are set inside; runs once");
  for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/?demo=4");
    await expect(page.locator("#usage .tile")).not.toHaveCount(0);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const hl = '<div class="hl"><s style="width:40%"></s><u style="left:30%"></u></div>';
      const row = (k: string, n: string, sub: string, cls = "") => `<div class="r limit ${cls}"><span class="cap">${k}</span><span class="n">${n}</span>${hl}<span class="s">${sub}</span></div>`;
      const tile = (k: string, n: string, sub: string, cls = "") => `<div class="tile limit ${cls}"><div class="top"><span class="cap">${k}</span><span class="n">${n}</span></div>${hl}<div class="s">${sub}</div></div>`;
      const u = document.querySelector<HTMLElement>("#usage")!;
      u.classList.add("four");
      u.innerHTML = `<div class="tile pair">${row("SESSION 5H", "100%", "IN 22:17")}${row("WEEKLY", "75%", "<b>AHEAD OF PACE</b>", "hot")}</div>` +
        tile('<i class="dot"></i>FABLE', "31%", "FRI 09:00", "fable") +
        '<div class="tile num hot"><span class="cap">JEV</span><span class="big">$12.50</span><div class="s"><b>AHEAD OF PACE</b></div></div>';
      const arc = (k: string, n: string, w: string) => `<div class="a ${w ? "hot" : ""}"><div class="ring"><svg viewBox="0 0 48 48"></svg><span class="n">${n}</span></div><div class="t"><span class="cap">${k}</span>${w ? `<span class="s">${w}</span>` : ""}</div></div>`;
      const srow = (k: string, n: string, w = "") => `<div class="r ${w ? "hot" : ""}"><span class="cap">${k}</span><span class="n">${n}${w}</span>${hl}</div>`;
      const h = document.querySelector<HTMLElement>("#host")!;
      h.hidden = false;
      h.innerHTML = `<div class="tile arcs">${arc("CPU", "100%", "HOT")}${arc("GPU", "100%", "BUSY")}${arc("MEM", "100%", "PRESSURE")}</div>` +
        `<div class="tile stack"><span class="cap">STORAGE · FREE</span>${srow("SYSTEM", "1000 GB", " · LOW")}${srow("EXTERNAL", "OFFLINE")}</div>`;
      const t = (k: string) => `<div class="mt"><span class="r">${k}</span><b class="c">1,234</b><i class="l">p95 313s</i></div>`;
      document.querySelector("#models")!.innerHTML = ["PLAN", "BUILD", "JUDGE", "ESCALATE", "REVIEW"].map(t).join("");
      const f = document.querySelector<HTMLElement>("#foot")!;
      f.innerHTML = '<span>4 sessions</span><span class="need">· 1 needs you</span><span class="quiet">· blocked 12m today</span><span class="sp"></span><span class="quiet" id="clk">22:10</span>';
      const textBox = (e: Element) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); };
      const items = [...document.querySelectorAll<HTMLElement>("#usage .cap, #usage .n, #usage .big, #usage .s, #host .cap, #host .n, #host .s, #models .mt .r, #models .mt .c, #models .mt .l")];
      const clipped = items.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ":" + e.textContent + ` sw${e.scrollWidth} cw${e.clientWidth}`);
      // tiles are overflow:hidden: any child painted past the tile edge is silently cut
      const cutTiles = [...document.querySelectorAll<HTMLElement>("#usage .tile, #host .tile")].flatMap((t) => {
        const tb = t.getBoundingClientRect();
        return [...t.querySelectorAll("*")].filter((c) => { const b = c.getBoundingClientRect(); return b.width && b.height && (b.top < tb.top - 0.5 || b.bottom > tb.bottom + 0.5 || b.left < tb.left - 0.5 || b.right > tb.right + 0.5); })
          .map((c) => `${t.className} > ${c.className} ${Math.round(c.getBoundingClientRect().bottom - tb.bottom)}`);
      });
      const boxes = items.map((e) => ({ n: e.className + ":" + e.textContent, b: textBox(e) }));
      const overlaps: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].b, b = boxes[j].b;
        if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(boxes[i].n + " X " + boxes[j].n);
      }
      const dock = document.querySelector("#dock")!.getBoundingClientRect();
      const outside = items.filter((e) => { const b = textBox(e); return b.right > dock.right + 1 || b.left < dock.left - 1; }).map((e) => e.textContent);
      const first = f.firstElementChild!.getBoundingClientRect(), clk = document.querySelector("#clk")!.getBoundingClientRect(), fb = f.getBoundingClientRect();
      return { clipped, cutTiles, overlaps, outside, clockSameLine: Math.abs(clk.top - first.top) < 3, clockRight: fb.right - clk.right };
    });
    const tag = `${w}x${h}`;
    expect(r.clipped, `clipped at ${tag}`).toEqual([]);
    expect(r.cutTiles, `tiles cutting their content at ${tag}`).toEqual([]);
    expect(r.overlaps, `overlaps at ${tag}`).toEqual([]);
    expect(r.outside, `outside dock at ${tag}`).toEqual([]);
    expect(r.clockSameLine, `clock on first footer line at ${tag}`).toBe(true);
    expect(r.clockRight, `clock right-aligned at ${tag}`).toBeLessThan(2);
  }
});

test("footer phrases never break mid-phrase", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "sizes are set inside; runs once");
  for (const [w, h] of [[1440, 900], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/?demo=4");
    await expect(page.locator("#usage .tile")).not.toHaveCount(0);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const f = document.querySelector<HTMLElement>("#foot")!;
      f.innerHTML = '<span>24 sessions</span><span class="need">· 12 need you</span><span class="quiet">· blocked 125m today</span><span class="sp"></span><span class="pg"><b class="on"></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></span><span class="quiet" id="clk">22:10</span>';
      f.style.width = Math.round(f.clientWidth * 0.8) + "px"; // content must not fit on one line
      const phrases = [...f.querySelectorAll<HTMLElement>(":scope > span:not(.sp)")];
      // flex items are blockified, so count line boxes of their text
      const lines = (e: Element) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].map((q) => Math.round(q.top))).size; };
      const broken = phrases.filter((e) => lines(e) !== 1).map((e) => e.textContent);
      const clk = document.querySelector("#clk")!.getBoundingClientRect(), first = f.firstElementChild!.getBoundingClientRect(), fb = f.getBoundingClientRect();
      return { broken, clockSameLine: Math.abs(clk.top - first.top) < 3, clockRight: fb.right - clk.right };
    });
    const tag = `${w}x${h}`;
    expect(r.broken, `phrases broken at ${tag}`).toEqual([]);
    expect(r.clockSameLine, `clock first line at ${tag}`).toBe(true);
    expect(r.clockRight, `clock right at ${tag}`).toBeLessThan(2);
  }
});
