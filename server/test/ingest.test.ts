import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { execModel, parseSpoolLine, toEvents } from "../src/ingest";
import { parseJevLine, parseJevTs } from "../src/jev";
import { at, jev, mk } from "./helpers";

const a = mk();
const ev = (raw: string) => toEvents(parseSpoolLine(raw)!)!;
const kinds = (raw: string) => ev(raw).map((e) => e.k);

describe("parseSpoolLine", () => {
  it("rejects malformed, wrong version and bad timestamps", () => {
    expect(parseSpoolLine("{not json")).toBeNull();
    expect(parseSpoolLine(JSON.stringify({ v: 2, ts: "2026-10-03T00:00:00Z", sid: "s", event: "Stop" }))).toBeNull();
    expect(parseSpoolLine(JSON.stringify({ v: 1, ts: "nope", sid: "s", event: "Stop" }))).toBeNull();
  });
  it("keeps the truncated flag", () => {
    const raw = JSON.stringify({ ...JSON.parse(a.stop(1)), truncated: true });
    expect(parseSpoolLine(raw)!.truncated).toBe(true);
  });
});

describe("toEvents", () => {
  it("carries session_title: trimmed, capped at 120, ignored unless a non-empty string", () => {
    const t = (title: unknown) => ev(a.line("UserPromptSubmit", 1, { session_title: title }))[0].title;
    expect(t("  Fix tools  ")).toBe("Fix tools");
    expect(t("x".repeat(200))).toHaveLength(120);
    expect(t("   ")).toBeUndefined();
    expect(t(42)).toBeUndefined();
  });
  it("returns null for unknown event types", () => {
    expect(toEvents(parseSpoolLine(a.line("SomethingNew", 1))!)).toBeNull();
  });
  it("maps the workflow signals", () => {
    expect(kinds(a.pre(1, "Skill", { skill: "superpowers:brainstorming" }))).toEqual(["ToolPre", "Skill"]);
    expect(ev(a.pre(1, "Agent", { subagent_type: "executor", model: "opus" }))[2]).toMatchObject({ k: "Dispatch", model: "opus" });
    expect(kinds(a.pre(1, "Agent", { subagent_type: "Explore" }))).toEqual(["ToolPre", "AgentDispatch"]);
    expect(kinds(a.pre(1, "mcp__jev__jev_judge"))).toEqual(["ToolPre", "JevJudge"]);
    // orchestrate reads the interrogate skill instead of invoking it
    expect(ev(a.pre(1, "Read", { file_path: "/Users/p/.claude/skills/interrogate/SKILL.md" }))[1])
      .toMatchObject({ k: "Skill", skill: "interrogate" });
    expect(kinds(a.pre(1, "Read", { file_path: "/r/docs/interrogate/SKILL.md.bak" }))).toEqual(["ToolPre"]);
    expect(ev(a.pre(1, "mcp__jev__log_escalation", { from_model: "sonnet", to_model: "opus", task: "Task 2" }))[1])
      .toMatchObject({ k: "Escalation", from: "sonnet", to: "opus", task: "Task 2" });
    expect(ev(a.pre(1, "AskUserQuestion", { questions: [{ question: "Which DB?" }] }))[1])
      .toMatchObject({ k: "Await", why: "question", text: "Which DB?" });
  });
  it("detects plan and spec writes, with the hook's task count", () => {
    expect(ev(a.post(1, "Write", { file_path: "/r/docs/superpowers/plans/x.md" }, { planTasks: 4 }))[1])
      .toMatchObject({ k: "PlanWritten", tasks: 4 });
    expect(ev(a.post(1, "Write", { file_path: "/r/.orchestrate/PLAN.md" }))[1]).toMatchObject({ k: "PlanWritten", tasks: null });
    expect(kinds(a.post(1, "Write", { file_path: "/r/docs/superpowers/specs/s.md" }))).toEqual(["ToolPost", "SpecWritten"]);
    expect(kinds(a.post(1, "Write", { file_path: "/r/src/plans/x.md" }))).toEqual(["ToolPost"]);
  });
  it("detects merge and push only from Bash", () => {
    expect(kinds(a.post(1, "Bash", { command: "git merge feat/x" }))).toEqual(["ToolPost", "Merge"]);
    expect(kinds(a.post(1, "Bash", { command: "git -C /r push origin main" }))).toEqual(["ToolPost", "Merge"]);
    expect(kinds(a.post(1, "Bash", { command: "git status" }))).toEqual(["ToolPost"]);
    for (const c of ["git merge-base a b", "git merge --abort", "git push --dry-run", "git push -n origin main"])
      expect(kinds(a.post(1, "Bash", { command: c }))).toEqual(["ToolPost"]);
    expect(kinds(a.post(1, "Bash", { command: "git merge x" }, undefined, "ag1"))).toEqual(["ToolPost"]);
    expect(kinds(a.line("PostToolUseFailure", 1, { tool_name: "Bash", tool_input: { command: "git push" } }))).toEqual(["ToolPost"]);
  });
  it("maps subagents with agent ids, and tool events inside subagents", () => {
    expect(ev(a.subStart(1, "ag1"))[0]).toMatchObject({ k: "SubStart", subId: "ag1", executor: true, agentId: null });
    expect(ev(a.subStop(1, "ag1", "fail"))[0]).toMatchObject({ k: "SubDone", subId: "ag1", ok: false });
    expect(ev(a.subStop(1, "ag1", "unknown"))[0]).toMatchObject({ ok: null });
    expect(ev(a.pre(1, "Bash", { command: "ls" }, "ag1"))[0]).toMatchObject({ k: "ToolPre", agentId: "ag1" });
  });
  it("maps waiting signals", () => {
    expect(ev(a.stop(1, "Done, want me to merge?"))).toMatchObject([
      { k: "Await", why: "stop", text: "Done, want me to merge?" },
      { k: "Say", text: "Done, want me to merge?" },
    ]);
    expect(ev(a.notify(1, "Claude needs your permission to use Bash"))[0]).toMatchObject({ k: "Await", why: "notification" });
    expect(ev(a.notify(1, "Claude is waiting for your input", "idle_prompt"))[0]).toMatchObject({ k: "Await", why: "idle" });
  });
  it("parses usage lines (resets_at seconds → ms)", () => {
    const [u] = ev(a.usage(10, 42.5, 18, 1.5));
    expect(u).toMatchObject({ k: "Usage", costUsd: 1.5, model: "claude-opus-5-5" });
    if (u.k !== "Usage") throw new Error("not usage");
    expect(u.fiveHour).toEqual({ pct: 42.5, resetsAt: Math.floor(at(10) / 1000) * 1000 + 3600_000 });
  });
  it("tolerates a usage line without limits", () => {
    const [u] = ev(a.line("usage", 1, { rate_limits: {}, cost: null, model: null }, "statusline"));
    expect(u).toMatchObject({ k: "Usage", fiveHour: null, sevenDay: null, costUsd: null, model: null });
  });
  it("carries tool_use_id on tool events and the SessionStart source", () => {
    const a = mk();
    expect(ev(a.line("PreToolUse", 1, { tool_name: "Bash", tool_input: {}, tool_use_id: "t1" }))[0]).toMatchObject({ k: "ToolPre", useId: "t1" });
    expect(ev(a.line("PostToolUseFailure", 2, { tool_name: "Bash", tool_use_id: "t1" }))[0]).toMatchObject({ k: "ToolPost", useId: "t1" });
    expect(ev(a.line("SessionStart", 3, { source: "clear" }))[0]).toMatchObject({ k: "SessionSeen", source: "clear" });
  });
  it("execModel defaults to sonnet", () => {
    expect([execModel("fable"), execModel("claude-opus-5-5"), execModel(undefined)]).toEqual(["fable", "opus", "sonnet"]);
  });
});

