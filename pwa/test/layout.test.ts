import { describe, expect, it } from "vitest";
import { layoutPages, sessionLabel, type LayoutSession } from "../src/layout";

let n = 0;
const S = (p: Partial<LayoutSession> & { name: string }): LayoutSession =>
  ({ id: `s${++n}`, openUrl: `vscode://file/r/${p.name}`, status: "active", startedAt: n, lastEventAt: n, worktree: null, title: null, ...p });

describe("layoutPages", () => {
  const names = (ps: ReturnType<typeof layoutPages>) => ps.map((p) => p.groups.map((g) => g.name));
  it("groups keep first-appearance order; status and activity never reorder them", () => {
    const a = S({ name: "a", startedAt: 1 }), b = S({ name: "b", startedAt: 2, lastEventAt: 999 }), c = S({ name: "c", startedAt: 3, status: "waiting" });
    expect(names(layoutPages([c, b, a]))).toEqual([["a"], ["b"], ["c"]]);
    expect(names(layoutPages([{ ...a, status: "idle" }, b, c]))).toEqual([["a"], ["b"], ["c"]]);
  });
  it("a group's place is its earliest session start", () => {
    const x1 = S({ name: "x", startedAt: 5 }), y = S({ name: "y", startedAt: 3 }), x2 = S({ name: "x", startedAt: 1 });
    expect(names(layoutPages([x1, y, x2]))).toEqual([["x"], ["y"]]);
  });
  it("sessions keep start order inside a group, needs-you included", () => {
    const g = [S({ name: "p", startedAt: 1 }), S({ name: "p", startedAt: 2, status: "waiting" }), S({ name: "p", startedAt: 3 })];
    expect(layoutPages(g)[0].groups[0].sessions.map((x) => x.id)).toEqual(g.map((s) => s.id));
  });
  it("every session is a full card", () => {
    const ss = layoutPages(Array.from({ length: 7 }, () => S({ name: "seven" })))[0].groups[0].sessions;
    expect(ss).toHaveLength(7);
  });
  it("one project per page; a big group is never split", () => {
    const small = S({ name: "small", startedAt: 0 }), big = [1, 2, 3, 4].map(() => S({ name: "big" }));
    const pages = layoutPages([...big, small]);
    expect(names(pages)).toEqual([["small"], ["big"]]);
    expect(pages.map((p) => p.groups.length)).toEqual([1, 1]);
    expect(pages[1].groups[0].sessions).toHaveLength(4);
  });
  it("same folder name, different paths: two pages; empty list = no pages", () => {
    const x = S({ name: "app", openUrl: "vscode://file/r1/app" }), y = S({ name: "app", openUrl: "vscode://file/r2/app" });
    expect(layoutPages([x, y]).map((p) => p.groups.length)).toEqual([1, 1]);
    expect(layoutPages([])).toEqual([]);
  });
});

describe("sessionLabel", () => {
  it("main, number only when >1 live share project+worktree, start order", () => {
    const a = S({ name: "p", title: "Fix tools" }), b = S({ name: "p", title: "README" }), w = S({ name: "p", worktree: "loopzone" });
    const all = [a, b, w];
    expect(sessionLabel(a, all)).toEqual({ wt: "main", title: "Fix tools" });
    expect(sessionLabel(b, all)).toEqual({ wt: "main 2", title: "README" });
    expect(sessionLabel(w, all)).toEqual({ wt: "loopzone", title: null });
    expect(sessionLabel(b, [b])).toEqual({ wt: "main", title: "README" });
  });
  it("whitespace-only title = no title; emoji kept", () => {
    expect(sessionLabel(S({ name: "q", title: "   " }), []).title).toBeNull();
    const e = S({ name: "q2", title: "🚀 ship it" });
    expect(sessionLabel(e, [e]).title).toBe("🚀 ship it");
  });
});
