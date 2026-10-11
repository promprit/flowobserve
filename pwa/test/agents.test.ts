import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireAgent, WireNode } from "@fo/shared";
import { AFADE, actLine, agentSig, agentView, clean, countParts, detailRows, kfmt, mmss, modelHex, MODELW, partsText, pillModels, summaryParts, tallyParts } from "../src/agents";
import { HEX } from "../src/config";
import { store, ui } from "../src/state";
import { upsert } from "../src/store";
import { popoverContent } from "../src/ui/inspect";
import { T0, agent, reset, sess, wire } from "./helpers";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); reset(); });

const ago = (sec: number) => T0 - sec * 1000;
const run = (tool: string, sec: number) => ({ tool, since: ago(sec) });
const V = (agents: WireAgent[], now = T0, agentTally?: { spawned: number; passed: number; failed: number; escalated: number }) => agentView({ agents, agentTally }, now)!;

/** The prototype's six scenarios (P:517-612), as static fixtures relative to T0. */
const FX = {
  a: [agent("a1", { task: "Add retry with exponential backoff to the websocket reconnect path", running: run("Edit", 42), toolCalls: 23, tokens: 41200, spawnedAt: ago(196) })],
  b: [
    agent("b1", { task: "Parse ISO dates with offsets in parse_date", state: "done", endedAt: ago(9), toolCalls: 31, tokens: 52800, spawnedAt: ago(251) }),
    agent("b2", { task: "Migrate the session store to schema v3", running: run("Edit", 72), toolCalls: 44, tokens: 71300, spawnedAt: ago(250) }),
    agent("b3", { task: "Empty-state copy for the cards zone", running: run("Read", 8), toolCalls: 19, tokens: 23900, spawnedAt: ago(250) }),
    agent("b4", { task: "CSV export of shipped tasks with a header row", state: "waiting", running: run("Bash", 37), toolCalls: 12, tokens: 18400, spawnedAt: ago(249) }),
  ],
  c: [
    agent("c1", { task: "Parse ISO dates with offsets in parse_date", state: "done", endedAt: ago(10), spawnedAt: ago(300) }),
    agent("c2", { task: "Retry with backoff on websocket reconnect", state: "escalated", endedAt: ago(2), spawnedAt: ago(299) }),
    agent("c3", { task: "Refresh the auth token before it expires", running: run("Edit", 20), spawnedAt: ago(298) }),
    agent("c2o", { model: "opus", escalatedFrom: "sonnet", task: "Retry with backoff on websocket reconnect", running: run("Read", 0), toolCalls: 1, tokens: 2100, spawnedAt: ago(1) }),
  ],
  d: [
    agent("r1", { type: "reviewer", model: "opus", running: run("Read", 21), spawnedAt: ago(95) }),
    agent("r2", { type: "reviewer", model: "sonnet", running: run("Grep", 9), spawnedAt: ago(94) }),
    agent("i1", { type: "interrogate", model: "opus", running: run("Task", 48), spawnedAt: ago(80) }),
    agent("i2", { type: "interrogate", model: "sonnet", parentId: "i1", running: run("Read", 5), spawnedAt: ago(52) }),
  ],
  e: [
    agent("p1", { state: "done", endedAt: ago(6), spawnedAt: ago(180) }), agent("p2", { state: "failed", endedAt: ago(40), spawnedAt: ago(180) }),
    ...["p3", "p4", "p5", "p6"].map((id) => agent(id, { spawnedAt: ago(180) })),
  ],
  f: [
    ...Array.from({ length: 10 }, (_, i) => agent("f" + i, { spawnedAt: ago(60 - i) })),
    agent("fx", { type: "explore", parentId: "f3", spawnedAt: ago(40) }),
    agent("fg", { type: "general", parentId: "fx", spawnedAt: ago(30) }),
  ],
};

