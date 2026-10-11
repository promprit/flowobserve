import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@fo/shared";
import { helperUrl } from "../src/helper";
import { hooks, store } from "../src/state";
import { jumpTarget, readerKind, resultsLine, verbFor } from "../src/ui/verbs";
import { nav } from "../src/util";
import { T0, reset, sess } from "./helpers";

const U = "0123abcd-4567-89ab-cdef-0123456789ab";
const JUMP = `flowobserve://jump?iterm=w0t1p2%3A${U}`;
const TOKEN = "a".repeat(64);

beforeEach(() => {
  vi.restoreAllMocks(); reset();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: TOKEN });
  hooks.openReader = undefined;
});

const live = (id: string, rel: string): Project[] => [{ key: rel, name: rel, group: null, color: "#aabbcc", folders: [{ rel, worktree: null, live: id, restore: [] }] }];

describe("verbFor token", () => {
  it("offers no TRY IT without the helper token", () => {
    store.projects = live("a", "meadow");
    store.helperToken = null;
    const v = verbFor(sess("a", { ready: { tests: true, build: true, review: true }, stage: 5, runnable: true }));
    expect(v?.label).not.toBe("TRY IT");
  });
});

describe("verbFor", () => {
  it("picks one verb by state", () => {
    const open = vi.fn(); hooks.openReader = open;
    const spec = verbFor(sess("a", { status: "waiting", stage: 0, docs: { spec: 1, plan: 0, at: T0 } }));
    expect(spec?.label).not.toBe("READ SPEC");
    expect(spec).toBeNull();
    for (const stage of [1, 2]) {
      const plan = verbFor(sess("a", { status: "waiting", stage, docs: { spec: 1, plan: 1, at: T0 } }));
      expect(plan?.label).not.toBe("READ PLAN");
      expect(plan).toBeNull();
    }
    expect(open).not.toHaveBeenCalled();

    store.projects = live("a", "meadow");
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    const ready = { tests: true, build: true, review: true };
    const run = verbFor(sess("a", { ready, stage: 5, runnable: true, color: "#aabbcc" }));
    expect(run?.label).toBe("TRY IT");
    run!.run();
    expect(go).toHaveBeenCalledWith(helperUrl.run("meadow", null, "#aabbcc"));
    expect(verbFor(sess("a", { ready, stage: 5, runnable: false }))?.label).not.toBe("TRY IT");

    expect(verbFor(sess("a", { host: "iterm", status: "active", jumpUrl: JUMP }))?.label).toBe("JUMP");
    expect(verbFor(sess("a", { host: "vscode", status: "active" }))).toBeNull();
  });
});

describe("jumpTarget", () => {
  it("is the jump link for iterm and the vscode link otherwise", () => {
    expect(jumpTarget(sess("a", { host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" }))).toBe(JUMP);
    expect(jumpTarget(sess("a", { host: "vscode", openUrl: "vscode://file/x" }))).toBe("vscode://file/x");
    expect(jumpTarget(sess("a", { host: "vscode", openUrl: "javascript:alert(1)" }))).toBeNull();
    expect(jumpTarget(sess("a", { host: "iterm", jumpUrl: "javascript:alert(1)" }))).toBeNull();
  });
});

describe("resultsLine", () => {
  it("joins known parts and omits unknown ones", () => {
    expect(resultsLine(sess("a", { ready: { tests: true, build: false, review: true } }))).toBe("tests ✓ · build ✗ · review ✓");
    expect(resultsLine(sess("a", { ready: { tests: true, build: null, review: null } }))).toBe("tests ✓");
    expect(resultsLine(sess("a", { ready: { tests: null, build: true, review: null } }))).toBe("build ✓");
    expect(resultsLine(sess("a", { ready: { tests: true, build: true, review: true, passed: 140, failed: 2 } }))).toBe("140 passed · 2 failed · build ✓ · review ✓");
    expect(resultsLine(sess("a", { ready: { tests: true, build: true, review: true, passed: 140, failed: 0 } }))).toBe("140 passed · build ✓ · review ✓");
    expect(resultsLine(sess("a", { ready: { tests: false, build: true, review: true, passed: 140, failed: 2 } }))).toBe("140 passed · 2 failed · tests ✗ · build ✓ · review ✓");
    expect(resultsLine(sess("a", { ready: { tests: false, build: null, review: null, passed: 0, failed: 0 } }))).toBe("0 passed · tests ✗");
    expect(resultsLine(sess("a", { ready: { tests: null, build: null, review: null } }))).toBe("");
    expect(resultsLine(sess("a", { ready: null }))).toBe("");
  });
});

describe("iterm without a helper token behaves like v1", () => {
  it("offers no JUMP verb", () => {
    store.helperToken = null;
    expect(verbFor(sess("a", { host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" }))).toBeNull();
  });
  it("jumpTarget falls back to the vscode link", () => {
    store.helperToken = null;
    expect(jumpTarget(sess("a", { host: "iterm", jumpUrl: JUMP, openUrl: "vscode://file/x" }))).toBe("vscode://file/x");
  });
});

describe("readerKind", () => {
  it("opens the reader only for REVIEW SPEC / APPROVE PLAN with the document present", () => {
    const d = (spec: number, plan: number) => ({ spec, plan, at: T0 });
    expect(readerKind(sess("a", { action: "REVIEW SPEC", docs: d(1, 0) }))).toBe("spec");
    expect(readerKind(sess("a", { action: "REVIEW SPEC", docs: d(0, 0) }))).toBeNull();
    expect(readerKind(sess("a", { action: "APPROVE PLAN", docs: d(1, 1) }))).toBe("plan");
    expect(readerKind(sess("a", { action: "APPROVE PLAN", docs: d(1, 0) }))).toBeNull();
    expect(readerKind(sess("a", { action: "ANSWER", docs: d(1, 1) }))).toBeNull();
    expect(readerKind(sess("a", { action: null, docs: d(1, 1) }))).toBeNull();
  });
});
