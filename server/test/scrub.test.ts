import { describe, expect, it } from "vitest";
import { Scrubber, canonCommand } from "../src/scrub";
import { parseSpoolLine, toEvents } from "../src/ingest";

const L = (event: string, payload: object, extra: object = {}) =>
  JSON.stringify({ v: 1, ts: "2026-10-03T10:00:00.000Z", src: "hook", sid: "s-real-1", cwd: "/Volumes/Disk/Dev/projects/app", event, payload, truncated: false, ...extra });
const mk = () => new Scrubber({ maps: [["/Volumes/Disk/Dev/projects/", "/Users/dev/code/"]] });
const parse = (s: string | null) => JSON.parse(s!);

describe("canonCommand", () => {
  it("keeps test, build, merge and interrogate classification", () => {
    expect(canonCommand("cd /secret && pnpm test -- foo")).toBe("pnpm test");
    expect(canonCommand("pnpm build")).toBe("pnpm build");
    expect(canonCommand("git merge --no-ff feat/x")).toBe("git merge topic");
    expect(canonCommand("git merge --abort")).toBe("true");
    expect(canonCommand("pnpm test && git push")).toBe("pnpm test && git merge topic");
    expect(canonCommand('cat "$HOME/.claude/skills/interrogate/SKILL.md"')).toBe("cat ~/.claude/skills/interrogate/SKILL.md");
    expect(canonCommand("echo my private notes")).toBe("true");
  });
});

