import { helperFor, vscodeFor } from "../edition";
import { go, helperReady, helperUrl, relOf, safeHelperUrl } from "../helper";
import { type CSession, store } from "../state";
import { safeOpenUrl } from "../util";

export type VerbLabel = "TRY IT" | "JUMP";

const SHIP = 6;

export function jumpTarget(s: CSession): string | null {
  return helperReady(s) ? safeHelperUrl(s.jumpUrl) : vscodeFor(s) ? safeOpenUrl(s.openUrl) : null;
}

export function jump(s: CSession): boolean {
  return go(jumpTarget(s));
}

export function readerKind(s: CSession): "spec" | "plan" | null {
  if (s.action === "REVIEW SPEC" && (s.docs?.spec ?? 0) > 0) return "spec";
  if (s.action === "APPROVE PLAN" && (s.docs?.plan ?? 0) > 0) return "plan";
  return null;
}

export function verbFor(s: CSession): { label: VerbLabel; run(): void } | null {
  const rel = s.ready?.review === true && s.stage < SHIP && s.runnable && store.helperToken && helperFor(s) ? relOf(s.id) : null;
  if (rel) return { label: "TRY IT", run: () => { go(helperUrl.run(rel, null, s.color ?? null)); } };
  if (helperReady(s) && jumpTarget(s)) return { label: "JUMP", run: () => { jump(s); } };
  return null;
}

/** DIFF (spec §9): iTerm2 sessions with the helper, at Build or later. */
export function diffUrl(s: CSession): string | null {
  if (store.link !== "live" || !helperReady(s) || s.stage < 3) return null;
  const rel = relOf(s.id);
  return rel ? helperUrl.diff(rel, null, s.color ?? null) : null;
}

/** "tests ✓ · build ✗ · review ✓"; with a pass count, "140 passed · 2 failed · build ✓ · review ✓". */
export function resultsLine(s: CSession): string {
  const r = s.ready;
  if (!r) return "";
  const mark = (name: string, v: boolean | null | undefined) => (v == null ? null : `${name} ${v ? "✓" : "✗"}`);
  const counted = typeof r.passed === "number";
  const parts: (string | null)[] = counted
    ? [`${r.passed} passed`, r.failed ? `${r.failed} failed` : null, r.tests === false ? "tests ✗" : null]
    : [mark("tests", r.tests)];
  parts.push(mark("build", r.build), mark("review", r.review));
  return parts.filter(Boolean).join(" · ");
}
