import { expect, type Page, test } from "@playwright/test";
import { V2_PORT } from "./env";

const SIZES = { landscape: { width: 1600, height: 1000 }, portrait: { width: 1000, height: 1600 }, tablet: { width: 1024, height: 768 } };

const seed = () => { // particle clouds and the sim use Math.random: seed it (mulberry32) so shots are repeatable
  let s = 0x1234abcd;
  Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

for (const n of [1, 4, 7]) for (const [orient, viewport] of Object.entries(SIZES)) {
  test(`@visual demo ${n} ${orient}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(`console: ${m.text()}`); });
    await page.setViewportSize(viewport);
    await page.goto(`/?demo=${n}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `test-results/shots/demo-${n}-${orient}.png` });
    expect(await page.evaluate(() => document.body.classList.contains("nogl")), "WebGL scene path (body.nogl)").toBe(false);
    expect(errors).toEqual([]);
  });
}

for (const [name, q, extra] of [["field-idle", "state=i", 3000], ["field-attention", "state=w", 3000], ["field-ship-wave", "state=s", 800]] as const) {
  test(`@visual ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(seed);
    await page.clock.install({ time: new Date("2026-10-03T03:00:00Z") });
    await page.goto(`/?demo=1&${q}&pause=1&freeze=1`);
    await page.clock.runFor(1200 + extra);
    await expect(page.locator("#loop")).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

const shot = async (page: Page, url: string, sel: string, name: string) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(seed);
  await page.clock.install({ time: new Date("2026-10-03T03:00:00Z") });
  await page.goto(url);
  await page.clock.runFor(2200);
  await expect(page.locator(sel)).toHaveScreenshot(name, { maxDiffPixelRatio: 0.01 });
};

for (const h of ["ok", "warn", "crit", "offline"] as const)
  test(`@visual host ${h}`, async ({ page }) => shot(page, `/?demo=1&host=${h}&pause=1&freeze=1`, "#host", `host-${h}.png`));

for (const n of [1, 3, 4] as const)
  test(`@visual cards k${n}`, async ({ page }) => shot(page, `/?demo=${n}&pause=1&freeze=1`, "#cards", `cards-k${n}.png`));

for (const c of ["warn", "crit", "saved"] as const)
  test(`@visual card ctx ${c}`, async ({ page }) => shot(page, `/?demo=1&ctx=${c}&pause=1&freeze=1`, ".card", `card-ctx-${c}.png`));

// v2: the Open sheet, the reader and one card per chip verb, on the second fixture server (see env.ts).
test.describe("v2", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "v2 snapshots are desktop-only"); });
  test.use({ baseURL: `http://127.0.0.1:${V2_PORT}` });
  const v2shot = async (page: Page) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(seed);
    await page.goto("/?pause=1&freeze=1");
    await expect(page.locator("#open-btn")).toBeVisible({ timeout: 10_000 });
  };
  const verbCard = async (page: Page, project: string, label: string) => {
    const tab = page.locator(`#tabs .tab[data-name="${project}"]`);
    if (await tab.count()) await tab.first().click();
    const c = page.locator(`.group[data-name="${project}"]`).locator(".card").first();
    for (let i = 0; i < 8 && !(await c.count()); i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(400); }
    await expect(c.locator(".act")).toHaveText(label, { timeout: 10_000 });
    return c;
  };

  test("@visual open sheet", async ({ page }) => {
    await v2shot(page);
    await page.locator("#open-btn").click();
    await expect(page.locator("#sheet .op-row[data-group='dryas']")).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.locator("#sheet")).toHaveScreenshot("v2-open-sheet.png", { maxDiffPixelRatio: 0.01 });
  });

  test("@visual reader", async ({ page }) => {
    await v2shot(page);
    const c = await verbCard(page, "plan", "APPROVE PLAN");
    await c.hover();
    await c.locator(".act").click();
    await expect(page.locator("#reader .rd-doc")).toContainText("Task 1: Seed");
    await page.waitForTimeout(600);
    await expect(page.locator("#reader")).toHaveScreenshot("v2-reader.png", { maxDiffPixelRatio: 0.01, mask: [page.locator(".rd-w")] });
  });

  for (const [project, label, name] of [["ship", "TRY IT", "try-it"], ["jump", "JUMP", "jump"]] as const)
    test(`@visual card verb ${name}`, async ({ page }) => {
      await v2shot(page);
      const c = await verbCard(page, project, label);
      await expect(c).toHaveScreenshot(`v2-card-${name}.png`, { maxDiffPixelRatio: 0.01, mask: [c.locator(".tm")] });
    });
});

// agents (Phase 2): the review scenario with a pinned detail, and the overview with a haiku explorer (HEX.haiku #C4B5A5).
for (const [code, q] of [["d", "&pick=1"], ["e", ""]] as const)
  test(`@visual agents ${code}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(seed);
    await page.clock.install({ time: new Date("2026-10-03T03:00:00Z") });
    await page.goto(`/?agents=${code}${q}&pause=1&freeze=1`);
    await page.clock.runFor(5000);
    await expect(page.locator("#loop")).toHaveScreenshot(`agents-${code}-loop.png`, { maxDiffPixelRatio: 0.01 });
    if (code === "d") await expect(page.locator("#cards")).toHaveScreenshot("agents-d-cards.png", { maxDiffPixelRatio: 0.01 });
    else {
      await page.locator('#tabs .tab[data-name="meadow"]').first().click();
      await page.clock.runFor(1200);
      await expect(page.locator('.group[data-name="meadow"] .card')).toHaveScreenshot("agents-e-haiku-card.png", { maxDiffPixelRatio: 0.01, mask: [page.locator(".tm")] });
    }
  });
