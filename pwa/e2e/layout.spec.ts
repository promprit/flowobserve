import { expect, test } from "@playwright/test";

type R = { top: number; bottom: number; left: number; right: number; height: number };
// One project per tab: the dock shows one group; demo sessions are one per project.
for (const n of [1, 2, 3, 4, 5]) {
  test(`${n} project(s): one group, nothing clipped, needs-you cards full, dock order models > tabs > cards > usage > host > foot`, async ({ page }) => {
    await page.goto(`/?demo=${n}`);
    await expect(page.locator("#cards .group").first()).toBeVisible();
    await expect(page.locator("#usage .tile").first()).toBeVisible();
    await expect(page.locator("#host .tile").first()).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator("#cards .group")).toHaveCount(1);
    await expect(page.locator("#cards .card, #cards .row")).toHaveCount(1);
    await expect(page.locator("#tabs .tab")).toHaveCount(n);
    const r = await page.evaluate(() => {
      const box = (e: Element) => e.getBoundingClientRect().toJSON() as R;
      const zoneEl = document.querySelector<HTMLElement>("#cards")!;
      return {
        scroll: zoneEl.classList.contains("scroll"), tight: zoneEl.classList.contains("tight"),
        groups: [...document.querySelectorAll(".group")].map((g) => ({ g: box(g) })),
        tabs: box(document.querySelector("#tabs")!),
        items: [...document.querySelectorAll("#cards .card, #cards .row")].map((c) => ({
          full: c.classList.contains("card"), need: c.classList.contains("need"), c: box(c),
          heads: [...c.querySelectorAll(".c1,.c2")].map(box),
          // q and act are measured by their text, not their (possibly collapsed) box
          inner: [...c.querySelectorAll(".q,.act")].filter((e) => (e.textContent ?? "").trim()).map((e) => ({ n: e.className, b: box(e), sw: e.scrollWidth - e.clientWidth })),
          termShown: !!c.querySelector(".term") && getComputedStyle(c.querySelector(".term")!).display !== "none",
          last: [...c.querySelectorAll(".term .ln")].filter((l) => (l as HTMLElement).style.display !== "none").map(box).pop() ?? null,
        })),
        zone: box(zoneEl), models: box(document.querySelector("#models")!), usage: box(document.querySelector("#usage")!),
        host: box(document.querySelector("#host")!), foot: box(document.querySelector("#foot")!),
        usageTiles: [...document.querySelectorAll("#usage .tile")].map(box), hostTiles: [...document.querySelectorAll("#host .tile")].map(box),
        hostCells: [...document.querySelectorAll("#host .a, #host .disks .cap, #host .disks .hl, #host .disks .v")].map(box),
      };
    });
    for (const g of r.groups) {
      if (!r.scroll) { expect(g.g.top).toBeGreaterThanOrEqual(r.zone.top - 1); expect(g.g.bottom, "group inside #cards").toBeLessThanOrEqual(r.zone.bottom + 1); }
    }
    for (const x of r.items) {
      if (!x.full) { expect(x.need, "a needs-you session is always a full card").toBe(false); continue; }
      for (const h of x.heads) { expect(h.top).toBeGreaterThanOrEqual(x.c.top - 0.5); expect(h.bottom).toBeLessThanOrEqual(x.c.bottom + 0.5); }
      for (const i of x.inner) {
        expect(i.b.top, `${i.n} inside its card`).toBeGreaterThanOrEqual(x.c.top - 0.5);
        expect(i.b.bottom, `${i.n} inside its card`).toBeLessThanOrEqual(x.c.bottom + 0.5);
        expect(i.sw, `${i.n} not cut off sideways`).toBeLessThanOrEqual(1);
      }
      if (x.need) expect(x.inner.some((i) => i.n.includes("q")), "needs-you card shows its question").toBe(true);
      if (!x.need && x.termShown) {
        expect(x.last, "a terminal line").not.toBeNull();
        expect(x.last!.bottom, "newest line inside card").toBeLessThanOrEqual(x.c.bottom + 0.5);
        expect(x.last!.top).toBeGreaterThanOrEqual(x.c.top);
      }
      if (!r.scroll) expect(x.c.bottom, "card inside #cards").toBeLessThanOrEqual(r.zone.bottom + 1);
    }
    expect(r.models.bottom, "#models above #tabs").toBeLessThanOrEqual(r.tabs.top + 1);
    expect(r.tabs.bottom, "#tabs above #cards").toBeLessThanOrEqual(r.zone.top + 1);
    expect(r.zone.bottom, "#cards above #usage").toBeLessThanOrEqual(r.usage.top + 1);
    expect(r.usage.bottom, "#usage above #host").toBeLessThanOrEqual(r.host.top + 1);
    expect(r.host.bottom, "#host above #foot").toBeLessThanOrEqual(r.foot.top + 1);
    for (const t of [...r.usageTiles, ...r.hostTiles]) { expect(t.left).toBeGreaterThanOrEqual(r.usage.left - 0.5); expect(t.right).toBeLessThanOrEqual(r.usage.right + 0.5); }
    for (const t of r.usageTiles) { expect(t.top).toBeGreaterThanOrEqual(r.usage.top - 0.5); expect(t.bottom).toBeLessThanOrEqual(r.usage.bottom + 0.5); }
    for (const t of r.hostTiles) { expect(t.top).toBeGreaterThanOrEqual(r.host.top - 0.5); expect(t.bottom).toBeLessThanOrEqual(r.host.bottom + 0.5); }
    for (const c of r.hostCells) { expect(c.left).toBeGreaterThanOrEqual(r.host.left - 0.5); expect(c.right).toBeLessThanOrEqual(r.host.right + 0.5); }
  });
}
