import { describe, expect, it } from "vitest";
import { BUILD_RE, TEST_RE, parseSpoolLine, toEvents } from "../src/ingest";
import { T0, mk } from "./helpers";

const m = mk();
const ITERM = { entry: "cli", program: "iTerm.app", iterm: "w0t0p1:1B2C3D4E-0000-4000-8000-00000000ABCD" };
const ev = (raw: string) => toEvents(parseSpoolLine(raw)!)!;
const withTop = (raw: string, extra: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(raw), ...extra });

describe("parseSpoolLine v2", () => {
  it("keeps src helper and a well-formed term", () => {
    expect(parseSpoolLine(m.helper(1, "run", true))!.src).toBe("helper");
    expect(parseSpoolLine(m.startT(1, ITERM))!.term).toEqual(ITERM);
    expect(parseSpoolLine(m.startT(1, { entry: null, program: null, iterm: null }))!.term)
      .toEqual({ entry: null, program: null, iterm: null });
  });
  it("drops a malformed term", () => {
    expect(parseSpoolLine(m.startT(1, { ...ITERM, entry: 5 }))!.term).toBeUndefined();
  });
  it("maps an unknown src to hook", () => {
    expect(parseSpoolLine(withTop(m.start(1), { src: "weird" }))!.src).toBe("hook");
  });
});

describe("toEvents v2", () => {
  it("SessionSeen carries term; End carries reason", () => {
    expect(ev(m.startT(1, ITERM))[0]).toMatchObject({ k: "SessionSeen", term: ITERM });
    expect(ev(m.endR(1, "other"))[0]).toMatchObject({ k: "End", reason: "other" });
  });
  it("BashResult only for test/build commands on the main thread", () => {
    expect(ev(m.bash(1, "pnpm test", true))).toContainEqual(expect.objectContaining({ k: "BashResult", kind: "test", ok: true }));
    expect(ev(m.bash(1, "pnpm build", false))).toContainEqual(expect.objectContaining({ k: "BashResult", kind: "build", ok: false }));
    expect(ev(m.bash(1, "git status", true)).some((e) => e.k === "BashResult")).toBe(false);
    const sub = m.line("PostToolUse", 1, { tool_name: "Bash", tool_input: { command: "pnpm test" }, tool_response: {}, agent_id: "a1" });
    expect(ev(sub).some((e) => e.k === "BashResult")).toBe(false);
  });
  it("BashResult carries integer test counts only", () => {
    expect(ev(m.bash(1, "pytest", true, { passed: 3, failed: 0 })))
      .toContainEqual(expect.objectContaining({ k: "BashResult", passed: 3, failed: 0 }));
  });
  it("Helper maps known actions and drops unknown ones", () => {
    expect(ev(m.helper(1, "jump", true, "s1"))).toContainEqual(expect.objectContaining({ k: "Helper", action: "jump", ok: true }));
    expect(ev(m.helper(1, "nope", true, "s1")).some((e) => e.k === "Helper")).toBe(false);
  });
  it("Helper maps the diff action", () => {
    const line = JSON.stringify({ v: 1, ts: new Date(T0 + 1000).toISOString(), src: "helper", sid: "s1", cwd: "/p/app", event: "helper", payload: { action: "diff", ok: true }, truncated: false });
    expect(ev(line).filter((e) => e.k === "Helper")).toEqual([expect.objectContaining({ k: "Helper", action: "diff", ok: true })]);
  });
});

describe("TEST_RE / BUILD_RE", () => {
  it("match common commands and ignore lookalikes", () => {
    for (const c of ["pnpm test", "pnpm -r test", "pnpm --filter @fo/server test", "npm run test", "vitest run", "python3 -m pytest", "cd x && pytest -q"])
      expect(TEST_RE.test(c)).toBe(true);
    for (const c of ["pnpm build", "tsc --noEmit", "npm run build"]) expect(BUILD_RE.test(c)).toBe(true);
    expect(TEST_RE.test("git status")).toBe(false);
    expect(BUILD_RE.test("echo pnpm-build-notes")).toBe(false);
  });
});

describe("command regexes", () => {
  const yes = ["pnpm test", "pnpm -r test 2>&1 | tail", "cd x && pnpm test", "/usr/bin/python3 -m pytest -q", "(pnpm test; pnpm build)", "vitest", "pytest -q", "TZ=Asia/Bangkok npx vitest run", "cd server && TZ=Asia/Bangkok npx vitest", "FOO=1 pnpm test", "pnpm exec vitest run"];
  const no = ["pip install pytest", "cat pytest.ini", "grep -n pytest README.md", 'git commit -m "fix npm test"', "echo vitest", "pnpm testing", "echo TZ=1 npx vitest"];
  for (const c of yes) it(`TEST_RE matches ${c}`, () => expect(TEST_RE.test(c) || BUILD_RE.test(c)).toBe(true));
  for (const c of no) it(`TEST_RE rejects ${c}`, () => expect(TEST_RE.test(c)).toBe(false));
  it("BUILD_RE needs a segment start and a boundary", () => {
    expect(BUILD_RE.test("pnpm build")).toBe(true);
    expect(BUILD_RE.test("cd x && tsc --noEmit")).toBe(true);
    expect(BUILD_RE.test("echo tsc")).toBe(false);
    expect(BUILD_RE.test("pnpm builder")).toBe(false);
  });
});

describe("review tool", () => {
  it("PreToolUse mcp__jev__log_review → ReviewLogged", () => {
    const evs = toEvents(parseSpoolLine(JSON.stringify({ v: 1, ts: "2026-10-07T06:19:00Z", src: "hook", sid: "s1", cwd: "/p/app",
      event: "PreToolUse", payload: { tool_name: "mcp__jev__log_review", tool_input: { round: 2 } }, truncated: false }))!)!;
    expect(evs.map((e) => e.k)).toEqual(["ToolPre", "ReviewLogged"]);
  });
});
