import { z } from "zod";

export const StatusZ = z.enum(["active", "waiting", "escalated", "handoff", "deny", "shipped", "idle"]);
export const BuilderZ = z.enum(["idle", "working", "done", "failed", "blocked"]);

export const NodeKeyZ = z.enum(["you", "plan", "b0", "b1", "b2", "review", "main", "fable"]);
export const NodeZ = z.object({
  key: NodeKeyZ,
  state: z.union([BuilderZ, z.literal("waiting"), z.literal("escalated"), z.literal("current")]),
  model: z.enum(["haiku", "sonnet", "opus", "fable"]).nullable(),  // builders + fable only
  startedAt: z.number().nullable(),                        // when this node entered its current state
  task: z.string().max(160).nullable(),                    // only known for an escalated builder
  waiting: z.string().max(280).nullable(),                 // waiting-on-me text, only on "you"
}).strict();

export const CtxZ = z.object({
  pct: z.number().min(0).max(1), tokens: z.number().int().min(0), window: z.number().int().positive(),
  level: z.enum(["ok", "warn", "crit"]),
}).strict();

export const AgentTypeZ = z.enum(["executor", "reviewer", "explore", "plan", "general", "interrogate", "other"]);
export const AgentStateZ = z.enum(["spawning", "working", "waiting", "done", "failed", "blocked", "escalated"]);
export const AgentZ = z.object({
  id: z.string().min(1).max(64), type: AgentTypeZ, model: z.enum(["haiku", "sonnet", "opus", "fable"]).nullable(),
  parentId: z.string().max(64).nullable(),             // null = spawned by the main session
  spawnedAt: z.number(), endedAt: z.number().nullable(), state: AgentStateZ,
  task: z.string().max(160).nullable(),                // the dispatch's description, never the prompt
  running: z.object({ tool: z.string().max(64), since: z.number() }).strict().nullable(),
  toolCalls: z.number().int().min(0), tokens: z.number().int().min(0),
  escalatedFrom: z.enum(["haiku", "sonnet", "opus"]).nullable(),
  taskId: z.string().max(96).nullable().optional(),    // plan task from the Jev log_dispatch tag; null = untagged / not an executor
  role: z.enum(["tester", "coder", "reviewer", "docs"]).nullable().optional(),
}).strict();
export const AgentTallyZ = z.object({
  spawned: z.number().int().min(0), passed: z.number().int().min(0), failed: z.number().int().min(0), escalated: z.number().int().min(0),
}).strict();

export const SessionZ = z.object({
  id: z.string(), name: z.string(),
  worktree: z.string().nullable().optional(), title: z.string().nullable().optional(),
  stage: z.number().int().min(0).max(6), status: StatusZ,
  tasksDone: z.number().int().min(0), tasksTotal: z.number().int().min(0),
  builders: z.array(BuilderZ).length(3),
  deny: z.number().int().min(0).max(2).nullable(), esc: z.boolean(),
  msg: z.string().nullable(), action: z.string().nullable(),
  say: z.object({ t: z.number(), text: z.string() }).nullable(),
  log: z.array(z.object({ t: z.number(), text: z.string() }).strict()).max(6),
  openUrl: z.string().nullable(),
  startedAt: z.number(), since: z.number(), lastEventAt: z.number(),
  nodes: z.array(NodeZ).max(8),                      // only nodes with something to say
  stageAt: z.array(z.number().nullable()).length(7), // epoch ms each stage was entered this cycle
  ctx: CtxZ.nullable().optional(),                                                 // main chain only; subagent tokens never count
  running: z.object({ tool: z.string(), since: z.number() }).strict().nullable().optional(), // oldest open tool call
  docs: z.object({ spec: z.number().int().min(0), plan: z.number().int().min(0), at: z.number().nullable() }).strict().optional(),
  handoff: z.object({ savedAt: z.number() }).strict().nullable().optional(),       // Jev handoff saved < 30 min ago
  kind: z.literal("bg").optional(),                                                // background session (registry kind)
  fromClear: z.boolean().optional(),                                               // started by /clear, no prompt yet
  host: z.enum(["vscode", "iterm", "terminal"]).optional(),
  jumpUrl: z.string().regex(/^flowobserve:\/\/jump\?iterm=w\d+t\d+p\d+%3A[0-9A-Fa-f-]{36}$/).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  ready: z.object({ tests: z.boolean().nullable(), build: z.boolean().nullable(), review: z.boolean().nullable(),
    passed: z.number().int().min(0).nullable().optional(), failed: z.number().int().min(0).nullable().optional() }).strict().nullable().optional(),
  runnable: z.boolean().optional(),
  rc: z.object({ takenOverAt: z.number() }).strict().nullable().optional(), // Remote Control taken over by another device
  gateFlash: z.object({ gate: z.enum(["route", "d0", "d1", "d2", "commit"]), kind: z.enum(["ask", "deny"]), at: z.number() }).strict().nullable().optional(),
  account: z.object({ label: z.string().min(1).max(32), dryas: z.boolean() }).strict().optional(), // only with several accounts
  agents: z.array(AgentZ).max(16).optional(),        // present = agents mode: the client ignores builders[] and nodes b0-b2
  agentTally: AgentTallyZ.optional(),                // this cycle; counts agents cut by the cap or dropped after done
}).strict();

