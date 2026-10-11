import type { ExecModel, SessionState, Status } from "./types";

export type StatusView =
  | { status: "waiting"; kind: "plan" | "spec" | "answer"; tasksTotal: number; text: string }
  | { status: "deny"; builder: number | null; command: string }
  | { status: "escalated"; builder: number | null; chain: ExecModel[] }
  | { status: "handoff"; builder: number | null; reports: number }
  | { status: "shipped"; tasksDone: number; tasksTotal: number }
  | { status: "active" }
  | { status: "idle" };

const NAME: Record<ExecModel, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", fable: "Fable" };
const FAILS: Record<ExecModel, string> = { haiku: "✗", sonnet: "✗✗", opus: "✗", fable: "✗" };

export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

const bn = (b: number | null, none: string) => (b === null ? none : `B${b + 1}`);

export function chainText(chain: ExecModel[]): string {
  return chain.map((m, i) => (i < chain.length - 1 ? `${NAME[m]} ${FAILS[m]}` : NAME[m])).join(" → ");
}

export function statusText(v: StatusView): { msg: string | null; action: string | null } {
  switch (v.status) {
    case "waiting": {
      if (v.kind === "plan") return { msg: `Waiting on you · approve plan (${v.tasksTotal} tasks)`, action: "APPROVE PLAN" };
      if (v.kind === "spec") return { msg: "Waiting on you · review spec", action: "REVIEW SPEC" };
      const t = clip(v.text, 60);
      return { msg: t ? `Waiting on you · ${t}` : "Waiting on you", action: "ANSWER" };
    }
    case "deny":
      return { msg: `Jev denied ${bn(v.builder, "Main")} · ${clip(v.command, 60)}`, action: "REVIEW DENY" };
    case "escalated":
      return { msg: `${bn(v.builder, "Task")} escalated · ${chainText(v.chain)}`, action: null };
    case "handoff": {
      const b = bn(v.builder, "Task");
      return { msg: `Fable ✗ · ${b} handed to you with ${v.reports} reports`, action: `RESOLVE ${b} · ${v.reports} REPORTS` };
    }
    case "shipped":
      return {
        msg: v.tasksTotal > 0 ? `Shipped · merged to main · ${Math.min(v.tasksDone, v.tasksTotal)}/${v.tasksTotal} tasks` : "Shipped · merged to main",
        action: null,
      };
    default:
      return { msg: null, action: null };
  }
}

export function statusView(s: SessionState): StatusView {
  switch (s.status) {
    case "waiting": return { status: "waiting", kind: s.waiting?.kind ?? "answer", tasksTotal: s.tasksTotal, text: s.waiting?.text ?? "" };
    case "deny": return { status: "deny", builder: s.deny?.builder ?? null, command: s.deny?.command ?? "" };
    case "escalated": return { status: "escalated", builder: s.esc?.builder ?? null, chain: s.esc?.chain ?? [] };
    case "handoff": return { status: "handoff", builder: s.handoff?.builder ?? null, reports: s.handoff?.reports ?? 0 };
    case "shipped": return { status: "shipped", tasksDone: s.tasksDone, tasksTotal: s.tasksTotal };
    default: return { status: s.status };
  }
}

export const STAGES = ["BRAINSTORM", "PLAN", "JUDGE", "BUILD", "ESCALATE", "REVIEW", "SHIP"] as const;

/** Label under the card name (prototype cardLabel). Escalate names no model: the wire does not say which one is running. */
export function cardLabel(s: { stage: number; tasksDone: number; tasksTotal: number }, st: Status): string {
  const g = STAGES[s.stage] ?? STAGES[0];
  const task = s.tasksTotal ? ` · TASK ${Math.min(s.tasksDone, s.tasksTotal)}/${s.tasksTotal}` : "";
  switch (st) {
    case "active": return g + task;
    case "waiting": return `${g} · NEEDS YOU`;
    case "escalated": return `ESCALATE${task}`;
    case "handoff": return "ESCALATE · FABLE ✗";
    case "deny": return `${g} · JEV DENY${task}`;
    case "shipped": return "SHIPPED · MERGED";
    case "idle": return `${g} · IDLE`;
  }
}
