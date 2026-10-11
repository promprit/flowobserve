import type { Tier } from "./scene/rate";
import type { Edition, Host, Project, Kpi, Metrics, NodeKey, Session, Usage } from "@fo/shared";

export type Line = { t: number; text: string };
export interface CSession extends Session { order: number; log: Line[]; seeded?: boolean; seen: boolean; washAt: number }
export type Link = "live" | "stale" | "offline";

export const now = () => Date.now();

export const store = {
  sessions: new Map<string, CSession>(),
  link: "stale" as Link,
  lastUpdate: now(),
  retryAt: 0,
  ff: false,
  demo: false,
  usage: null as Usage | null,
  metrics: null as Metrics | null,
  kpis: [] as Kpi[],
  host: null as Host | null,
  edition: "both" as Edition,
  /** false only when the server says Jev is absent: Judge, Escalate and JEV spend are then hidden. */
  jev: true,
  blockedMs: 0,
  blockedWindowMs: 0,
  spendBase: null as string | null,
  projects: [] as Project[],
  rootMissing: false,
  createRoots: undefined as { label: string; path: string; exists: boolean }[] | undefined,
  helperToken: null as string | null,
};

/** z: 0 = all projects, 1 = focused loop (zt = target). */
export const view = { z: 1, zt: 1 };
export const ui = { dirty: true, reduce: false, portrait: false, inspecting: false, freezeT: null as number | null, life: null as Tier | null,
  /** The agent whose detail the card shows (spec: hover/tap an orb, pip or lane); cleared after 60 s. */
  agentSel: null as { sid: string; aid: string; at: number } | null };
export type Pick = { sessionId: string; nodeKey: NodeKey | null; agentId?: string };
/** Late-bound so state-level modules never import the DOM or the scene. */
export const hooks: {
  headSwap(): void; pick(x: number, y: number): Pick | null;
  /** true when the tap hit a node or closed an open popover. */
  inspectAt(x: number, y: number): boolean; inspectClose(): boolean; nodeScreen(key: NodeKey): { x: number; y: number; r: number } | null;
  openReader?: (id: string, kind: "spec" | "plan", onMissing?: () => void) => void;
} = { headSwap() {}, pick: () => null, inspectAt: () => false, inspectClose: () => false, nodeScreen: () => null };

export const changed = () => { ui.dirty = true; };