describe("agentView: the prototype scenarios", () => {
  it("a: one agent reads as one line", () => {
    expect(partsText(summaryParts(V(FX.a), T0))).toBe("1 AGENT · EDIT 0:42");
  });
  it("b: four executors, numbered by spawn, waiting counted first and amber", () => {
    const v = V(FX.b), parts = summaryParts(v, T0);
    expect(v.order.map((L) => L.name)).toEqual(["EXECUTOR 1", "EXECUTOR 2", "EXECUTOR 3", "EXECUTOR 4"]);
    expect(partsText(parts)).toBe("4 AGENTS · 1 WAITING · 2 WORKING · 1 DONE");
    expect(parts[0]).toEqual({ text: "4 AGENTS", bold: true });
    expect(parts.find((p) => p.text === "1 WAITING")).toEqual({ text: "1 WAITING", color: HEX.jev, bold: true });
    expect(actLine(v.byId.get("b4")!, T0)).toBe("NEEDS YOU · BASH");
  });
  it("b: a done agent is hidden 20 s after it ended", () => {
    expect(V(FX.b, ago(9) + AFADE + 1).order.map((L) => L.id)).toEqual(["b2", "b3", "b4"]);
    expect(V(FX.b, ago(9) + AFADE).order).toHaveLength(4);
  });
  it("c: an escalation and its re-dispatch are one lineage whose colour walks sonnet → opus", () => {
    const v = V(FX.c), L = v.byId.get("c2")!;
    expect(v.byId.get("c2o")).toBe(L);
    expect(v.order).toHaveLength(3);
    expect(L.name).toBe("EXECUTOR 2");
    expect(pillModels(L)).toEqual(["sonnet", "opus"]);
    expect(actLine(L, T0)).toBe("SONNET → OPUS · READ 0:00");
    expect(v.counts).toMatchObject({ n: 3, done: 1, working: 2 });
    expect(partsText(detailRows(L, T0).chain)).toBe("SONNET ✗ → OPUS");
  });
  it("d: reviewers and an interrogate pair ring REVIEW; the child nests one level", () => {
    const v = V(FX.d, T0, { spawned: 10, passed: 5, failed: 1, escalated: 1 });
    expect(v.order.map((L) => L.id)).toEqual(["r1", "r2", "i1", "i2"]);
    expect(v.order.map((L) => L.name)).toEqual(["REVIEWER 1", "REVIEWER 2", "INTERROGATE 1", "INTERROGATE 2"]);
    expect(v.order.map((L) => L.cluster)).toEqual(["review", "review", "review", "review"]);
    expect(v.byId.get("i2")!.depth).toBe(1);
    const t = tallyParts(v.tally);
    expect(partsText(t)).toBe("THIS CYCLE · 10 SPAWNED · 5 PASSED · 1 FAILED · 1 ESCALATED");
    expect(t.find((p) => p.text === "1 FAILED")).toEqual({ text: "1 FAILED", color: HEX.deny, bold: true });
    expect(detailRows(v.byId.get("i1")!, T0).by).toBe("SPAWNED BY MAIN SESSION · 1 SUBAGENT");
    expect(detailRows(v.byId.get("i2")!, T0).by).toBe("SPAWNED BY INTERROGATE 1");
  });
  it("e: six executors, one failed, one done", () => {
    expect(partsText(summaryParts(V(FX.e), T0))).toBe("6 AGENTS · 4 WORKING · 1 FAILED · 1 DONE");
  });
  it("f: ten executors with a two-level subtree, depth-first", () => {
    const v = V(FX.f);
    expect(v.order.map((L) => L.id)).toEqual(["f0", "f1", "f2", "f3", "fx", "fg", "f4", "f5", "f6", "f7", "f8", "f9"]);
    expect([v.byId.get("fx")!.depth, v.byId.get("fg")!.depth]).toEqual([1, 2]);
    expect([v.byId.get("fx")!.cluster, v.byId.get("fg")!.cluster]).toEqual(["build", "build"]);
    expect([v.byId.get("fx")!.name, v.byId.get("fg")!.name]).toEqual(["EXPLORE", "GENERAL"]);
  });
});

