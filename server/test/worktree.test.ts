import { beforeEach, describe, expect, it } from "vitest";
import { clearWorktreeCache, worktreeOf } from "../src/worktree";

/** Map value: string = .git file text, null-valued "DIR" = a .git directory. */
const files = (m: Record<string, string>) => (p: string) => (p in m ? (m[p] === "DIR" ? { kind: "dir" as const } : { kind: "file" as const, text: m[p] }) : null);
beforeEach(() => clearWorktreeCache());

describe("worktreeOf", () => {
  it("Windows paths: repo root found from a subfolder, backslashes and drive case normalised", () => {
    const read = files({ "C:/Users/dev/Desktop/HARBOR PC/harbor-website/.git": "DIR" });
    const want = { project: "C:/Users/dev/Desktop/HARBOR PC/harbor-website", worktree: null };
    expect(worktreeOf("c:\\Users\\dev\\Desktop\\HARBOR PC\\harbor-website\\src", read)).toEqual(want);
    expect(worktreeOf("C:/Users/dev/Desktop/HARBOR PC/harbor-website", read)).toEqual(want);
  });
  it("Windows paths: a folder with no .git is its own project, and the walk never probes a relative path", () => {
    const seen: string[] = [];
    const probe = (p: string) => { seen.push(p); return null; };
    expect(worktreeOf("C:\\Users\\dev\\Desktop\\HARBOR PC", probe)).toEqual({ project: "C:/Users/dev/Desktop/HARBOR PC", worktree: null });
    expect(seen.every((p) => p.startsWith("C:/"))).toBe(true);
  });
  it("Windows paths: .claude\\worktrees rule", () => {
    expect(worktreeOf("C:\\p\\app\\.claude\\worktrees\\fix-a", files({}))).toEqual({ project: "C:/p/app", worktree: "fix-a" });
  });
  it("path rule: .claude/worktrees and .worktrees inside the project", () => {
    const none = files({});
    expect(worktreeOf("/r/app/.claude/worktrees/fix-a/src", none)).toEqual({ project: "/r/app", worktree: "fix-a" });
    expect(worktreeOf("/r/app/.worktrees/loopzone", none)).toEqual({ project: "/r/app", worktree: "loopzone" });
  });
  it("sibling worktree via .git file", () => {
    const read = files({ "/r/app-followups/.git": "gitdir: /r/app/.git/worktrees/app-followups\n" });
    expect(worktreeOf("/r/app-followups", read)).toEqual({ project: "/r/app", worktree: "app-followups" });
    expect(worktreeOf("/r/app-followups/server/src", read)).toEqual({ project: "/r/app", worktree: "app-followups" });
  });
  it("plain repo or no git: project = cwd, worktree null", () => {
    expect(worktreeOf("/r/app", files({}))).toEqual({ project: "/r/app", worktree: null });
  });
  it("malformed or foreign .git file: worktree null, never throws", () => {
    expect(worktreeOf("/r/x", files({ "/r/x/.git": "garbage" }))).toEqual({ project: "/r/x", worktree: null });
    expect(worktreeOf("/r/y", files({ "/r/y/.git": "gitdir: /elsewhere/modules/y" }))).toEqual({ project: "/r/y", worktree: null });
    expect(worktreeOf("/r/z", () => { throw new Error("EACCES"); })).toEqual({ project: "/r/z", worktree: null });
  });
  it("subfolder of a normal repo resolves to the repo root", () => {
    const read = files({ "/r/app/.git": "DIR" });
    expect(worktreeOf("/r/app/pwa", read)).toEqual({ project: "/r/app", worktree: null });
    expect(worktreeOf("/r/app/pwa/src/x", read)).toEqual({ project: "/r/app", worktree: null });
  });
  it("subfolder of a sibling worktree resolves to main project and name", () => {
    const read = files({ "/r/sib/.git": "gitdir: /r/app/.git/worktrees/sib\n" });
    expect(worktreeOf("/r/sib/pwa", read)).toEqual({ project: "/r/app", worktree: "sib" });
  });
  it("a foreign .git file stops the walk at its own dir", () => {
    const read = files({ "/r/.git": "DIR", "/r/y/.git": "garbage" });
    expect(worktreeOf("/r/y/sub", read)).toEqual({ project: "/r/y", worktree: null });
  });
  it("caches per cwd", () => {
    let n = 0;
    const read = (p: string) => { n++; return p === "/r/c/.git" ? { kind: "file" as const, text: "gitdir: /r/main/.git/worktrees/c" } : null; };
    worktreeOf("/r/c", read); worktreeOf("/r/c", read);
    expect(n).toBe(1);
  });
});
