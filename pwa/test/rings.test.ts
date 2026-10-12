import { describe, expect, it } from "vitest";
import type { AccountUsage } from "@fo/shared";
import { accountColumn, claudeRings, ringSvg, ringsLeft } from "../src/ui/rings";
import { T0 } from "./helpers";

const H = 3600e3;
/** used = 5h use; elapsed = hours into the 5h window (pace = elapsed / 5). */
const A = (label: string, used: number, o: Partial<AccountUsage> & { elapsed?: number; wk?: number } = {}): AccountUsage => {
  const { elapsed = 4.5, wk = 0.3, ...rest } = o;
  return { label, session: { used, startedAt: T0 - elapsed * H, windowMs: 5 * H }, weekly: { used: wk, resetsAt: T0 + 3.5 * 24 * H }, at: T0, ...rest };
};
const dom = (html: string): HTMLElement => { const d = document.createElement("div"); d.innerHTML = html; return d; };
const nums = (el: Element) => [...el.querySelectorAll(".ring .n")].map((n) => n.textContent);
const hot = (el: Element) => [...el.querySelectorAll(".ring")].map((r) => r.classList.contains("hot"));

describe("ringsLeft", () => {
  it("is what is left, as an integer percent; null stays null", () => {
    expect([0.92, 0, 1, 0.333, 0.995].map(ringsLeft)).toEqual([8, 100, 0, 67, 1]);
    expect(ringsLeft(null)).toBeNull();
  });
});

describe("ringSvg", () => {
  it("shows the number left inside and fills with what is left", () => {
    const el = dom(ringSvg(25, false));
    expect(el.querySelector(".ring .n")!.textContent).toBe("25");
    const fg = el.querySelector("circle.fg")!;
    const [on, all] = fg.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(on / all).toBeCloseTo(0.25, 2);
    expect(el.querySelector(".ring")!.className).toBe("ring");
  });
  it("amber is a class, not a colour in the markup", () => expect(dom(ringSvg(5, true)).querySelector(".ring")!.className).toBe("ring hot"));
  it("unknown: a dim empty ring with a dash", () => {
    const el = dom(ringSvg(null, false));
    expect(el.querySelector(".ring")!.className).toBe("ring dim");
    expect(el.querySelector(".n")!.textContent).toBe("—");
    expect(el.querySelector("circle.fg")).toBeNull();
  });
});

describe("accountColumn", () => {
  const col = (a: AccountUsage, o: Partial<Parameters<typeof accountColumn>[1]> = {}) =>
    dom(accountColumn(a, { you: false, t: T0, ...o })).querySelector<HTMLElement>(".rcol")!;
  it("three rings 5H, WK, FAB, each with what is left", () => {
    const c = col(A("Pro", 0.12, { wk: 0.2 }), { fable: { used: 0.3, resetsAt: T0 + 4 * 24 * H } });
    expect(nums(c)).toEqual(["88", "80", "70"]);
    expect([...c.querySelectorAll(".rg .cap")].map((k) => k.textContent)).toEqual(["5H", "WK", "FAB"]);
    expect([...c.querySelectorAll<HTMLElement>(".rg")].map((r) => r.title)).toEqual(["5H · 88% left", "WK · 80% left", "FAB · 70% left"]);
  });
  it("amber at 10 % left or less, even on pace", () => {
    expect(hot(col(A("T", 0.9, { elapsed: 4.6 })))[0]).toBe(true);
    expect(hot(col(A("T", 0.89, { elapsed: 4.6 })))[0]).toBe(false);
  });
  it("amber when ahead of pace (same 15-point rule as the tiles)", () => {
    expect(hot(col(A("T", 0.5, { elapsed: 1 })))[0]).toBe(true);   // pace 0.2
    expect(hot(col(A("T", 0.3, { elapsed: 1 })))[0]).toBe(false);
    expect(hot(col(A("T", 0.1, { wk: 0.9 })))[1]).toBe(true);      // weekly 3.5 days in: pace 0.5
  });
  it("Fable not reported for this account: a dim dash", () => {
    const c = col(A("Pro", 0.12));
    expect(nums(c)[2]).toBe("—");
    expect(c.querySelectorAll(".ring")[2].classList.contains("dim")).toBe(true);
    expect(c.querySelectorAll<HTMLElement>(".rg")[2].title).toBe("FAB · not reported");
  });
  it("a 5h window that already reset: a dim dash, not 100", () => {
    const c = col(A("Pro", 0.6, { elapsed: 6 }));
    expect(nums(c)[0]).toBe("—");
  });
  it("label truncates with an ellipsis class and shows in full on hover", () => {
    const l = col(A("Sandbox-very-long-name", 0.1)).querySelector<HTMLElement>(".al")!;
    expect(l.textContent).toBe("Sandbox-very-long-name");
    expect(l.title).toBe("Sandbox-very-long-name");
  });
  it("the green dot marks the account you are on, only that one", () => {
    expect(col(A("Team", 0.1), { you: true }).querySelectorAll(".you")).toHaveLength(1);
    expect(col(A("Pro", 0.1)).querySelector(".you")).toBeNull();
  });
  it("a stale reading dims and never glows amber", () => {
    const c = col(A("Pro", 0.95, { at: T0 - 6 * H, elapsed: 4.9 }));
    expect(c.classList.contains("stale")).toBe(true);
    expect(hot(c)).toEqual([false, false, false]);
    expect(c.title).toMatch(/^AS OF /);
  });
  it("escapes labels", () => expect(accountColumn(A("<b>", 0.1), { you: false, t: T0 })).not.toContain("<b>"));
});