describe("Jev lines", () => {
  it("normalizes +0700 timestamps", () => {
    expect(parseJevTs("2026-10-03T10:00:00+0700")).toBe(Date.parse("2026-10-03T03:00:00Z"));
  });
  it("classifies deny, override and cost lines", () => {
    expect(parseJevLine("gate", jev(5, { tool: "Bash", head: "rm", decision: "deny", cost: 2e-5 })))
      .toMatchObject({ kind: "deny", tool: "Bash", head: "rm", cost: 2e-5, ts: at(5), sid: null });
    expect(parseJevLine("gate", jev(5, { tool: "Bash", head: "ls", decision: "none" }))).toMatchObject({ kind: "other", cost: 0 });
    expect(parseJevLine("overrides", jev(5, { question: "q" }))).toMatchObject({ kind: "override" });
    expect(parseJevLine("gate", jev(5, { session_id: "s9", cwd: "/x", decision: "deny" }))).toMatchObject({ sid: "s9", cwd: "/x" });
    expect(parseJevLine("gate", "{bad")).toBeNull();
    expect(parseJevLine("gate", JSON.stringify({ decision: "deny" }))).toBeNull();
  });
});

describe("agent dispatch", () => {
  it("emits AgentDispatch before Dispatch for an executor, with description as task", () => {
    const out = ev(a.pre(1, "Agent", { subagent_type: "executor", model: "opus", description: "T1 tester" }));
    expect(out.map((e) => e.k)).toEqual(["ToolPre", "AgentDispatch", "Dispatch"]);
    expect(out[1]).toMatchObject({ k: "AgentDispatch", subType: "executor", model: "opus", task: "T1 tester", agentId: null });
  });
  it("emits only AgentDispatch for a non-executor, model null when absent, parent = caller", () => {
    const out = ev(a.pre(1, "Task", { subagent_type: "Explore", description: "find x" }, "ag9"));
    expect(out.map((e) => e.k)).toEqual(["ToolPre", "AgentDispatch"]);
    expect(out[1]).toMatchObject({ subType: "Explore", model: null, task: "find x", agentId: "ag9" });
  });
  it("defaults an executor to sonnet, clips the task to 160, maps blank to null", () => {
    expect(ev(a.pre(1, "Agent", { subagent_type: "executor", description: "d".repeat(300) }))[1])
      .toMatchObject({ model: "sonnet", task: "d".repeat(160) });
    expect(ev(a.pre(1, "Agent", { subagent_type: "executor", description: "  " }))[1]).toMatchObject({ task: null });
  });
  it("carries useId from tool_use_id, null when absent", () => {
    const raw = a.line("PreToolUse", 1, { tool_name: "Agent", tool_input: { subagent_type: "executor" }, tool_use_id: "toolu_X" });
    expect(ev(raw)[1]).toMatchObject({ k: "AgentDispatch", useId: "toolu_X" });
    expect(ev(a.pre(1, "Agent", { subagent_type: "executor" }))[1]).toMatchObject({ useId: null });
  });
  it("a haiku model is \"haiku\" for a non-executor and for an executor", () => {
    expect(ev(a.pre(1, "Task", { subagent_type: "Explore", model: "claude-haiku-4-5" }))[1]).toMatchObject({ model: "haiku" });
    expect(ev(a.pre(1, "Agent", { subagent_type: "executor", model: "claude-haiku-4-5" }))[1]).toMatchObject({ k: "AgentDispatch", model: "haiku" });
  });
  it("an unknown model string is null", () => {
    expect(ev(a.pre(1, "Task", { subagent_type: "Explore", model: "gpt-x" }))[1]).toMatchObject({ model: null });
    expect(ev(a.pre(1, "Agent", { subagent_type: "executor", model: "gpt-x" }))[1]).toMatchObject({ k: "AgentDispatch", model: null });
  });
  it("never reads the prompt", () => {
    const e = ev(a.pre(1, "Agent", { subagent_type: "executor", prompt: "secret plan text" }))[1];
    expect(JSON.stringify(e)).not.toContain("secret");
  });
  it("SubStart carries agentType for every type", () => {
    expect(ev(a.subStart(1, "ag1", "Explore"))[0]).toMatchObject({ k: "SubStart", subId: "ag1", executor: false, agentType: "Explore" });
    expect(ev(a.subStart(1, "ag2"))[0]).toMatchObject({ executor: true, agentType: "executor" });
  });
  it("execModel reads haiku; empty stays sonnet; Dispatch and Escalation carry haiku", () => {
    expect(execModel("claude-haiku-4-5")).toBe("haiku");
    expect(execModel("")).toBe("sonnet");
    expect(execModel(undefined)).toBe("sonnet");
    expect(ev(a.pre(1, "Agent", { subagent_type: "executor", model: "claude-haiku-4-5" }))[2]).toMatchObject({ k: "Dispatch", model: "haiku" });
    expect(ev(a.pre(1, "mcp__jev__log_escalation", { from_model: "haiku", to_model: "sonnet", task: "T1" }))[1])
      .toMatchObject({ k: "Escalation", from: "haiku", to: "sonnet", task: "T1" });
  });});

