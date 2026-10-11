import { expect, test } from "@playwright/test";
import { V2_PORT } from "./env";
import { recordNav } from "./probe";

test.use({ baseURL: `http://127.0.0.1:${V2_PORT}` });

test("New project row renders above the filter and Create reflects the name", async ({ page }) => {
  await recordNav(page);
  await page.goto("/");
  await expect(page.locator("#open-btn")).toBeVisible({ timeout: 10_000 });
  await page.locator("#open-btn").click();
  const row = page.locator(".op-new");
  await expect(row).toBeVisible();
  expect(await row.evaluate((el, f) => el.compareDocumentPosition(f as Node) & Node.DOCUMENT_POSITION_FOLLOWING, await page.locator(".op-q").elementHandle())).toBeTruthy();
  await expect(page.locator(".op-new-root option").first()).toHaveText("projects");
  await page.locator(".op-new-name").fill("e2e-new");
  await expect(page.locator(".op-new-path")).toContainText("e2e-new");
  await expect(page.locator(".op-new-create")).toBeEnabled();
  await page.locator(".op-new-name").fill("bad/name");
  await expect(page.locator(".op-new-create")).toBeDisabled();
  await expect(page.locator(".op-new-msg")).toHaveText("Letters, digits, . _ - only · 1–64");
});

test("Open sheet colour pick recolours the row and the next Open link carries c", async ({ page }) => {
  await recordNav(page);
  await page.goto("/");
  await page.locator("#open-btn").click();
  const row = page.locator(".op-row[data-key]").first();
  const key = await row.getAttribute("data-key");
  await page.locator(`.op-dot[data-key="${key}"]`).click();
  await page.locator(".op-pick .op-sw").first().click();
  await expect(row).toHaveAttribute("style", /--pc:\s*#e06c75/);
  const url = await row.locator(".op-b").first().getAttribute("data-url");
  expect(url).toContain("&c=e06c75");
  await page.locator(`.op-dot[data-key="${key}"]`).click();
  await page.locator(".op-sw.reset").click();
  await expect(row).not.toHaveAttribute("style", /--pc:\s*#e06c75/);
});