describe("claudeRings", () => {
  const L = ["Team", "Pro", "Lab", "Client", "Personal", "Research", "Ops", "Sandbox"];
  const accts = (n: number) => L.slice(0, n).map((l, i) => A(l, 0.1 * i, i === 0 ? { primary: true } : {}));
  const block = (n: number, cycle = 0) => dom(claudeRings(accts(n), cycle, { t: T0 })).querySelector<HTMLElement>(".rings")!;
  const labels = (el: Element) => [...el.querySelectorAll(".rcol .al")].map((x) => x.textContent);
  it("one equal column per account, up to 4", () => {
    for (const n of [2, 3, 4]) {
      const b = block(n);
      expect(b.querySelectorAll(".rcol")).toHaveLength(n);
      expect(b.style.getPropertyValue("--c")).toBe(String(n));
      expect(b.querySelectorAll(".dots")).toHaveLength(0);
    }
  });
  it("5 or more: first three stay, the 4th cycles through the rest with one dot each", () => {
    const b0 = block(8, 0), b1 = block(8, 1), b5 = block(8, 5);
    expect(b0.querySelectorAll(".rcol")).toHaveLength(4);
    expect(b0.style.getPropertyValue("--c")).toBe("4");
    expect(labels(b0)).toEqual(["Team", "Pro", "Lab", "Client"]);
    expect(labels(b1)).toEqual(["Team", "Pro", "Lab", "Personal"]);
    expect(labels(b5)).toEqual(["Team", "Pro", "Lab", "Client"]);
    const c = b1.querySelectorAll(".rcol")[3];
    expect(c.classList.contains("cyc")).toBe(true);
    expect(c.querySelectorAll(".dots i")).toHaveLength(5);
    expect([...c.querySelectorAll(".dots i")].map((i) => i.className)).toEqual(["", "on", "", "", ""]);
    expect(b1.querySelectorAll(".rcol.cyc")).toHaveLength(1);
    expect(block(5, 3).querySelectorAll(".dots i")).toHaveLength(2);
  });
  it("the account you are on comes first and carries the dot; Fable only there", () => {
    const list = [A("Pro", 0.1), A("Team", 0.2, { primary: true })];
    const b = dom(claudeRings(list, 0, { t: T0, fable: { used: 0.4, resetsAt: T0 + 24 * H } })).querySelector(".rings")!;
    expect(labels(b)).toEqual(["Team", "Pro"]);
    expect(b.querySelectorAll(".rcol")[0].querySelectorAll(".you")).toHaveLength(1);
    expect(b.querySelectorAll(".rcol .you")).toHaveLength(1);
    expect(nums(b.querySelectorAll(".rcol")[0])[2]).toBe("60");
    expect(nums(b.querySelectorAll(".rcol")[1])[2]).toBe("—");
  });
});