describe("helper new rows", () => {
  const newRow = (ok: boolean) => JSON.stringify({
    v: 1, ts: new Date(at(1)).toISOString(), src: "helper", sid: "", cwd: "/r/new-proj", event: "helper",
    payload: { action: "new", ok, name: "new-proj" }, truncated: false,
  });
  it("is accepted and counted, not treated as an orphan", () => {
    const e = new Engine(new Store(":memory:"), () => at(2));
    e.ingestSpool(newRow(true));
    e.ingestSpool(newRow(false));
    expect(e.counts["helper-orphan"]).toBeUndefined();
    expect(e.counts["new:ok"]).toBe(1);
    expect(e.counts["new:failed"]).toBe(1);
  });
});

describe("skip-up and Bash-read interrogate", () => {
  const esc = (reason: unknown) => ev(a.pre(1, "mcp__jev__log_escalation", { from_model: "haiku", to_model: "sonnet", task: "T1", reason })).find((e) => e.k === "Escalation") as { skip?: true };
  it("flags a skip-up reason, case-insensitive after trim", () => {
    expect(esc("skip-up: trivial")!.skip).toBe(true);
    expect(esc("  Skip-Up: why")!.skip).toBe(true);
  });
  it("leaves a real reason unflagged", () => {
    expect(esc("failed done-criteria").skip).toBeUndefined();
    expect(esc(undefined).skip).toBeUndefined();
  });
  const isk = (raw: string) => ev(raw).some((e) => e.k === "Skill" && e.skill === "interrogate");
  const bash = (command: string, agent?: string) => isk(a.pre(1, "Bash", { command }, agent));
  it("Bash reading the installed interrogate SKILL.md emits the Skill event", () => {
    expect(bash("cat /Users/dev/.claude/skills/interrogate/SKILL.md")).toBe(true);
    expect(bash("cat ~/.claude/skills/interrogate/SKILL.md")).toBe(true);
    expect(bash('sed -n 1,40p "$HOME/.claude/skills/interrogate/SKILL.md"')).toBe(true);
    expect(bash("cd x && cat ~/.claude/skills/interrogate/SKILL.md | head")).toBe(true);
  });
  it("Windows and Linux home paths and readers count too", () => {
    for (const c of [
      "cat C:/Users/dev/.claude/skills/interrogate/SKILL.md",
      'cat "C:\\Users\\dev\\.claude\\skills\\interrogate\\SKILL.md"',
      "cat /c/Users/dev/.claude/skills/interrogate/SKILL.md",
      "cat /home/dev/.claude/skills/interrogate/SKILL.md",
      'cat "${HOME}/.claude/skills/interrogate/SKILL.md"',
      "type %USERPROFILE%\\.claude\\skills\\interrogate\\SKILL.md",
      "Get-Content $env:USERPROFILE\\.claude\\skills\\interrogate\\SKILL.md",
      "get-content c:\\users\\dev\\.claude\\skills\\interrogate\\SKILL.md",
      'cat "$HOME"/.claude/skills/interrogate/SKILL.md',
      'type "%USERPROFILE%"\\.claude\\skills\\interrogate\\SKILL.md',
    ]) expect(bash(c), c).toBe(true);
    expect(bash("cat claude\\skills\\interrogate\\SKILL.md")).toBe(false);
    expect(bash("cat D:/x/myskills/interrogate/SKILL.md")).toBe(false);
    expect(bash("git gc && echo ~/.claude/skills/interrogate/SKILL.md")).toBe(false);
    expect(bash("cat > notes.md <<'EOF'\ncat ~/.claude/skills/interrogate/SKILL.md\nEOF")).toBe(false);
  });
  it("Bash that only mentions the file or the word does not", () => {
    for (const c of [
      "echo interrogate",
      "grep -n foo skills/interrogate/SKILL.md",
      "grep -rn 'skills/interrogate/SKILL.md' server",
      "git diff main -- claude/skills/interrogate/SKILL.md",
      "git add claude/skills/interrogate/SKILL.md",
      "git commit -m 'edit skills/interrogate/SKILL.md'",
      "cat >> .orchestrate/PLAN.md <<EOF\ncodex/skills/interrogate/SKILL.md\nEOF",
      "cat /x/myskills/interrogate/SKILL.md",
      "cat claude/skills/interrogate/SKILL.md",
    ]) expect(bash(c), c).toBe(false);
  });
  it("only the main thread's read counts", () => {
    expect(bash("cat ~/.claude/skills/interrogate/SKILL.md", "sub1")).toBe(false);
    expect(isk(a.pre(1, "Read", { file_path: "/Users/p/.claude/skills/interrogate/SKILL.md" }, "sub1"))).toBe(false);
  });
  it("a Read of repo-local claude/skills/interrogate/SKILL.md does not count", () => {
    expect(isk(a.pre(1, "Read", { file_path: "/r/dryas-workflow/claude/skills/interrogate/SKILL.md" }))).toBe(false);
  });
});

