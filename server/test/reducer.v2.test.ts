import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const ITERM = { entry: "cli", program: "iTerm.app", iterm: "w0t0p1:1B2C3D4E-0000-4000-8000-00000000ABCD" };
function run(lines: string[]) {
  const e = new Engine(new Store(":memory:"), () => at(10_000));
  for (const l of lines) e.ingestSpool(l);
  return e;
}
const state = (e: Engine) => [...(e as unknown as { sessions: Map<string, any> }).sessions.values()][0];

describe("reducer v2", () => {
  it("keeps the latest spec and plan path for the cycle", () => {
    const m = mk();
    const e = run([m.startT(1, ITERM), m.prompt(2),
      m.post(3, "Write", { file_path: "/p/app/docs/superpowers/specs/a-design.md" }),
      m.post(4, "Write", { file_path: "/p/app/docs/superpowers/plans/b.md" })]);
    expect(state(e).specPath).toBe("/p/app/docs/superpowers/specs/a-design.md");
    expect(state(e).planPath).toBe("/p/app/docs/superpowers/plans/b.md");
  });
  it("stores term from SessionStart and replaces it on resume", () => {
    const m = mk();
    const e = run([m.line("SessionStart", 1, { source: "startup" }), m.startT(5, ITERM)]);
    expect(state(e).term).toEqual(ITERM);
  });
  it("records end reason and prompt count", () => {
    const m = mk();
    const e = run([m.startT(1, ITERM), m.prompt(2), m.endR(3, "other")]);
    expect(state(e).prompts).toBe(1);
    expect(state(e).lastEnd).toBe("other");
  });
  it("tracks tests and build results", () => {
    const m = mk();
    const e = run([m.startT(1, ITERM), m.prompt(2), m.bash(3, "pnpm -r test", true), m.bash(4, "pnpm build", false)]);
    expect(state(e).ready).toEqual({ tests: true, build: false, review: null });
  });
  it("keeps test counts from fo.tests", () => {
    const m = mk();
    const e = run([m.startT(1, ITERM), m.prompt(2), m.bash(3, "pnpm test", false, { passed: 140, failed: 2 })]);
    expect(state(e).ready).toMatchObject({ tests: false, passed: 140, failed: 2 });
  });
  it("ignores non-test Bash commands", () => {
    const m = mk();
    const e = run([m.startT(1, ITERM), m.prompt(2), m.bash(3, "git status", true)]);
    expect(state(e).ready ?? null).toBeNull();
  });
  it("a helper run row with the session's sid sets ranAt", () => {
    const m = mk();
    const e = run([m.startT(1, ITERM), m.prompt(2), m.helper(3, "run", true, m.sid)]);
    expect(state(e).ranAt).toBe(at(3));
  });
});

describe("reducer v2 fixes", () => {
  it("a failing parsed count sets tests false even on PostToolUse", () => {
    const m = mk();
    const e = run([m.startT(1, ITERM), m.prompt(2), m.bash(3, "pnpm test", true, { passed: 10, failed: 2 })]);
    expect(state(e).ready).toMatchObject({ tests: false, passed: 10, failed: 2 });
  });
  it("commit then merge records one try row", () => {
    const m = mk();
    const store = new Store(":memory:");
    const e = new Engine(store, () => at(10_000));
    for (const l of [m.startT(1, ITERM), m.prompt(2), m.helper(3, "run", true, m.sid),
      m.pre(4, "Skill", { skill: "commit" }), m.bash(5, "git merge feat", true)]) e.ingestSpool(l);
    expect(store.callsSince(0).filter((r) => r.role === "try")).toHaveLength(1);
  });
});
