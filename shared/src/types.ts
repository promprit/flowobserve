import type { Ctx } from "./wire";

export type Status = "active" | "waiting" | "escalated" | "handoff" | "deny" | "shipped" | "idle";
export type BuilderState = "idle" | "working" | "done" | "failed" | "blocked";
export type ExecModel = "haiku" | "sonnet" | "opus" | "fable";
/** Any model an agent can carry; the escalation ladder uses ExecModel. */
export type AgentModel = "haiku" | "sonnet" | "opus" | "fable";
export type GateKey = "route" | "d0" | "d1" | "d2" | "commit";
export type Role = "plan" | "build" | "judge" | "escalate" | "review";

/** pct 0-100, resetsAt epoch ms */
export interface Term { entry: string | null; program: string | null; iterm: string | null }
export type SessionHost = "vscode" | "iterm" | "terminal";
export interface Ready { tests: boolean | null; build: boolean | null; review: boolean | null; passed?: number | null; failed?: number | null }

export interface Limit { pct: number; resetsAt: number }

interface Base { ts: number; sid: string; cwd: string; agentId: string | null; title?: string; project?: string; worktree?: string | null }

export type Event = Base & (
  | { k: "SessionSeen"; source?: string; term?: Term }
  | { k: "End"; reason?: string }
  | { k: "Prompt" }
  | { k: "Skill"; skill: string }
  | { k: "PlanWritten"; path: string; tasks: number | null }
  | { k: "SpecWritten"; path: string }
  | { k: "JevJudge"; phase: "pre" | "post" }
  | { k: "Dispatch"; model: ExecModel }
  /** Every Agent/Task call; the event's agentId is the caller (null = main session). Emitted before Dispatch. */
  | { k: "AgentDispatch"; subType: string; model: AgentModel | null; task: string | null; useId: string | null }
  /** From subagents/agent-<id>.meta.json: the Agent tool call (tool_use_id) that spawned subagent subId. */
  | { k: "AgentBind"; subId: string; useId: string }
  | { k: "SubStart"; subId: string; executor: boolean; agentType?: string }
  | { k: "SubDone"; subId: string; ok: boolean | null }
  | { k: "TaskDispatch"; task: string; role: string; tier: ExecModel }
  | { k: "Escalation"; from: ExecModel; to: ExecModel; task: string; skip?: true }
  | { k: "ReviewLogged"; task: string | null; round: number | null }
  | { k: "JevDeny"; tool: string; command: string }
  | { k: "JevAsk"; tool: string }
  | { k: "Await"; why: "notification" | "question" | "stop" | "idle"; text: string }
  | { k: "ToolPre"; tool: string; useId?: string }
  | { k: "ToolPost"; tool: string; useId?: string }
  | { k: "Merge" }
  | { k: "Say"; text: string }
  | { k: "Usage"; fiveHour: Limit | null; sevenDay: Limit | null; costUsd: number | null; model: string | null }
  | { k: "Ctx"; ctx: Ctx | null }
  | { k: "Rc"; takenOverAt: number | null }
  | { k: "Handoff"; savedAt: number | null }
  | { k: "BashResult"; kind: "test" | "build"; ok: boolean; passed?: number; failed?: number }
  | { k: "Helper"; action: "open" | "restore" | "jump" | "run" | "step" | "diff"; ok: boolean }
);
export type EventKind = Event["k"];

export interface Escalation { builder: number | null; subId: string | null; chain: ExecModel[]; failures: number; task: string }

