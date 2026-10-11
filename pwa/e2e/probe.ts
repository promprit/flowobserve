import { expect, type Page } from "@playwright/test";

export const probe = <T>(page: Page, fn: string, arg?: string) =>
  page.evaluate(([f, a]) => (window as unknown as { __fo: Record<string, (x?: string) => unknown> }).__fo[f!](a) as T, [fn, arg] as const);

/** Poll until the rendered-frame counter has not moved for 500 ms (an idle scene). */
export const quiet = async (page: Page, timeout = 15_000) => {
  let prev = -1, since = Date.now();
  await expect.poll(async () => {
    const n = await probe<number>(page, "frames");
    if (n !== prev) { prev = n; since = Date.now(); }
    return Date.now() - since >= 500;
  }, { timeout, intervals: [100] }).toBe(true);
};

/** Record navigations (custom schemes never reach page.route) instead of leaving the page. */
export const recordNav = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __foNav: string[]; __foNavStub: (u: string) => void };
  w.__foNav = [];
  w.__foNavStub = (u) => { w.__foNav.push(u); };
});
export const navs = (page: Page) => page.evaluate(() => (window as unknown as { __foNav: string[] }).__foNav);
