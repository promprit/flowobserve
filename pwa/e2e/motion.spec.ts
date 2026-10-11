import { expect, test } from "@playwright/test";
import { probe, quiet } from "./probe";

test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "runs once"); });
const fps = async (page: import("@playwright/test").Page, ms = 2000) => {
  const a = await probe<number>(page, "frames");
  await page.waitForTimeout(ms);
  return ((await probe<number>(page, "frames")) - a) / (ms / 1000);
};

test("tiers: working ~30 fps, breathing ~12 fps, idle 0", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?demo=1&state=e&pause=1");   // escalated: a builder working (a deny waits on you, so it breathes)
  await page.waitForTimeout(6500);
  expect(await fps(page)).toBeGreaterThan(20);
  await page.goto("/?demo=1&state=w&pause=1");   // waiting on you
  await page.waitForTimeout(6500);
  const b = await fps(page);
  expect(b).toBeGreaterThan(6); expect(b).toBeLessThan(16);
  await page.goto("/?demo=1&state=i&pause=1");   // idle
  await quiet(page);
  expect(await fps(page)).toBe(0);
});

test("?life= overrides the tier in the demo", async ({ page }) => {
  await page.goto("/?demo=1&state=i&pause=1&life=working");
  await page.waitForTimeout(6500);
  expect(await fps(page)).toBeGreaterThan(20);
});

test("reduced motion: no packet frames while builders work; a still ring marks the current node", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&state=e&pause=1");
  await page.waitForTimeout(1500);
  await quiet(page);
  const a = await probe<number>(page, "frames");
  await page.waitForTimeout(2000);
  expect(await probe<number>(page, "frames")).toBe(a);
  await expect(page.locator("#cur")).toHaveClass(/on/);
});
