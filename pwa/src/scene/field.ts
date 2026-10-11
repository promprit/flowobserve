import { NODE_KEYS, type NodeKey } from "@fo/shared";
import { eff } from "../select";
import type { CSession } from "../state";
import { nodeOf } from "./labels";
import type { Topology } from "./topology";

export const PULSE_MS = 1600, ATTN_R = 2.6;
export type FloorXZ = Record<NodeKey, [number, number]>;
export interface FieldUniforms {
  pulseOrigin: [number, number]; pulseT: number;          // pulseT -1 = no wave
  attn: [number, number, number, number][];                // (f, s, radius, kind 0 none | 1 amber | 2 red) x3
  activity: number; time: number;
  ping: { key: NodeKey; kind: 1 | 2 } | null;              // the one node that gets the 2 s ping dot
}

/** Node floor positions in the floor frame (landscape x, z), morphed toward the portrait layout read back into that frame. */
export function floorAt(A: Topology, B: Topology, m: number): FloorXZ {
  const out = {} as FloorXZ;
  for (const k of NODE_KEYS) {
    const a = nodeOf(A, k), b = nodeOf(B, k);
    out[k] = [a.x + (-b.y / 0.85 - a.x) * m, a.z + (b.x / 1.1 - a.z) * m];
  }
  return out;
}

export function attentionOf(s: CSession | undefined): { key: NodeKey; kind: 1 | 2 } | null {
  if (!s) return null;
  const st = eff(s);
  if (st === "waiting") return { key: "you", kind: 1 };
  if (st === "handoff") return { key: "you", kind: 2 };
  if (st === "deny") return { key: s.deny === null ? "you" : s.agents ? "plan" : (`b${s.deny}` as NodeKey), kind: 2 };
  return null;
}

/** Wire state to floor uniforms (spec section 5). Pure: the scene only copies the result. */
export function fieldUniforms(s: CSession | undefined, nowMs: number, reduce: boolean, at: FloorXZ): FieldUniforms {
  const a = attentionOf(s);
  const attn: FieldUniforms["attn"] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  if (a) attn[0] = [at[a.key][0], at[a.key][1], ATTN_R, a.kind];
  const since = s && eff(s) === "shipped" && s.washAt ? nowMs - s.washAt : -1;
  let working = 0;
  if (s) for (const b of s.agents ? s.agents.map((a) => a.state) : s.builders) if (b === "working") working++;
  return {
    pulseOrigin: at.main,
    pulseT: !reduce && since >= 0 && since < PULSE_MS ? since / PULSE_MS : -1,
    attn,
    activity: reduce ? 0 : Math.min(1, working / 3),
    time: reduce ? 0 : (nowMs % 600_000) / 1000,
    ping: a,
  };
}
