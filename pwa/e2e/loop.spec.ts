import { expect, type Page, test } from "@playwright/test";
import { probe, quiet } from "./probe";

type Pt = { x: number; y: number; r: number };
const nodeAt = async (page: Page, key: string) => {
  const b = (await page.locator("#loop").boundingBox())!;
  const p = (await probe<Pt | null>(page, "node", key))!;
  return { x: b.x + p.x, y: b.y + p.y };
};
/** Wait until the page is `minMs` old and the focused loop's node positions hold still for 500 ms (camera settled). */
const still = async (page: Page, minMs: number) => {
  let ref: Pt | null = null, since = Date.now();
  await expect.poll(async () => {
    const landed = await page.evaluate((ms) => performance.now() > ms, minMs);
    const p = await probe<Pt | null>(page, "node", "you");
    if (!p) return false;
    if (!ref || Math.hypot(p.x - ref.x, p.y - ref.y) > 2) { ref = p; since = Date.now(); } // tolerance: the idle camera sways slowly
    return landed && Date.now() - since >= 500;
  }, { timeout: 15_000, intervals: [100] }).toBe(true);
};
/** Forced demo state lands at 1.2 s page time. */
const settle = async (page: Page, url: string) => { await page.goto(url); await still(page, 1300); };

test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "viewports are set inside; runs once"); });

for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024]] as const) {
  test(`hover inspects a builder and Esc closes it at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await settle(page, "/?demo=1&state=e&pause=1");
    const p = await nodeAt(page, "b2");
    await page.mouse.move(p.x, p.y);
    const pop = page.locator("#inspect");
    await expect(pop).toBeVisible();
    await expect(pop).toContainText(/Sonnet · working · \d+(s|m \d\ds)/);
    const pb = (await pop.boundingBox())!, lb = (await page.locator("#loop").boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(lb.x + 7);
    expect(pb.x + pb.width).toBeLessThanOrEqual(lb.x + lb.width - 7);
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
  });
}

for (const [w, h] of [[1440, 900], [768, 1024]] as const) {
  test(`hover inspects an agent in its card at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await settle(page, "/?agents=b&pause=1");
    const b = (await page.locator("#loop").boundingBox())!;
    const p = (await probe<Pt | null>(page, "agent", "b4"))!;
    await page.mouse.move(b.x + p.x, b.y + p.y);
    const sel = page.locator(".card.sel-ag");
    await expect(sel).toHaveCount(1);
    await expect(sel.locator(".agd .ah")).toContainText("EXECUTOR 4");
    await expect(sel.locator(".agd .ah")).toContainText("NEEDS YOU");
    await expect(page.locator("#inspect")).toBeHidden();
  });
}

test("drag orbits and does not inspect", async ({ page }) => {
  await settle(page, "/?demo=1&state=e&pause=1");
  const p = await nodeAt(page, "b2");
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 120, p.y + 10, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.locator("#inspect")).toBeHidden();
  expect((await probe<{ yaw: number }>(page, "orbit")).yaw).not.toBe(0);
});

test("arrows and a two-finger swipe page sessions", async ({ page }) => {
  await settle(page, "/?demo=4&pause=1");
  const name = page.locator("#name");
  const first = await name.textContent();
  await page.keyboard.press("ArrowRight");
  await expect(name).not.toHaveText(first!);
  const second = await name.textContent();
  await page.evaluate(() => {
    const el = document.querySelector("#loop")!, r = el.getBoundingClientRect(), y = r.top + r.height / 2;
    const fire = (type: string, id: number, x: number) =>
      el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true }));
    fire("pointerdown", 1, r.left + 300); fire("pointerdown", 2, r.left + 360);
    for (let d = 10; d <= 120; d += 10) { fire("pointermove", 1, r.left + 300 - d); fire("pointermove", 2, r.left + 360 - d); }
    fire("pointerup", 1, r.left + 180); fire("pointerup", 2, r.left + 240);
  });
  await expect(name).not.toHaveText(second!);
});

test("trackpad: two-finger swipe pages once despite momentum, pinch zooms out", async ({ page }) => {
  await settle(page, "/?demo=4&pause=1");
  const name = page.locator("#name"), first = await name.textContent();
  const b = (await page.locator("#loop").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(40, 0);           // swipe
  for (let i = 0; i < 20; i++) await page.mouse.wheel(8, 0);           // momentum tail, same gesture
  await expect(name).not.toHaveText(first!);
  const second = await name.textContent();
  await page.waitForTimeout(400);
  await expect(name).toHaveText(second!);                              // paged exactly once
  await page.evaluate(() => {                                          // trackpad pinch-out arrives as ctrl+wheel in Chromium
    const el = document.querySelector("#loop")!, r = el.getBoundingClientRect();
    for (let i = 0; i < 6; i++) el.dispatchEvent(new WheelEvent("wheel", { deltaY: 15, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, cancelable: true, bubbles: true }));
  });
  await expect(page.locator("#loop")).toHaveClass(/\bout\b/);
});

test("an idle dashboard stops rendering", async ({ page }) => {
  await page.goto("/?demo=1&state=i&pause=1");
  await quiet(page);
  const a = await probe<number>(page, "frames");
  await page.waitForTimeout(2000);
  expect(await probe<number>(page, "frames")).toBe(a);
});

test("portrait: hover still inspects", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await settle(page, "/?demo=1&state=w&pause=1&orient=portrait");
  const p = await nodeAt(page, "you");
  await page.mouse.move(p.x, p.y);
  await expect(page.locator("#inspect")).toContainText("waiting");
});

test("Open in VS Code carries the vscode:// link (live server)", async ({ page }) => {
  await page.goto("/?probe=1");
  await expect(page.locator(".card").first()).toBeVisible();
  await still(page, 1300);
  const p = await nodeAt(page, "you");
  await page.mouse.move(p.x, p.y);
  const open = page.locator("#inspect a.open");
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("href", /^vscode:\/\/file\/tmp\/fo-e2e\/app$/);
});