export const UsageZ = z.object({
  session: z.object({ used: z.number().min(0).max(1), startedAt: z.number(), windowMs: z.number().positive() }),
  weekly: z.object({ used: z.number().min(0).max(1), resetsAt: z.number() }),
  jev: z.object({ usedUsd: z.number().min(0), budgetUsd: z.number().positive(), monthStart: z.number() }).nullable(),
  fable: z.object({ used: z.number().min(0).max(1), resetsAt: z.number() }).nullable().optional(),
  at: z.number(),
});

const MetricZ = z.object({
  model: z.string(), calls: z.number().int().min(0),
  p50: z.number().nullable(), p95: z.number().nullable(),
  signal: z.string().nullable(), warn: z.boolean(),
});
export const MetricsZ = z.object({ plan: MetricZ, build: MetricZ, judge: MetricZ, escalate: MetricZ, review: MetricZ });
export const KpiZ = z.object({
  id: z.enum(["ESC-M1", "ESC-M2", "GOV-M2", "REV-M1", "EXE-M2", "EXE-M3", "FO-GATE", "FO-SHIP", "FO-TRY"]),
  tile: z.enum(["build", "judge", "escalate", "review", "usage", "you"]),
  value: z.number().nullable(),
  unit: z.enum(["pct", "count", "rounds", "usd", "ms"]),
  healthy: z.string(), window: z.enum(["7d", "30d"]), n: z.number().min(0),
  ready: z.boolean(), warn: z.boolean(), next: z.string().nullable(),
}).strict();
const kpis = { kpis: z.array(KpiZ).default([]) };

export const HostZ = z.object({
  at: z.number(),                                   // sample time, epoch ms
  cpu: z.number().min(0).max(1),                    // all cores
  gpu: z.number().min(0).max(1).nullable(),         // null if ioreg gives nothing
  mem: z.object({ used: z.number().min(0).max(1), pressure: z.enum(["normal", "warn", "critical"]) }).strict(),
  disks: z.array(z.object({
    label: z.string(), path: z.string(),
    used: z.number().min(0).max(1).nullable(),      // null = volume offline (SSD unplugged)
    freeBytes: z.number().min(0).nullable(),
  }).strict()).max(4),
}).strict();

const blocked = { blockedMs: z.number().min(0), blockedWindowMs: z.number().min(0) };
const EditionZ = z.enum(["vscode", "iterm", "both"]);
const SnapshotZ = z.object({ type: z.literal("snapshot"), sessions: z.array(SessionZ), usage: UsageZ.nullable(), metrics: MetricsZ, ...blocked, ...kpis, host: HostZ.optional(), edition: EditionZ.optional(), jev: z.boolean().optional() });
const MetricsMsgZ = z.object({ type: z.literal("metrics"), metrics: MetricsZ, ...blocked, ...kpis });
const HostMsgZ = z.object({ type: z.literal("host"), host: HostZ });
export const FolderZ = z.object({ rel: z.string(), worktree: z.string().nullable(), live: z.string().nullable(),
  restore: z.array(z.object({ id: z.string(), title: z.string().nullable(), endedAt: z.number() }).strict()).max(50),
  root: z.string().nullable().optional() }).strict();
export const ProjectZ = z.object({ key: z.string(), name: z.string(), group: z.string().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), base: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), folders: z.array(FolderZ).min(1), plain: z.boolean().optional() }).strict();
const ProjectsMsgZ = z.object({ type: z.literal("projects"), rootMissing: z.boolean(),
  token: z.string().regex(/^[0-9a-f]{64}$/).nullable(), projects: z.array(ProjectZ),
  createRoots: z.array(z.object({ label: z.string(), path: z.string(), exists: z.boolean() }).strict()).optional() }).strict();
const HbZ = z.object({ type: z.literal("hb"), at: z.number() });
export const MsgZ = z.discriminatedUnion("type", [
  SnapshotZ,
  z.object({ type: z.literal("session"), session: SessionZ }),
  z.object({ type: z.literal("usage"), usage: UsageZ }),
  MetricsMsgZ,
  HostMsgZ,
  ProjectsMsgZ,
  HbZ,
]);

export const SpendZ = z.object({
  rows: z.array(z.object({ project: z.string(), model: z.string(), source: z.enum(["claude", "jev"]), usd: z.number().min(0) })),
  totalUsd: z.number().min(0),
});

export type Session = z.infer<typeof SessionZ>;
export type Ctx = z.infer<typeof CtxZ>;
export type Host = z.infer<typeof HostZ>;
export type HostMsg = z.infer<typeof HostMsgZ>;
export type Usage = z.infer<typeof UsageZ>;
export type JevUsage = NonNullable<Usage["jev"]>;
export type Metric = z.infer<typeof MetricZ>;
export type Metrics = z.infer<typeof MetricsZ>;
export type Edition = z.infer<typeof EditionZ>;
export type Msg = z.infer<typeof MsgZ>;
export type SnapshotMsg = z.infer<typeof SnapshotZ>;
export type Project = z.infer<typeof ProjectZ>;
export type Folder = z.infer<typeof FolderZ>;
export type ProjectsMsg = z.infer<typeof ProjectsMsgZ>;
export type HbMsg = z.infer<typeof HbZ>;
export type MetricsMsg = z.infer<typeof MetricsMsgZ>;
export type Spend = z.infer<typeof SpendZ>;
export type NodeKey = z.infer<typeof NodeKeyZ>;
export type WireNode = z.infer<typeof NodeZ>;
export type Kpi = z.infer<typeof KpiZ>;
export type KpiId = Kpi["id"];
export type KpiTile = Kpi["tile"];
export type WireAgent = z.infer<typeof AgentZ>;
export type WireAgentTally = z.infer<typeof AgentTallyZ>;
