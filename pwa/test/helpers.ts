import fs from "node:fs";
import path from "node:path";

/** 2026-10-03 10:00 Asia/Bangkok. */
export const T0 = Date.parse("2026-10-03T03:00:00.000Z");

/** Loads index.html's body (without scripts) into jsdom. */
export function loadDom(): void {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1];
  document.body.className = "landscape";
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
}

import type { Metrics, Session, WireAgent } from "@fo/shared";
import { resetPager } from "../src/pager";
import { store, ui, view, type CSession } from "../src/state";
import { resetCards } from "../src/ui/cards";
import { resetTabs } from "../src/ui/tabs";

export function wire(id: string, patch: Partial<Session> = {}): Session {
  return { id, name: id, stage: 1, status: "active", tasksDone: 0, tasksTotal: 0, builders: ["idle", "idle", "idle"], deny: null, esc: false,
    msg: null, action: null, say: null, log: [], openUrl: null, startedAt: T0, since: T0, lastEventAt: T0,
    nodes: [], stageAt: [T0, null, null, null, null, null, null], ...patch };
}
export const sess = (id: string, patch: Partial<CSession> = {}, order = 0): CSession =>
  ({ ...wire(id), order, log: [], seen: false, washAt: 0, ...patch });

/** A wire agent (executor, sonnet, working, spawned a minute before T0). */
export const agent = (id: string, p: Partial<WireAgent> = {}): WireAgent => ({
  id, type: "executor", model: "sonnet", parentId: null, spawnedAt: T0 - 60_000, endedAt: null, state: "working",
  task: null, running: null, toolCalls: 0, tokens: 0, escalatedFrom: null, ...p,
});

const m = (model: string) => ({ model, calls: 0, p50: null, p95: null, signal: null, warn: false });
export const METRICS: Metrics = { plan: m("opus"), build: m("sonnet"), judge: m("jev-1.13"), escalate: m("opus"), review: m("opus") };
export const snap = (sessions: Session[]) => ({ type: "snapshot" as const, sessions, usage: null, metrics: METRICS, blockedMs: 0, blockedWindowMs: 0, kpis: [] as never[] });

export function reset(): void {
  store.sessions.clear();
  Object.assign(store, { link: "live", usage: null, metrics: null, kpis: [], host: null, blockedMs: 0, blockedWindowMs: 0, spendBase: null, jev: true, demo: false, ff: false, retryAt: 0 });
  Object.assign(view, { z: 1, zt: 1 });
  ui.portrait = false;
  ui.agentSel = null;
  ui.cycle = 0;
  resetPager();
  resetCards();
  resetTabs();
}
