import { expect, test } from "@playwright/test";
import { probe, quiet } from "./probe";

type Perf = { frames: number; cpuP50: number | null; cpuP95: number | null; gpuP50: number | null; gpuP95: number | null; bloomDead: boolean; capMs: number };
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "runs once"); });

test("__fo.perf is always exposed; the other probes are not", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(() => { const f = (window as unknown as { __fo: Record<string, unknown> }).__fo; return { perf: typeof f.perf, frames: typeof f.frames }; });
  expect(r).toEqual({ perf: "function", frames: "undefined" });
});

test("live: CPU p95 under 8 ms over 10 s, then an idle page draws no frames", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?probe=1");
  await page.waitForTimeout(10_000);
  const p = await probe<Perf>(page, "perf");
  expect(p.frames).toBeGreaterThan(0);
  expect(p.cpuP95!).toBeLessThan(8); // SwiftShader has no GPU timer; the GPU budget is checked by hand on the Mac mini
  // Fixture sessions never go idle inside a test (10 min) and breathing draws at 12 fps; a dropped link is the still tier.
  await page.routeWebSocket("**/ws", (ws) => ws.close());
  await page.goto("/?probe=1");
  await quiet(page);
  const a = await probe<number>(page, "frames");
  await page.waitForTimeout(3000);
  expect(await probe<number>(page, "frames")).toBe(a);
});

test("working motion is capped at 30 fps", async ({ page }) => {
  await page.goto("/?demo=1&state=e&pause=1"); // escalated: a builder working, packets in flight
  await page.waitForTimeout(6500);              // past the 4 s settle window after the forced state at 1.2 s
  const a = await probe<number>(page, "frames");
  await page.waitForTimeout(2000);
  const n = (await probe<number>(page, "frames")) - a;
  expect(n).toBeGreaterThan(40);
  expect(n).toBeLessThan(70);
});
