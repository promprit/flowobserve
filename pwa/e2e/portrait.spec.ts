import { expect, test } from "@playwright/test";

for (const n of [1, 2, 4]) {
  test(`portrait demo=${n}: newest message line readable`, async ({ page }) => {
    await page.setViewportSize({ width: 1080, height: 1920 });
    await page.goto(`/?frame=1080x1920&demo=${n}&freeze&pause`);
    await page.waitForSelector("#cards .card .term .ln:last-child");
    const r = await page.evaluate(() => {
      const term = document.querySelector<HTMLElement>("#cards .card .term")!, ln = term.querySelector<HTMLElement>(".ln:last-child")!;
      const a = term.getBoundingClientRect(), b = ln.getBoundingClientRect();
      return { inside: b.top >= a.top - 1 && b.bottom <= a.bottom + 1, h: b.height, opacity: getComputedStyle(ln).opacity, cards: document.querySelectorAll("#cards .card").length };
    });
    expect(r.cards).toBe(1);
    expect(r.inside).toBe(true);
    expect(r.h).toBeGreaterThan(10);
    expect(r.opacity).toBe("1");
  });
}

test("portrait demo=1: term fills the card with more than 5 lines", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.addInitScript(() => { let x = 12345; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); });
  await page.goto("/?frame=1080x1920&demo=1&freeze&pause");
  await page.waitForSelector("#cards .card .term .ln:last-child");
  await expect.poll(() => page.locator("#cards .card .term .ln").count()).toBeGreaterThan(5);
  const r = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("#cards .card")!, term = card.querySelector<HTMLElement>(".term")!;
    const lns = [...term.querySelectorAll<HTMLElement>(".ln")], vis = lns.filter((l) => getComputedStyle(l).display !== "none");
    const a = term.getBoundingClientRect(), b = lns[lns.length - 1].getBoundingClientRect(), c = card.getBoundingClientRect();
    return { total: lns.length, vis: vis.length, inside: b.top >= a.top - 1 && b.bottom <= a.bottom + 1, termH: a.height, cardH: c.height };
  });
  expect(r.vis).toBeGreaterThan(5);
  expect(r.inside).toBe(true);
  expect(r.termH).toBeGreaterThan(r.cardH * 0.5);
});

test("portrait: tabs, arrows, slim row at most two lines", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto("/?frame=1080x1920&demo=4&freeze&pause");
  await page.waitForSelector("#tabs .tab");
  expect(await page.locator("#tabs .tab").count()).toBe(4);
  const first = await page.locator("#cards .card").getAttribute("data-id");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#cards .card")).not.toHaveAttribute("data-id", first!);
  await expect(page.locator("#usage")).toBeHidden();
  const slim = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#slim")!, fs = parseFloat(getComputedStyle(el.querySelector(".v")!).fontSize);
    const kids = [...el.children] as HTMLElement[];
    return { visible: !el.hidden, tallest: Math.max(...kids.map((c) => c.getBoundingClientRect().height)), lh: fs * 3,
      rows: new Set(kids.map((c) => Math.round(c.getBoundingClientRect().top))).size };
  });
  expect(slim.visible).toBe(true);
  expect(slim.rows).toBeLessThanOrEqual(2);
  expect(slim.tallest).toBeLessThan(slim.lh);
});

for (const n of [1, 2, 4]) {
  test(`landscape demo=${n}: newest line inside its box on every card`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/?demo=${n}&freeze&pause`);
    await page.waitForSelector("#cards .card");
    const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#cards .card:not(.tight) .term")].filter((t) => {
      const ln = t.querySelector<HTMLElement>(".ln:last-child"); if (!ln) return false;
      const a = t.getBoundingClientRect(), b = ln.getBoundingClientRect(); return b.top < a.top - 1 || b.height < 10;
    }).length);
    expect(bad).toBe(0);
  });
}

test("portrait demo=4: every slim cell fits unclipped, Fable included; at most 2 cell-rows", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto("/?frame=1080x1920&demo=4&freeze&pause");
  await page.waitForSelector("#slim .c");
  const r = await page.evaluate(() => {
    const slim = document.querySelector<HTMLElement>("#slim")!, sr = slim.getBoundingClientRect();
    const cells = [...slim.querySelectorAll<HTMLElement>(".c")];
    const parts = cells.flatMap((c) => [...c.querySelectorAll<HTMLElement>(".k, .v, .n")]);
    return { fable: cells.some((c) => c.querySelector(".k")!.textContent!.includes("FABLE")),
      rows: new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top))).size,
      host: slim.querySelectorAll(".sr").length,
      bad: parts.filter((s) => s.scrollWidth > s.clientWidth || s.getBoundingClientRect().right > sr.right + 0.5).map((s) => s.textContent) };
  });
  expect(r.fable).toBe(true);
  expect(r.host).toBe(2);
  expect(r.rows).toBeLessThanOrEqual(2);
  expect(r.bad).toEqual([]);
});
