import type { Status } from "@fo/shared";
export { STAGES } from "@fo/shared/status";

export const HEX = { paper: "#F2F0EA", opus: "#4FD1B9", sonnet: "#8AA9FF", haiku: "#C4B5A5", jev: "#F2B544", fable: "#C69BFF", deny: "#FF6B5B", brand: "#3DFF8B", t2: "#B9B7AF", t3: "#8C8A83" } as const;
export const ATTN: Partial<Record<Status, string>> = { waiting: HEX.jev, escalated: HEX.fable, handoff: HEX.deny, deny: HEX.deny, shipped: HEX.brand };
export const NEEDS = new Set<Status>(["waiting", "deny", "handoff"]);
export const RANK: Record<Status, number> = { waiting: 0, deny: 0, handoff: 0, escalated: 1, shipped: 2, active: 2, idle: 3 };

export const IDLE_MS = 600_000;
export const RESUME = 120_000;
/** Card hover: dwell before the loop camera previews that chat, and the pause before it returns once the pointer leaves (ms). */
export const HOVER = { inMs: 250, outMs: 600 } as const;
export const STALE_MS = 10_000;
export const BACKOFF = [1000, 2000, 4000, 8000];
export const PACE_WARN = 0.15;
export const JEV_PACE_WARN = 0.1;
export const FIVE_HOUR_MS = 18_000_000;
export const SPEND_TIMEOUT_MS = 5_000;

export type Vec3 = [number, number, number];
export const CAM: Record<"landscape" | "portrait", { fov: number; pos: Vec3; tgt: Vec3; ref: number }> = {
  landscape: { fov: 40, pos: [0, 25, 27], tgt: [0, 3.4, 0.5], ref: 1.12 },
  portrait: { fov: 36, pos: [30, -9, 50], tgt: [1.5, 2.2, 1.5], ref: 1.42 },
};
export const SP = { A: [36, 42], B: [34, 37] } as const;

export type Builder = "idle" | "working" | "done" | "failed" | "blocked";
export const I3 = (): Builder[] => ["idle", "idle", "idle"];

/** Paging/zoom gestures: two-finger touch travel to page (px), travel that locks a two-finger touch as swipe or pinch (px),
 *  trackpad deltaX sum to page (px), and the wheel gap that ends a trackpad gesture, momentum included (ms). */
export const SWIPE = { px: 60, lock: 24, wheel: 120, quietMs: 250 } as const;