describe("agentView: edges", () => {
  it("no agents field = builders path (null); [] = agents mode with nothing in it", () => {
    expect(agentView({}, T0)).toBeNull();
    expect(V([]).counts.n).toBe(0);
    expect(V([]).order).toEqual([]);
  });
  it("a parent cycle never hangs and makes one of them top-level", () => {
    const v = V([agent("x", { parentId: "y" }), agent("y", { parentId: "x", spawnedAt: T0 - 1000 })]);
    expect(v.order).toHaveLength(2);
    expect(v.order.filter((L) => !L.parent)).toHaveLength(1);
    expect(Math.max(...v.order.map((L) => L.depth))).toBeLessThanOrEqual(1);
  });
  it("a self-parent or a missing parent is top-level", () => {
    expect(V([agent("s", { parentId: "s" })]).order[0].parent).toBeNull();
    const m = V([agent("m", { parentId: "gone" })]).order[0];
    expect([m.parent, m.depth]).toEqual([null, 0]);
  });
  it("depth is capped at 2", () => {
    const v = V([agent("a"), agent("b", { parentId: "a", spawnedAt: T0 - 3000 }), agent("c", { parentId: "b", spawnedAt: T0 - 2000 }), agent("d", { parentId: "c", spawnedAt: T0 - 1000 })]);
    expect(v.byId.get("d")!.depth).toBe(2);
  });
  it("a parent stays visible while a child is", () => {
    const v = V([agent("p", { state: "done", endedAt: T0 - 60_000, spawnedAt: T0 - 90_000 }), agent("k", { parentId: "p" })]);
    expect(v.order.map((L) => L.id)).toEqual(["p", "k"]);
  });
  it("an agent spawned in the future is not drawn yet", () => {
    expect(V([agent("later", { spawnedAt: T0 + 1000 })]).order).toEqual([]);
  });
  it("a re-dispatch whose failed run was cut still carries its escalatedFrom pill", () => {
    const L = V([agent("e4", { model: "opus", escalatedFrom: "sonnet", running: run("Read", 3) })]).order[0];
    expect(pillModels(L)).toEqual(["sonnet", "opus"]);
    expect(actLine(L, T0)).toBe("SONNET → OPUS · READ 0:03");
    expect(partsText(detailRows(L, T0).chain)).toBe("SONNET ✗ → OPUS");
  });
  it("clean() keeps every field inside the contract, whatever the wire sent", () => {
    const c = clean(agent("z", { state: "bogus" as never, type: "hacker" as never, model: "gpt" as never, toolCalls: "7" as never, tokens: -5, task: "x".repeat(300), running: { tool: "y".repeat(90), since: T0 } }));
    expect([c.state, c.type, c.model, c.toolCalls, c.tokens, c.task!.length, c.running!.tool.length]).toEqual(["working", "other", null, 7, 0, 160, 64]);
    expect(V([agent("z", { type: "hacker" as never })]).order[0].name).toBe("AGENT");
  });
  it("derives a tally when the server sent none", () => {
    expect(V(FX.e).tally).toEqual({ spawned: 6, passed: 1, failed: 1, escalated: 0 });
  });
  it("detail cells: tool now, elapsed, tool calls, tokens", () => {
    const d = detailRows(V(FX.b).byId.get("b4")!, T0);
    expect(d.name).toEqual({ text: "EXECUTOR 4 · SONNET", color: HEX.sonnet });
    expect(d.word).toEqual({ text: "NEEDS YOU", color: HEX.jev });
    expect(d.cells.map((c) => [c.v, c.k])).toEqual([["BASH 0:37", "WAITING ON"], ["4:09", "ELAPSED"], ["12", "TOOL CALLS"], ["18K", "TOKENS"]]);
  });
  it("formats tokens and minutes like the prototype", () => {
    expect([kfmt(999), kfmt(1500), kfmt(41200), kfmt(2_500_000), mmss(72_000)]).toEqual(["999", "1.5K", "41K", "2.5M", "1:12"]);
  });
  it("the signature changes with what the scene draws, not with time", () => {
    const a = agentSig(V(FX.b));
    expect(agentSig(V(FX.b, T0 + 5000))).toBe(a);
    expect(agentSig(V(FX.b.map((x) => (x.id === "b2" ? { ...x, toolCalls: 45 } : x))))).not.toBe(a);
    expect(agentSig(null)).toBe("");
  });
  it("countParts is empty for no agents", () => {
    expect(countParts(V([]).counts)).toEqual([]);
  });
});

describe("haiku and selection setup", () => {
  it("haiku has its own muted colour token", () => {
    expect(HEX.haiku).toBe("#C4B5A5");
    expect(modelHex("haiku")).toBe("#C4B5A5");
    expect(MODELW.haiku).toBe("HAIKU");
    expect(fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8")).toContain("--haiku:#C4B5A5");
  });
  it("the inspect popover names haiku", () => {
    const n: WireNode = { key: "b0", state: "working", model: "haiku" as never, startedAt: T0 - 5000, task: null, waiting: null };
    expect(popoverContent(sess("a", { nodes: [n] }), "b0", T0)!.lines[0].text).toBe("Haiku · working · 5s");
  });
  it("no agent is selected at start", () => {
    expect(ui.agentSel).toBeNull();
  });
});

describe("wire → store", () => {
  it("a session that gains agents keeps them when a later message omits the field", () => {
    upsert(wire("a"), 0);
    expect(store.sessions.get("a")!.agents).toBeUndefined();
    upsert(wire("a", { agents: [agent("e1")], agentTally: { spawned: 1, passed: 0, failed: 0, escalated: 0 } }), 0);
    upsert(wire("a", { stage: 4 }), 0);
    expect(store.sessions.get("a")!.agents!.map((x) => x.id)).toEqual(["e1"]);
    expect(store.sessions.get("a")!.stage).toBe(4);
  });
});
