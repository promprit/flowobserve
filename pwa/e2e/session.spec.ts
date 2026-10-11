import { expect, type Page, test } from "@playwright/test";

/** Landscape shows one project per tab: click its tab, then return its group. */
const project = async (page: Page, name: string) => {
  const t = page.locator(`#tabs .tab[data-name="${name}"]`);
  await expect(t.first()).toBeVisible();
  await t.first().click();
  return page.locator(`.group[data-name="${name}"]`);
};

test("live card shows CTX from the transcript and focus-only session links on its buttons", async ({ page }) => {
  await page.goto("/");
  const c = (await project(page, "app")).locator(".card");
  await expect(c.locator(".ctx")).toHaveText(/^\d+% LEFT$/, { timeout: 10_000 });
  await c.hover();
  await expect(c.locator('[data-step="handoff"]')).toHaveAttribute("data-href", /^vscode:\/\/anthropic\.claude-code\/open\?session=s-app-0001$/);
  await expect(c.locator('[data-step="clear"]')).toHaveClass(/off/);
});
