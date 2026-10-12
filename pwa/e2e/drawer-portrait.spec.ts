import { expect, test } from "@playwright/test";

// Rotated 1080p and 1440p monitors (the user's setup), plus a tablet. /spend is stubbed: the e2e spool has no spend.
const SIZES = [[1080, 1920], [1440, 2560], [820, 1180]] as const;
const ROWS = Array.from({ length: 24 }, (_, i) => ({
  project: `a-rather-long-project-name-number-${String(i).padStart(2, "0")}`,
  model: i % 2 ? "claude-sonnet-5-5" : "claude-opus-5-5", source: "claude", usd: 1234.5 - i * 37.25,
}));

for (const [w, h] of SIZES) {
  test(`portrait ${w}x${h}: spend drawer and the last row of each table are on screen`, async ({ page }) => {
    await page.route((url) => url.pathname === "/spend", (r) => r.fulfill({ json: { rows: ROWS, totalUsd: 1 } }));
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    const slim = page.locator("#slim");
    await expect(slim).toBeVisible();
    await slim.click();
    const drawer = page.locator("#drawer");
    await expect(drawer.locator(".dr-t")).toHaveCount(2);
    const diag = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>("#drawer")!, u = document.querySelector<HTMLElement>("#usage")!;
      return { inlineBottom: d.style.bottom, usageDisplay: getComputedStyle(u).display, usageTop: u.offsetTop, dockH: document.querySelector<HTMLElement>("#dock")!.clientHeight };
    });
    const box = (await drawer.boundingBox())!;
    expect(box.height, JSON.stringify(diag)).toBeGreaterThan(h * 0.25);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(h);
    for (const t of await drawer.locator(".dr-t").all()) {
      const last = t.locator("span").last();
      await last.scrollIntoViewIfNeeded();
      const lb = (await last.boundingBox())!;
      expect(lb.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(lb.y + lb.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#drawer .dr-t")].flatMap((t) => {
      const cols = t.classList.contains("two") ? 2 : 3;
      return [...t.children].filter((c, i) => i % cols !== 0 && c.scrollWidth > c.clientWidth).map((c) => c.textContent);
    }));
    expect(clipped).toEqual([]);
  });
}
