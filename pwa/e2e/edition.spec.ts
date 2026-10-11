import { expect, test } from "@playwright/test";
import { VS_PORT } from "./env";

test.use({ baseURL: `http://127.0.0.1:${VS_PORT}` });

test("VS Code edition Open sheet", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#open-btn")).toBeVisible({ timeout: 10_000 });
  await page.locator("#open-btn").click();
  const btn = page.locator(".op-row[data-key] .op-b").first();
  await expect(btn).toHaveText("Open");
  await expect(btn).toHaveClass(/vscode/);
  expect(await btn.getAttribute("data-url")).toMatch(/^vscode:\/\/file\//);
  await expect(page.locator(".op-new")).toHaveCount(0);
  await expect(page.locator("#foot")).toContainText("VS Code");
});
