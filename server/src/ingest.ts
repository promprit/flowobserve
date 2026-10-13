import { toPosix } from "@fo/shared";
import { canonAcct } from "./accounts";
import type { AgentModel, Event, ExecModel, Limit, Term } from "@fo/shared";

export interface SpoolLine {
  v: 1; ts: string; src: "hook" | "statusline" | "helper"; sid: string; cwd: string;
  event: string; payload: unknown; truncated: boolean; term?: Term; acct?: string;
}

export const PLAN_RE = /(?:^|\/)(?:docs\/superpowers\/plans\/[^/]+\.md|\.orchestrate\/PLAN\.md)$/;
/** orchestrate's interrogate step reads this skill instead of invoking it (Dryas §4 step 8b). */
const INTERROGATE_RE = /(?:^|\/)\.claude\/skills\/interrogate\/SKILL\.md$/;
/** A Bash command that reads the interrogate skill file counts as invoking it, as the Read rule does. */
// Home forms: ~, $HOME, ${HOME}, macOS, Linux, Git Bash and Windows user folders, %USERPROFILE%, $env:USERPROFILE.
export const INTERROGATE_CMD_RE = /(?:^|[;&|]\s*)(?:cat|sed|head|tail|less|bat|awk|type|Get-Content|gc)\b[^;&|\n]*?["']?(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%|(?:\/[A-Za-z])?\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)["']?[\\/]\.claude[\\/]skills[\\/]interrogate[\\/]SKILL\.md(?=$|["'\s|;&)>])/i;
export const SPEC_RE = /(?:^|\/)docs\/superpowers\/specs\/[^/]+\.md$/;
/** TEST_RE must stay identical to TEST_CMD in hook/fo_derive.py. */
export const TEST_RE = /(?:^|[;&|(\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:npx|pnpm exec)\s+)?(?:pnpm (?:-r )?(?:--filter \S+ )?test|npm (?:run )?test|vitest|pytest|(?:[^\s;&|()]*\/)?python3? -m pytest|xcodebuild test)(?=$|[\s;&|)])/;
export const BUILD_RE = /(?:^|[;&|(\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:npx|pnpm exec)\s+)?(?:pnpm (?:-r )?(?:--filter \S+ )?build|npm run build|tsc|xcodebuild build)(?=$|[\s;&|)])/;
const HELPER_ACTIONS = new Set(["open", "restore", "jump", "run", "step", "diff"]);
export const MERGE_RE = /\bgit\s+(?:-C\s+\S+\s+)?(?:merge|push)(?=\s|$)/;
export const NOT_MERGE_RE = /\s--(?:abort|quit|dry-run)\b|\s-n(?:\s|$)/;

const KNOWN = new Set([
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "SubagentStart", "SubagentStop", "Notification", "PermissionRequest", "Stop", "StopFailure",
  "PreCompact", "PostCompact", "TeammateIdle", "usage", "helper",
]);

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const strOrNull = (x: unknown) => x === null || typeof x === "string";

function termOf(x: unknown): Term | undefined {
  const t = obj(x);
  if (!strOrNull(t.entry) || !strOrNull(t.program) || !strOrNull(t.iterm)) return undefined;
  if (t.entry === undefined || t.program === undefined || t.iterm === undefined) return undefined;
  return { entry: t.entry as string | null, program: t.program as string | null, iterm: t.iterm as string | null };
}

export function parseSpoolLine(raw: string): SpoolLine | null {
  let x: unknown;
  try { x = JSON.parse(raw); } catch { return null; }
  const o = obj(x);
  if (o.v !== 1 || typeof o.ts !== "string" || typeof o.sid !== "string" || typeof o.event !== "string") return null;
  if (Number.isNaN(Date.parse(o.ts))) return null;
  const term = termOf(o.term);
  const acct = canonAcct(o.acct);
  return {
    v: 1, ts: o.ts, src: o.src === "statusline" || o.src === "helper" ? o.src : "hook", sid: o.sid, cwd: toPosix(str(o.cwd)),
    event: o.event, payload: o.payload, truncated: o.truncated === true, ...(term ? { term } : {}), ...(acct ? { acct } : {}),
  };
}