describe("Windows paths (windows spec §3.2)", () => {
  const line = (cwd: string, filePath: string) => JSON.stringify({
    v: 1, ts: "2026-10-07T09:00:00.000Z", src: "hook", sid: "w1", cwd, event: "PostToolUse",
    payload: { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: filePath } },
  });
  it("spool cwd is normalised", () => {
    expect(parseSpoolLine(line("c:\\Users\\dev\\app", "C:\\Users\\dev\\app\\a.ts"))!.cwd).toBe("C:/Users/dev/app");
  });
  it("a spec and a plan written with backslashes are recognised", () => {
    const spec = toEvents(parseSpoolLine(line("C:\\p", "C:\\p\\docs\\superpowers\\specs\\x-design.md"))!)!;
    expect(spec).toContainEqual(expect.objectContaining({ k: "SpecWritten", path: "C:/p/docs/superpowers/specs/x-design.md" }));
    const plan = toEvents(parseSpoolLine(line("C:\\p", "C:\\p\\docs\\superpowers\\plans\\x.md"))!)!;
    expect(plan).toContainEqual(expect.objectContaining({ k: "PlanWritten", path: "C:/p/docs/superpowers/plans/x.md" }));
  });
  it("interrogate Read with a Windows path counts as the skill", () => {
    const events = ev(a.pre(1, "Read", { file_path: "C:\\Users\\dev\\.claude\\skills\\interrogate\\SKILL.md" }));
    expect(events).toContainEqual(expect.objectContaining({ k: "Skill", skill: "interrogate" }));
  });
  it("Jev cwd is normalised", () => {
    const raw = JSON.stringify({ ts: "2026-10-07T16:00:00+0700", cwd: "c:\\Users\\dev\\app", tool: "Bash", head: "ls" });
    expect(parseJevLine("gate", raw)!.cwd).toBe("C:/Users/dev/app");
  });
});
