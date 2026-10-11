import { expect, type Page, test } from "@playwright/test";
import { CLOSED_SID, ITERM_ID, TOKEN, V2_PORT } from "./env";
import { navs, recordNav } from "./probe";

/** Landscape shows one project per tab: click its tab, then return its group. */
const showProject = async (page: Page, name: string) => {
  const t = page.locator(`#tabs .tab[data-name="${name}"]`);
  if (await t.count()) await t.first().click();
  return page.locator(`.group[data-name="${name}"]`);
};

async function card(page: Page, project: string) {
  const c = (await showProject(page, project)).locator(".card").first();
  await expect(c).toBeVisible();
  return c;
}

test.use({ baseURL: `http://127.0.0.1:${V2_PORT}` });

test.beforeEach(async ({ page }) => {
  await recordNav(page);
  await page.goto("/");
  await expect(page.locator("#open-btn")).toBeVisible({ timeout: 10_000 });
});

test("open sheet restores a closed session", async ({ page }) => {
  await page.locator("#open-btn").click();
  const row = page.locator("#sheet .op-row", { hasText: /^▸app/ });
  await expect(row.locator(".op-b")).toHaveText("Restore 1");
  await row.locator(".op-b").click();
  const u = (await navs(page)).at(-1)!;
  expect(u).toMatch(/^flowobserve:\/\/open\?/);
  const q = new URL(u).searchParams;
  expect(q.get("path")).toBe("app");
  expect(q.get("resume")).toBe(CLOSED_SID);
  expect(q.get("t")).toBe(TOKEN);
});

test("a real click on the + Open button opens the sheet", async ({ page }) => {
  await expect(page.locator("#sheet")).toBeHidden();
  await page.locator("#open-btn").click();
  await expect(page.locator("#sheet")).toBeVisible();
  await expect(page.locator("#sheet .op-h b")).toHaveText("Open a project");
});

test("the Open sheet lists a group folder with its own New button", async ({ page }) => {
  await page.locator("#open-btn").click();
  const g = page.locator("#sheet .op-row[data-group='dryas']");
  await expect(g).toContainText("group");
  await expect(g).toContainText("quarry");
  await expect(g.locator(".op-b")).toHaveText("New");
  await g.locator(".op-b").click();
  const u = (await navs(page)).at(-1)!;
  expect(u).toMatch(/^flowobserve:\/\/open\?/);
  const q = new URL(u).searchParams;
  expect(q.get("path")).toBe("dryas");
  expect(q.get("t")).toBe(TOKEN);
});

test("APPROVE PLAN opens the reader and Enter jumps to the iTerm2 session", async ({ page }) => {
  const c = await card(page, "plan");
  await expect(c.locator(".act")).toHaveText("APPROVE PLAN", { timeout: 10_000 });
  await c.hover();
  await c.locator(".act").click();
  await expect(page.locator("#reader")).toBeVisible();
  await expect(page.locator("#reader .rd-doc")).toContainText("Task 1: Seed");
  await page.keyboard.press("Enter");
  const u = (await navs(page)).at(-1)!;
  expect(u).toMatch(/^flowobserve:\/\/jump\?iterm=/);
  expect(new URL(u).searchParams.get("iterm")).toBe(ITERM_ID);
  expect(new URL(u).searchParams.get("t")).toBe(TOKEN);
});

test("TRY IT on a reviewed runnable session runs the project", async ({ page }) => {
  const c = await card(page, "ship");
  await expect(c.locator(".act")).toHaveText("TRY IT", { timeout: 10_000 });
  await c.hover();
  await c.locator(".act").click();
  const u = (await navs(page)).at(-1)!;
  expect(u).toMatch(/^flowobserve:\/\/run\?/);
  const q = new URL(u).searchParams;
  expect(q.get("path")).toBe("ship");
  expect(q.get("t")).toBe(TOKEN);
});

test("Enter on a VS Code session still opens vscode://file", async ({ page }) => {
  const c = await card(page, "code");
  await c.click();
  await page.keyboard.press("Enter");
  expect((await navs(page)).at(-1)).toMatch(/^vscode:\/\/file\//);
});