export function execModel(x: unknown): ExecModel {
  const s = str(x).toLowerCase();
  return s.includes("fable") ? "fable" : s.includes("opus") ? "opus" : s.includes("haiku") ? "haiku" : "sonnet";
}

/** Model of a dispatched agent: a known tier by name, null for any other named model, sonnet for an executor with none. */
function agentModel(x: unknown, sub: string): AgentModel | null {
  const s = str(x).toLowerCase();
  if (s) return s.includes("fable") ? "fable" : s.includes("opus") ? "opus" : s.includes("sonnet") ? "sonnet" : s.includes("haiku") ? "haiku" : null;
  return isExecutor(sub) ? "sonnet" : null;
}

export const isExecutor = (x: unknown) => { const s = str(x); return s === "executor" || s.endsWith(":executor"); };

function limit(x: unknown): Limit | null {
  const o = obj(x);
  if (typeof o.used_percentage !== "number") return null;
  const r = o.resets_at;
  const resetsAt = typeof r === "number" ? r * 1000 : typeof r === "string" ? Date.parse(r) : NaN;
  return Number.isFinite(resetsAt) ? { pct: o.used_percentage, resetsAt } : null;
}

/** Spool line → events, in order. null means an unknown event type (the caller counts it). */
export function toEvents(l: SpoolLine): Event[] | null {
  if (!KNOWN.has(l.event)) return null;
  const p = obj(l.payload);
  const fo = obj(p.fo);
  const agentId = l.event.startsWith("Subagent") ? null : str(p.agent_id) || null;
  const title = typeof p.session_title === "string" ? p.session_title.trim().slice(0, 120) : "";
  const b = { ts: Date.parse(l.ts), sid: l.sid, cwd: l.cwd, agentId, ...(title ? { title } : {}) };
  const tool = str(p.tool_name);
  const ti = obj(p.tool_input);
  const out: Event[] = [];
  switch (l.event) {
    case "SessionStart": out.push({ ...b, k: "SessionSeen", source: str(p.source), ...(l.term ? { term: l.term } : {}) }); break;
    case "SessionEnd": out.push({ ...b, k: "End", ...(str(p.reason) ? { reason: str(p.reason) } : {}) }); break;
    case "UserPromptSubmit": out.push({ ...b, k: "Prompt" }); break;
    case "PreToolUse":
      out.push({ ...b, k: "ToolPre", tool, useId: str(p.tool_use_id) || undefined });
      if (tool === "Skill" && str(ti.skill)) out.push({ ...b, k: "Skill", skill: str(ti.skill) });
      else if (tool === "Read" && !str(p.agent_id) && INTERROGATE_RE.test(toPosix(str(ti.file_path)))) out.push({ ...b, k: "Skill", skill: "interrogate" });
      else if (tool === "Bash" && !str(p.agent_id) && INTERROGATE_CMD_RE.test(str(ti.command))) out.push({ ...b, k: "Skill", skill: "interrogate" });
      else if (tool === "Agent" || tool === "Task") {
        const sub = str(ti.subagent_type);
        const task = str(ti.description).trim().slice(0, 160) || null;
        out.push({ ...b, k: "AgentDispatch", subType: sub, model: agentModel(ti.model, sub), task, useId: str(p.tool_use_id) || null });
        if (isExecutor(sub)) out.push({ ...b, k: "Dispatch", model: execModel(ti.model) });
      }
      else if (tool === "mcp__jev__jev_judge") out.push({ ...b, k: "JevJudge", phase: "pre" });
      else if (tool === "mcp__jev__log_escalation")
        out.push({ ...b, k: "Escalation", from: execModel(ti.from_model), to: execModel(ti.to_model), task: str(ti.task), ...(/^skip-up/i.test(str(ti.reason).trim()) ? { skip: true as const } : {}) });
      else if (tool === "mcp__jev__log_dispatch" && str(ti.task)) out.push({ ...b, k: "TaskDispatch", task: str(ti.task), role: str(ti.role), tier: execModel(ti.tier) });
      else if (tool === "mcp__jev__log_review") out.push({ ...b, k: "ReviewLogged", task: str(ti.task) || null, round: typeof ti.round === "number" && Number.isFinite(ti.round) ? ti.round : null });
      else if (tool === "AskUserQuestion") {
        const q = Array.isArray(ti.questions) ? obj(ti.questions[0]) : {};
        out.push({ ...b, k: "Await", why: "question", text: str(q.question) });
      }
      break;
    case "PostToolUse": case "PostToolUseFailure": {
      out.push({ ...b, k: "ToolPost", tool, useId: str(p.tool_use_id) || undefined });
      if (tool === "Bash" && !str(p.agent_id)) {
        const c = str(ti.command);
        const kind = TEST_RE.test(c) ? "test" : BUILD_RE.test(c) ? "build" : null;
        const t = obj(fo.tests);
        const counts = kind === "test" && Number.isInteger(t.passed) && Number.isInteger(t.failed) ? { passed: t.passed as number, failed: t.failed as number } : {};
        if (kind) out.push({ ...b, k: "BashResult", kind, ok: l.event === "PostToolUse" && !(kind === "test" && (counts.failed ?? 0) > 0), ...counts });
      }
      if (l.event === "PostToolUseFailure") break;
      const path = toPosix(str(ti.file_path));
      if (tool === "Write" && PLAN_RE.test(path))
        out.push({ ...b, k: "PlanWritten", path, tasks: typeof fo.planTasks === "number" ? fo.planTasks : null });
      else if (tool === "Write" && SPEC_RE.test(path)) out.push({ ...b, k: "SpecWritten", path });
      else if (tool === "mcp__jev__jev_judge") out.push({ ...b, k: "JevJudge", phase: "post" });
      else if (tool === "Bash" && MERGE_RE.test(str(ti.command)) && !NOT_MERGE_RE.test(str(ti.command)) && !str(p.agent_id) && obj(p.tool_response).interrupted !== true)
        out.push({ ...b, k: "Merge" });
      break;
    }
    case "helper": {
      const action = str(p.action);
      if (HELPER_ACTIONS.has(action)) out.push({ ...b, k: "Helper", action: action as "open", ok: p.ok === true });
      break;
    }
    case "SubagentStart":
      if (str(p.agent_id)) out.push({ ...b, k: "SubStart", subId: str(p.agent_id), executor: isExecutor(p.agent_type), agentType: str(p.agent_type) });
      break;
    case "SubagentStop":
      if (str(p.agent_id))
        out.push({ ...b, k: "SubDone", subId: str(p.agent_id), ok: fo.result === "pass" ? true : fo.result === "fail" ? false : null });
      break;
    case "Notification":
      out.push({ ...b, k: "Await", why: p.notification_type === "idle_prompt" ? "idle" : "notification", text: str(p.message) });
      break;
    case "PermissionRequest": out.push({ ...b, k: "Await", why: "notification", text: tool }); break;
    case "Stop": out.push({ ...b, k: "Await", why: "stop", text: str(fo.say) }); break;
    case "usage": {
      const c = obj(p.cost); const m = obj(p.model); const rl = obj(p.rate_limits);
      out.push({
        ...b, k: "Usage", fiveHour: limit(rl.five_hour), sevenDay: limit(rl.seven_day),
        costUsd: typeof c.total_cost_usd === "number" ? c.total_cost_usd : null, model: str(m.id) || null,
      });
      break;
    }
  }
  if (str(fo.say)) out.push({ ...b, k: "Say", text: str(fo.say) });
  return out;
}
