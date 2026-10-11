/** Progress arc (spec 2026-10-09 loop stage): the trunk ring is revealed from YOU to the fraction under the current stage's node.
 *  Pure: loop.ts sets targets from it, world.ts eases and draws. Ring point at u is W(-12·cos 2πu, ·, 12·sin 2πu), so a node at
 *  flow f sits at acos(-f/12)/2π: YOU 0, PLAN 1/6, executors 1/4, REVIEW 1/3, SHIP 1/2. */
import * as THREE from "three";
import type { Status, WireAgent } from "@fo/shared";
import { HEX } from "../config";
import type { Packet } from "./loop";

export interface Arc { to: number; head: string; here: string | null }
export const ARC_ALPHA = 0.55, PULSE_MS = 600;
/** Index = stage: BRAINSTORM, PLAN, JUDGE (between PLAN and the executors), BUILD, ESCALATE (still at the executors), REVIEW, SHIP. */
export const STAGE_U: readonly number[] = [0, 1 / 6, 5 / 24, 1 / 4, 1 / 4, 1 / 3, 1 / 2];
/** Label to emphasise per stage. BUILD names the orchestrator (`plan`) in agents mode and the working builders (`b*`) in builders mode; ESCALATE names FRONTIER. */
const HERE = ["you", "plan", "plan", "plan", "fable", "review", "main"] as const;
/** Head red is only for handoff and deny; escalation and re-dispatch use the fable colour (the escalation colour elsewhere). */
const RED = new Set<string>(["handoff", "deny"]), ATT = new Set<string>(["attn", "seen", "failed"]);
export const isAtt = (x: string | undefined): boolean => !!x && ATT.has(x);

export function stageArc(stage: number, status: Status | "none", agents?: readonly Pick<WireAgent, "state">[] | null): Arc {
  const ok = Number.isInteger(stage) && stage >= 0 && stage < STAGE_U.length;
  if (status === "shipped") return { to: 1, head: HEX.brand, here: "main" };
  const esc = status === "escalated" || !!agents?.some((a) => a.state === "escalated");
  const head = status === "waiting" ? HEX.jev : RED.has(status) ? HEX.deny : esc ? HEX.fable : HEX.opus;
  // builders mode (no agents field): the working builders carry BUILD's label; "b" = every live b* key
  const here = stage === 3 && !Array.isArray(agents) ? "b" : HERE[stage];
  return ok ? { to: STAGE_U[stage], head, here } : { to: 0, head, here: null };
}

/** ≈600 ms ease-out grow (95% at 0.6 s); reduced motion or a backwards move jumps (no reverse sweep). */
export function arcStep(cur: number, to: number, dt: number, reduce: boolean): number {
  if (reduce || to < cur) return to;
  const r = cur + (to - cur) * (1 - Math.exp(-dt * 5));
  return to - r < 0.001 ? to : r;
}

const COL = new Map<string, THREE.Color>();
const colOf = (hex: string): THREE.Color => { let c = COL.get(hex); if (!c) { c = new THREE.Color(hex); COL.set(hex, c); } return c; };
/** The head: a fixed packet at the arc end. Drawn under reduced motion too (it doesn't move); one pulse when waiting starts. */
export function arcHead(pr: number, head: string, waitAt: number | null, wall: number, reduce: boolean, offline: boolean): Packet | null {
  if (offline || pr <= 0.01 || pr >= 0.995) return null;
  const t = waitAt === null || reduce ? -1 : wall - waitAt;
  const pulse = t >= 0 && t < PULSE_MS ? 0.8 * Math.sin((Math.PI * t) / PULSE_MS) : 0;
  return { k: "trunk", fixed: pr, col: colOf(head), size: 9 * (1 + pulse), tr: 6, gap: 0.006, max: 1 };
}

/** Node label title colour: attention states keep their colour; else the current stage is paper and the rest t3.
 *  here "b" (builders mode BUILD) lights every live builder label b0-b2. */
export function labelHex(key: string, x: string | undefined, hex: string, here: string | null): string {
  if (isAtt(x)) return hex;
  return key === here || (here === "b" && /^b\d$/.test(key) && x === "live") ? HEX.paper : HEX.t3;
}
