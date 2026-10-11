import { expect, test } from "@playwright/test";

const NAMES = ["flowobserve", "atlas", "dryas", "harbor"];

test("portrait demo=4: one tab per session, click changes the card, head = project name", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto("/?frame=1080x1920&demo=4&freeze&pause");
  await page.waitForSelector("#tabs .tab");
  expect((await page.locator("#tabs .tab .nm").allTextContents()).sort(), "one tab per session (order follows the live ranking)").toEqual([...NAMES].sort());
  await expect(page.locator("#tabs .tab.on")).toHaveCount(1);
  const target = page.locator('#tabs .tab[data-name="dryas"]');
  await target.click();
  await expect(target).toHaveClass(/\bon\b/);
  await expect(page.locator("#cards .card")).toHaveAttribute("data-id", (await target.getAttribute("data-id"))!);
  await expect(page.locator("#name")).toHaveText("dryas");
  await expect(page.locator("#dots")).toHaveCount(0);
});

test("portrait: only the current project's loop labels show", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto("/?frame=1080x1920&demo=7&freeze&pause");
  await page.waitForSelector("#tabs .tab");
  const tab = page.locator("#tabs .tab").nth(4);
  const name = (await tab.getAttribute("data-name"))!;
  await tab.click();
  await page.waitForTimeout(3000);
  const shown = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#labels .ll")]
    .filter((e) => parseFloat(getComputedStyle(e).opacity) > 0.01).map((e) => e.textContent ?? ""));
  expect(shown.length, `visible loop labels: ${JSON.stringify(shown)}`).toBe(1);
  expect(shown[0].startsWith(name), `label ${shown[0]} starts with ${name}`).toBe(true);
});

test("landscape demo=4: one tab per project; click shows that project's cards", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?demo=4&freeze&pause");
  await page.waitForSelector("#tabs .tab");
  expect((await page.locator("#tabs .tab .nm").allTextContents()).sort(), "one tab per project (order follows the live ranking)").toEqual([...NAMES].sort());
  await page.locator('#tabs .tab[data-name="harbor"]').click();
  await expect(page.locator("#cards .group")).toHaveCount(1);
  await expect(page.locator("#cards .group")).toHaveAttribute("data-name", "harbor");
  await expect(page.locator("#pgnext")).toHaveCount(0);
  await expect(page.locator("#foot .pg")).toHaveCount(0);
});

test("need: an amber 7px dot on the tab", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?demo=4&state=w&freeze&pause");
  await page.waitForSelector("#tabs .tab");
  await expect.poll(() => page.locator("#tabs .tab.need .nd").count()).toBeGreaterThan(0);
  const nd = await page.locator("#tabs .tab.need .nd").first().evaluate((e) => { const s = getComputedStyle(e); return [s.display, s.width]; });
  expect(nd[0], "dot is displayed (a flex item computes to block)").not.toBe("none");
  expect(nd[1]).toBe("7px");
});

for (const [name, url, vp] of [
  ["portrait", "/?frame=1080x1920&demo=7&freeze&pause", { width: 1080, height: 1920 }],
  ["landscape", "/?demo=7&freeze&pause", { width: 1600, height: 1000 }],
] as const) {
  test(`${name} overflow: names ellipsize, numbers intact, current tab in view, no wrap`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto(url);
    await page.waitForSelector("#tabs .tab");
    await page.addStyleTag({ content: "#tabs{width:420px}" });
    await page.locator("#tabs .tab").last().click();
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const tl = document.querySelector<HTMLElement>("#tabs .tl")!, a = tl.getBoundingClientRect();
      const tabs = [...tl.querySelectorAll<HTMLElement>(".tab")], on = tl.querySelector<HTMLElement>(".tab.on")!.getBoundingClientRect();
      return {
        rows: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size,
        onIn: on.left >= a.left - 1 && on.right <= a.right + 1,
        noCut: [...tl.querySelectorAll<HTMLElement>(".no")].every((n) => n.scrollWidth <= n.clientWidth + 1),
        ell: getComputedStyle(tl.querySelector(".nm")!).textOverflow,
        scrolls: tl.scrollWidth > tl.clientWidth,
      };
    });
    expect(r.rows, "tabs never wrap").toBe(1);
    expect(r.scrolls, "7 tabs in 420px overflow into a scroll").toBe(true);
    expect(r.onIn, "current tab scrolled into view").toBe(true);
    expect(r.noCut, "running number never truncates").toBe(true);
    expect(r.ell).toBe("ellipsis");
  });
}