describe("Scrubber", () => {
  it("drops prompt text and unknown payload keys", () => {
    const o = parse(mk().line(L("UserPromptSubmit", { prompt: "my secret plan", session_id: "s-real-1", brand_new_field: "x" })));
    expect(JSON.stringify(o)).not.toMatch(/secret|brand_new_field/);
    expect(o.payload).toEqual({ session_id: o.sid });
  });
  it("maps paths and ids consistently", () => {
    const s = mk();
    const a = parse(s.line(L("SessionStart", { session_id: "11111111-2222-4333-8444-555555555555", transcript_path: "/Users/someone/.claude/projects/-Volumes-Disk-Dev-projects-app/11111111-2222-4333-8444-555555555555.jsonl" }, { sid: "11111111-2222-4333-8444-555555555555" })));  // leakcheck:allow
    const b = parse(s.line(L("Stop", { session_id: "11111111-2222-4333-8444-555555555555" }, { sid: "11111111-2222-4333-8444-555555555555" })));
    expect(a.cwd).toBe("/Users/dev/code/app");
    expect(a.sid).toBe(b.sid);
    expect(a.sid).not.toBe("11111111-2222-4333-8444-555555555555");
    expect(a.payload.transcript_path).toBe(`/Users/dev/.claude/projects/-Users-dev-code-app/${a.sid}.jsonl`);
  });
  it("maps Windows home paths", () => {
    const o = parse(mk().line(L("SessionStart", {}, { cwd: "C:\\Users\\someone\\code\\app" })));  // leakcheck:allow
    expect(o.cwd).toBe("C:\\Users\\dev\\code\\app");
  });
  it("maps Linux and Git Bash home paths", () => {
    expect(parse(mk().line(L("SessionStart", {}, { cwd: "/home/someone/code/app" }))).cwd).toBe("/home/dev/code/app");  // leakcheck:allow
    expect(parse(mk().line(L("SessionStart", {}, { cwd: "/c/Users/someone/app" }))).cwd).toBe("/c/Users/dev/app");  // leakcheck:allow
    expect(parse(mk().line(L("SessionStart", {}, { cwd: "C:/Users/someone/app" }))).cwd).toBe("C:/Users/dev/app");  // leakcheck:allow
    expect(parse(mk().line(L("SessionStart", {}, { cwd: "/srv/smart-home-app-x" }))).cwd).toBe("/srv/smart-home-app-x");
    expect(parse(mk().line(L("SessionStart", {}, { cwd: "/c/.claude/projects/-home-someone-app" }))).cwd).toBe("/c/.claude/projects/-home-dev-app");  // leakcheck:allow
  });
  it("replaces free text with stable placeholders and keeps skip-up", () => {
    const s = mk();
    const d1 = parse(s.line(L("PreToolUse", { tool_name: "Agent", tool_input: { subagent_type: "executor", model: "haiku", description: "Task 3: wire the secret API", prompt: "long secret brief" } })));
    const d2 = parse(s.line(L("PreToolUse", { tool_name: "mcp__jev__log_escalation", tool_input: { from_model: "haiku", to_model: "sonnet", task: "Task 3: wire the secret API", reason: "skip-up: too hard for haiku" } })));
    expect(d1.payload.tool_input).toEqual({ subagent_type: "executor", model: "haiku", description: "task-1" });
    expect(d2.payload.tool_input).toEqual({ from_model: "haiku", to_model: "sonnet", task: "task-1", reason: "skip-up" });
  });
  it("keeps the events the reducer derives", () => {
    const s = mk();
    const raw = L("PostToolUse", { tool_name: "Write", tool_input: { file_path: "/Volumes/Disk/Dev/projects/app/docs/superpowers/plans/p.md", content: "secret plan body" }, tool_response: { interrupted: false, stdout: "secret" }, fo: { planTasks: 4, say: "Done: secret thing" } });
    const before = toEvents(parseSpoolLine(raw)!)!.map((e) => e.k);
    const out = s.line(raw)!;
    expect(out).not.toMatch(/secret/);
    expect(toEvents(parseSpoolLine(out)!)!.map((e) => e.k)).toEqual(before);
  });
  it("keeps an empty helper sid empty, so replay still pairs the line with a session by cwd", () => {
    const s = mk();
    s.line(L("SessionStart", { session_id: "s-real-1" }));
    const o = parse(s.line(L("helper", { action: "run", ok: true }, { src: "helper", sid: "" })));
    expect(o.sid).toBe("");
    expect(o.cwd).toBe("/Users/dev/code/app");
  });
  it("keeps the iTerm2 pane prefix and a UUID-shaped id, so the jump link survives", () => {
    const o = parse(mk().line(L("SessionStart", { session_id: "s-real-1" }, { term: { entry: "cli", program: "iTerm.app", iterm: "w1t0p2:55555555-EEEE-4EEE-8EEE-555555555555" } })));
    expect(o.term.iterm).toMatch(/^w1t0p2:[0-9A-Fa-f-]{36}$/);
    expect(o.term.iterm).not.toMatch(/5555/);
  });
  it("does not substitute a short id into unrelated paths", () => {
    const o = parse(mk().line(L("SessionStart", { session_id: "a", transcript_path: "/Users/p/projects/app/a.jsonl" }, { sid: "a", cwd: "/Users/p/projects/app" })));
    expect(o.cwd).toBe("/Users/dev/projects/app");
    expect(o.payload.transcript_path).toBe("/Users/dev/projects/app/a.jsonl");
  });
  it("maps a home dir with no trailing slash", () => {
    expect(parse(mk().line(L("SessionStart", {}, { cwd: "/Users/jane" }))).cwd).toBe("/Users/dev");  // leakcheck:allow
  });
  it("maps C:\\Users\\jane with no trailing separator", () => {  // leakcheck:allow
    expect(parse(mk().line(L("SessionStart", {}, { cwd: "C:\\Users\\jane" }))).cwd).toBe("C:\\Users\\dev");  // leakcheck:allow
  });
  it("maps an encoded home segment, not a dotted one it cannot know", () => {
    const o = parse(mk().line(L("SessionStart", { transcript_path: "/Users/jane/.claude/projects/-Users-jane-code-app/x.jsonl" })));  // leakcheck:allow
    expect(o.payload.transcript_path).toBe("/Users/dev/.claude/projects/-Users-dev-code-app/x.jsonl");
  });
  it("drops nested objects from kept keys", () => {
    const o = parse(mk().line(L("PreToolUse", {
      tool_name: "Agent", action: { leak: "/Users/jane/x" }, tool_input: { model: { leak: "x" }, skill: "ok" },  // leakcheck:allow
      rate_limits: { five_hour: { used_percentage: 10, resets_at: 5, extra: "x" }, seven_day: { used_percentage: 2 }, other: "x" },
      fo: { tests: { passed: 3, failed: 1, out: "x" }, result: "weird", planTasks: 2 },
    }, { term: { entry: { a: 1 }, program: "iTerm.app" } })));
    expect(o.payload.action).toBeUndefined();
    expect(o.payload.tool_input).toEqual({ skill: "ok" });
    expect(o.payload.rate_limits).toEqual({ five_hour: { used_percentage: 10, resets_at: 5 }, seven_day: { used_percentage: 2 } });
    expect(o.payload.fo.tests).toEqual({ passed: 3, failed: 1 });
    expect(o.payload.fo.result).toBeUndefined();
    expect(o.term.entry).toBeNull();
    expect(JSON.stringify(o)).not.toMatch(/leak|"x"/);
  });
  it("keeps a line that is not JSON as a fixed malformed line, so replay still counts it", () => {
    const out = mk().line("not json: secret text");
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/secret/);
    expect(parseSpoolLine(out!)).toBeNull();
  });
});

describe("Scrubber acct", () => {
  it("keeps a ~ acct, maps an absolute one, adds none", () => {
    const s = mk();
    expect(parse(s.line(L("UserPromptSubmit", { session_id: "s-real-1" }, { acct: "~/.claude-personal" }))).acct).toBe("~/.claude-personal");
    expect(parse(s.line(L("UserPromptSubmit", { session_id: "s-real-1" }, { acct: "/Volumes/Disk/Dev/projects/cfg" }))).acct).toBe("/Users/dev/code/cfg");
    expect("acct" in parse(s.line(L("UserPromptSubmit", { session_id: "s-real-1" })))).toBe(false);
  });
});