export interface SessionState {
  id: string; name: string; cwd: string;
  worktree: string | null; title: string | null;
  stage: number; status: Status;
  tasksDone: number; tasksTotal: number;
  builders: BuilderState[];
  slots: Record<string, number>;
  overflow: string[];
  pendingModels: ExecModel[];
  subModel: Record<string, ExecModel>;
  subStartedAt: Record<string, number>;
  /** Interrogate reviewers still to be dispatched; their runs are review, never build or escalation. */
  reviewersDue: number;
  /** Parallel to pendingModels: whether each pending dispatch is an interrogate reviewer. */
  pendingReview: boolean[];
  /** Running subagents that are interrogate reviewers. */
  reviewSubs: Record<string, true>;
  /** Opus start-tier skip-ups whose dispatch is still to come: that dispatch is Build, not Escalate. Optional: older saved sessions read 0. */
  startsDue?: number;
  /** Executor subs awaiting their log_dispatch tag, in start order. */
  subQueue?: { id: string; model: ExecModel }[];
  /** Tags that arrived before a same-tier executor SubStart. */
  pendingTags?: { task: string; role: string; tier: ExecModel }[];
  subTask?: Record<string, { task: string; role: string }>;
  /** Distinct plan task ids whose coder finished ok. */
  doneTasks?: string[];
  /** Subs done ok before any tag arrived (untagged sessions count one each). */
  untaggedDone?: string[];
  deny: { builder: number | null; command: string } | null;
  waiting: { kind: "plan" | "spec" | "answer"; text: string } | null;
  esc: Escalation | null;
  handoff: { builder: number | null; reports: number } | null;
  shippedAt: number | null;
  specThisCycle: boolean; planThisCycle: boolean;
  cycleStart: number; cycleHadHandoff: boolean; cycleEscalations: number;
  /** Review-skill runs (/wreview and similar) finished this cycle; interrogate panels excluded. Optional: older saved sessions read 0. */
  cycleReviews?: number;
  /** epoch ms each stage (0-6) was FIRST entered this cycle (a second escalation keeps the first time); null = not yet. [0] = cycle start. */
  stageAt: (number | null)[];
  planSkillAt: number | null; reviewSkillAt: number | null; judgeAt: number | null;
  /** A log_review arrived while a review skill run is open: its stop must not add a second round. */
  reviewLogged?: boolean;
  /** A review skill stop counted a round that no log_review has claimed yet: the next log_review is that round's record, not a new one. */
  skillRoundUnlogged?: number | null;
  /** "task#round" keys of log_review calls already counted this cycle (Jev numbers its own rounds). Optional: older saved sessions read none. */
  reviewKeys?: string[];
  lastPre: { tool: string; agentId: string | null; ts: number } | null;
  lastCostUsd: number | null;
  say: { t: number; text: string } | null;
  log: { t: number; text: string }[];
  startedAt: number; since: number; lastEventAt: number;
  retired: boolean;
  /** Session kind from the Claude Code registry ("bg" = background); set by the registry poll, not the reducer. */
  kind?: string;
  /** Open tool calls by tool_use_id (spec §9.4); agent = subagent id or null for the main thread. */
  open: Record<string, { tool: string; since: number; agent: string | null }>;
  /** Plan or spec written since the last prompt: only then is a wait APPROVE PLAN / REVIEW SPEC. */
  wrote: "plan" | "spec" | null;
  /** Started by /clear and no prompt yet: the card offers RESUME. */
  fromClear: boolean;
  /** Fresh startup with nothing since: the VS Code extension's pre-warmed spare, not a chat yet. Hidden until used. */
  spare?: boolean;
  ctx: Ctx | null;
  /** Remote Control taken over (code 4090); null/absent = none. Only the time is kept. */
  rc?: { takenOverAt: number } | null;
  /** Latest Jev ask/deny, for one ring flash on the board. */
  gateFlash?: { gate: GateKey; kind: "ask" | "deny"; at: number } | null;
  handoffAt: number | null;
  docs?: { spec: number; plan: number; at: number | null };
  term?: Term | null; folderAbs?: string; prompts?: number; lastEnd?: string | null;
  specPath?: string | null; planPath?: string | null; ready?: Ready | null;
  reviewDoneAt?: number | null; ranAt?: number | null; tryFound?: boolean;
  /** Subagents of this cycle (agents view). Optional: sessions saved before it read none. */
  agents?: AgentLedger;
}

export type AgentType = "executor" | "reviewer" | "explore" | "plan" | "general" | "interrogate" | "other";
export type AgentState = "spawning" | "working" | "waiting" | "done" | "failed" | "blocked" | "escalated";
export interface AgentRec {
  id: string; type: AgentType; model: AgentModel | null; parentId: string | null;
  spawnedAt: number; endedAt: number | null; state: AgentState; task: string | null;
  running: { tool: string; since: number } | null; toolCalls: number;
  escalatedFrom: "haiku" | "sonnet" | "opus" | null; lastAt: number;
  useId?: string | null;
  /** Its dispatch's subType and time; kept so a bind can hand the dispatch back to pending. */
  disp?: { subType: string; at: number };
}
export interface PendingAgent { subType: string; type: AgentType; model: AgentModel | null; task: string | null; parent: string | null; at: number; escalatedFrom: "haiku" | "sonnet" | "opus" | null; useId: string | null }
/** What a dropped agent was, kept so a resume restores it. */
export interface AgentIdent { type: AgentType; model: AgentModel | null; task: string | null; parentId: string | null; useId: string | null; escalatedFrom: "haiku" | "sonnet" | "opus" | null; disp?: { subType: string; at: number } }
export interface AgentOutcome { result: "done" | "failed"; ident?: AgentIdent }
export interface AgentTally { spawned: number; passed: number; failed: number; escalated: number }
export interface AgentLedger { list: AgentRec[]; pending: PendingAgent[]; tally: AgentTally; escNext: { from: ExecModel; to: ExecModel; task: string; at?: number } | null;
  /** subId -> tool_use_id seen before its start (absent in old saves). */
  binds?: Record<string, { useId: string; at: number }>;
  /** Final outcome per agent id this cycle (absent in old saves). */
  outcome?: Record<string, AgentOutcome | "done" | "failed"> }
