import { clip, statusText, statusView } from "./status";
import type { AgentLedger, AgentState, SessionHost, SessionState, Term } from "./types";
import type { NodeKey, Session, WireAgent, WireNode } from "./wire";

export function openUrl(cwd: string): string | null {
  if (!cwd) return null;
  return "vscode://file" + encodeURI(cwd.startsWith("/") ? cwd : "/" + cwd).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

const ITERM_RE = /^w\d+t\d+p\d+:[0-9A-Fa-f-]{36}$/;
export function hostOf(t: Term | null | undefined): SessionHost {
  if (!t) return "vscode";
  if (t.entry?.startsWith("claude-vscode")) return "vscode";
  if (t.program === "iTerm.app" && t.iterm && ITERM_RE.test(t.iterm)) return "iterm";
  return "terminal";
}
export function jumpUrl(t: Term | null | undefined): string | null {
  return t && hostOf(t) === "iterm" ? `flowobserve://jump?iterm=${encodeURIComponent(t.iterm!)}` : null;
}

export const NODE_KEYS: NodeKey[] = ["you", "plan", "b0", "b1", "b2", "review", "main", "fable"];
const STAGE_NODE: Partial<Record<number, NodeKey>> = { 1: "plan", 5: "review", 6: "main" };
const node = (key: NodeKey, state: WireNode["state"], o: Partial<WireNode> = {}): WireNode =>
  ({ key, state, model: null, startedAt: null, task: null, waiting: null, ...o });
const text = (s: string | undefined, n: number) => (s ? clip(s, n) : "") || null;

/** Per-node detail for the inspect popover (spec §2): only nodes with something to say, in loop order. */
export function toNodes(s: SessionState): WireNode[] {
  const out: WireNode[] = [];
  if (s.status === "waiting") out.push(node("you", "waiting", { startedAt: s.since, waiting: text(s.waiting?.text, 280) }));
  const cur = STAGE_NODE[s.stage];
  if (cur === "plan") out.push(node("plan", "current", { startedAt: s.stageAt[1] }));
  for (let i = 0; i < 3; i++) {
    const sub = Object.keys(s.slots).find((k) => s.slots[k] === i);
    if (s.builders[i] === "idle" && sub === undefined) continue;
    out.push(node(NODE_KEYS[2 + i], s.builders[i], {
      model: sub === undefined ? null : s.subModel[sub] ?? null,
      startedAt: sub === undefined ? null : s.subStartedAt[sub] ?? null,
      task: s.esc && s.esc.builder === i ? text(s.esc.task, 160) : null,
    }));
  }
  if (cur === "review" || cur === "main") out.push(node(cur, "current", { startedAt: s.stageAt[s.stage] }));
  if (s.esc && s.esc.chain[s.esc.chain.length - 1] === "fable")
    out.push(node("fable", "escalated", {
      model: "fable", startedAt: s.esc.subId ? s.subStartedAt[s.esc.subId] ?? null : null, task: text(s.esc.task, 160),
    }));
  return out;
}

/** Spec §9: what the card needs beyond the loop. `running` = the oldest open tool call. */
function wireSession(s: SessionState) {
  const open = Object.values(s.open ?? {}).sort((a, b) => a.since - b.since)[0];
  return {
    worktree: s.worktree ?? null, title: s.title ?? null,
    ctx: s.ctx ?? null,
    rc: s.rc ?? null,
    gateFlash: s.gateFlash ?? null,
    running: open ? { tool: open.tool, since: open.since } : null,
    docs: s.docs ?? { spec: 0, plan: 0, at: null },
    handoff: s.handoffAt ? { savedAt: s.handoffAt } : null,
    fromClear: !!s.fromClear,
    ...(s.kind === "bg" ? { kind: "bg" as const } : {}),
  };
}

export const AGENT_CAP = 16;
export const DONE_DROP_MS = 30_000;
const AGENT_RANK: Record<AgentState, number> = { waiting: 0, blocked: 1, failed: 2, escalated: 2, working: 3, spawning: 4, done: 5 };

/** Ledger → wire: the cap keeps the agents that need attention first; a child whose parent was cut hangs on the nearest kept ancestor. */
const ROLES = new Set(["tester", "coder", "reviewer", "docs"]);
export function toAgents(l: AgentLedger | undefined, tokens: Record<string, number> = {}, now?: number, tags: Record<string, { task: string; role: string }> = {}): WireAgent[] {
  if (!l) return [];
  const keep = new Set([...l.list]
    .filter((a) => now === undefined || a.state !== "done" || a.endedAt === null || now - a.endedAt <= DONE_DROP_MS)
    .sort((a, b) => AGENT_RANK[a.state] - AGENT_RANK[b.state] || (b.endedAt ?? b.spawnedAt) - (a.endedAt ?? a.spawnedAt))
    .slice(0, AGENT_CAP).map((a) => a.id));
  const byId = new Map(l.list.map((a) => [a.id, a]));
  const kept = (id: string | null, self: string): string | null => {
    const seen = new Set<string>([self]);
    let cur = id;
    while (cur !== null && (!keep.has(cur) || cur === self)) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return cur;
  };
  return l.list.filter((a) => keep.has(a.id)).map((a) => ({
    id: a.id.slice(0, 64), type: a.type, model: a.model, parentId: kept(a.parentId, a.id)?.slice(0, 64) ?? null,
    spawnedAt: a.spawnedAt, endedAt: a.endedAt, state: a.state, task: a.task,
    running: a.running ? { tool: a.running.tool.slice(0, 64), since: a.running.since } : null,
    toolCalls: a.toolCalls, tokens: Math.max(0, Math.round(tokens[a.id] ?? 0)), escalatedFrom: a.escalatedFrom,
    taskId: tags[a.id]?.task ? tags[a.id].task.slice(0, 96) : null,
    role: tags[a.id] && ROLES.has(tags[a.id].role) ? (tags[a.id].role as WireAgent["role"]) : null,
  }));
}

export function toWire(s: SessionState, extra: { color?: string | null; runnable?: boolean; agentTokens?: Record<string, number>; now?: number } = {}): Session {
  const { msg, action } = statusText(statusView(s));
  return {
    id: s.id, name: s.name, stage: s.stage, status: s.status,
    tasksDone: s.tasksTotal > 0 ? Math.min(s.tasksDone, s.tasksTotal) : s.tasksDone, tasksTotal: s.tasksTotal,
    builders: [s.builders[0], s.builders[1], s.builders[2]],
    deny: s.status === "deny" ? s.deny?.builder ?? null : null,
    esc: s.esc !== null, msg, action, say: s.say, log: s.log, openUrl: openUrl(s.cwd),
    startedAt: s.startedAt, since: s.since, lastEventAt: s.lastEventAt,
    nodes: toNodes(s), stageAt: [...s.stageAt],
    ...wireSession(s),
    host: hostOf(s.term), jumpUrl: jumpUrl(s.term), color: extra.color ?? null,
    ready: s.ready ?? null, runnable: extra.runnable ?? false,
    agents: toAgents(s.agents, extra.agentTokens, extra.now, s.subTask ?? {}),
    agentTally: s.agents ? { ...s.agents.tally } : { spawned: 0, passed: 0, failed: 0, escalated: 0 },
  };
}
