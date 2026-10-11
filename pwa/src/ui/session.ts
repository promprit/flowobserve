import type { Session } from "@fo/shared";

/** Card session controls (spec §10). The link only focuses the chat; every step copies its text, the user pastes it and presses Enter. */
export type Step = "handoff" | "clear" | "resume";
/** Task 0 result: the link never sends anything, so CLEAR needs no confirm. */
export const CLEAR_CONFIRM = false;
type S = Partial<Pick<Session, "ctx" | "handoff" | "fromClear">>;

export function ctxLabel(s: S): { text: string; level: "ok" | "warn" | "crit" } | null {
  return s.ctx ? { text: `${Math.max(0, Math.floor(100 - s.ctx.pct * 100))}% LEFT`, level: s.ctx.level } : null;
}

export const nextStep = (s: S): Step => (s.handoff ? "clear" : s.fromClear ? "resume" : "handoff");

/** Focus-only link: the extension never applies a prompt to an already-open session (Task 0). */
export function sessionLink(id: string, _step: Step): string | null {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
  return `vscode://anthropic.claude-code/open?session=${id}`;
}

/** After /clear the handoff is already re-injected by the SessionStart:clear hook, so RESUME only needs a first prompt. */
export const RESUME_TEXT = "Continue from the handoff";
export const copyText = (step: Step): string => (step === "handoff" ? "/handoff" : step === "clear" ? "/clear" : RESUME_TEXT);

export const showRow = (s: S, focused: boolean): boolean => focused || s.ctx?.level === "warn" || s.ctx?.level === "crit";
