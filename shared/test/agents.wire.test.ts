import { describe, expect, it } from "vitest";
import { NodeZ } from "../src/wire";
import { AGENT_CAP, AgentZ, DONE_DROP_MS, SessionZ, toAgents, type AgentLedger, type AgentRec } from "../src";

const rec = (id: string, o: Partial<AgentRec> = {}): AgentRec => ({
  id, type: "executor", model: "sonnet", parentId: null, spawnedAt: 1000, endedAt: null, state: "working",
  task: null, running: null, toolCalls: 0, escalatedFrom: null, lastAt: 1000, ...o,
});
const ledger = (list: AgentRec[]): AgentLedger =>
  ({ list, pending: [], tally: { spawned: list.length, passed: 0, failed: 0, escalated: 0 }, escNext: null });

describe("AgentZ", () => {
  const ok = { id: "a1", type: "executor", model: "sonnet", parentId: null, spawnedAt: 1, endedAt: null, state: "working",
    task: null, running: null, toolCalls: 0, tokens: 0, escalatedFrom: null };
  it("accepts a valid agent", () => expect(AgentZ.parse(ok)).toEqual(ok));
  it("rejects unknown enums, long task, fractional counts and extra keys", () => {
    expect(AgentZ.safeParse({ ...ok, type: "wizard" }).success).toBe(false);
    expect(AgentZ.safeParse({ ...ok, state: "sleeping" }).success).toBe(false);
    expect(AgentZ.safeParse({ ...ok, model: "gpt-x" }).success).toBe(false);
    expect(AgentZ.safeParse({ ...ok, escalatedFrom: "fable" }).success).toBe(false);
    expect(AgentZ.safeParse({ ...ok, task: "x".repeat(161) }).success).toBe(false);
    expect(AgentZ.safeParse({ ...ok, toolCalls: 1.5 }).success).toBe(false);
    expect(AgentZ.safeParse({ ...ok, prompt: "x" }).success).toBe(false);
  });
  it("accepts haiku as a model and as escalatedFrom", () => {
    expect(AgentZ.safeParse({ ...ok, model: "haiku" }).success).toBe(true);
    expect(AgentZ.safeParse({ ...ok, escalatedFrom: "haiku" }).success).toBe(true);
  });
  it("exports the done-drop window as 30 s", () => expect(DONE_DROP_MS).toBe(30_000));
  it("accepts the optional task tags and an agent without them", () => {
    expect(AgentZ.safeParse({ ...ok, taskId: "x:1", role: "tester" }).success).toBe(true);
    expect(AgentZ.safeParse(ok).success).toBe(true);
    expect(AgentZ.safeParse({ ...ok, role: "wizard" }).success).toBe(false);
  });
  it("SessionZ caps agents at 16", () => {
    expect(SessionZ.shape.agents.unwrap().safeParse(Array(17).fill(ok)).success).toBe(false);
    expect(SessionZ.shape.agents.unwrap().safeParse(Array(16).fill(ok)).success).toBe(true);
  });
});

describe("toAgents parent cycles", () => {
  const fill = (n: number) => Array.from({ length: n }, (_, i) => rec(`w${i}`));
  it("a kept agent whose parent was cut and points back at it never parents itself", () => {
    // a <-> b; b (done) is cut by the cap, a (working) is kept
    const l = ledger([rec("a", { parentId: "b" }), rec("b", { state: "done", endedAt: 2000, parentId: "a" }), ...fill(AGENT_CAP - 1)]);
    const out = toAgents(l);
    expect(out.map((a) => a.id)).not.toContain("b");
    expect(out.find((a) => a.id === "a")!.parentId).toBeNull();
  });
  it("a 2-cycle with both members cut returns, and the kept child gets null", () => {
    // reads of the cyclic parentId are counted so a runaway walk fails instead of hanging the run
    let reads = 0;
    const cyc = (id: string, parent: string) => {
      const r = rec(id, { state: "done", endedAt: 2000 });
      Object.defineProperty(r, "parentId", { get: () => { if (++reads > 10_000) throw new Error("kept() walk did not terminate"); return parent; } });
      return r;
    };
    const l = ledger([cyc("a", "b"), cyc("b", "a"), rec("c", { parentId: "a" }), ...fill(AGENT_CAP - 1)]);
    const out = toAgents(l);
    expect(out.map((a) => a.id)).not.toContain("a");
    expect(out.find((a) => a.id === "c")!.parentId).toBeNull();
  }, 2000);
});

describe("toAgents", () => {
  it("returns [] for a session without a ledger", () => expect(toAgents(undefined)).toEqual([]));
  it("with now, drops a done agent ended over 30 s ago and keeps one ended 10 s ago", () => {
    const now = 100_000;
    const l = ledger([rec("old", { state: "done", endedAt: now - 31_000 }), rec("fresh", { state: "done", endedAt: now - 10_000 }), rec("live")]);
    expect(toAgents(l, {}, now).map((a) => a.id)).toEqual(["fresh", "live"]);
    expect(toAgents(l).map((a) => a.id)).toEqual(["old", "fresh", "live"]);
  });
  it("clips an 80-char id and parentId to 64 and the result passes AgentZ", () => {
    const long = "i".repeat(80), par = "p".repeat(80);
    const out = toAgents(ledger([rec(par), rec(long, { parentId: par })]));
    expect(out[1].id).toHaveLength(64);
    expect(out[1].parentId).toHaveLength(64);
    for (const a of out) expect(AgentZ.safeParse(a).success).toBe(true);
  });
  it("adds tokens, keeps spawn order and drops lastAt", () => {
    const out = toAgents(ledger([rec("a"), rec("b")]), { b: 48_000 });
    expect(out.map((a) => [a.id, a.tokens])).toEqual([["a", 0], ["b", 48_000]]);
    expect(out[0]).not.toHaveProperty("lastAt");
  });
  it("over the cap keeps waiting, blocked, failed, working, spawning, then newest done", () => {
    const list = [
      ...Array.from({ length: 10 }, (_, i) => rec(`d${i}`, { state: "done", endedAt: 2000 + i })),
      rec("w", { state: "waiting" }), rec("b", { state: "blocked" }), rec("f", { state: "failed", endedAt: 1500 }),
      ...Array.from({ length: 4 }, (_, i) => rec(`k${i}`, { state: "working" })), rec("s", { state: "spawning" }),
    ];
    const ids = toAgents(ledger(list)).map((a) => a.id);
    expect(ids).toHaveLength(AGENT_CAP);
    for (const must of ["w", "b", "f", "k0", "k1", "k2", "k3", "s"]) expect(ids).toContain(must);
    expect(ids.filter((x) => x.startsWith("d"))).toEqual(["d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"]);
  });
  it("re-parents to the nearest kept ancestor, else null", () => {
    const list = [
      rec("p", { state: "done", endedAt: 1 }),
      ...Array.from({ length: 16 }, (_, i) => rec(`k${i}`, { state: "working" })),
      rec("c", { state: "waiting", parentId: "p" }),
    ];
    expect(toAgents(ledger(list)).find((a) => a.id === "c")!.parentId).toBeNull();
  });
  it("clips a long tool name to 64 and stays schema-valid", () => {
    const out = toAgents(ledger([rec("a", { running: { tool: "mcp__" + "x".repeat(100), since: 1 } })]));
    expect(out[0].running!.tool).toHaveLength(64);
    expect(() => AgentZ.parse(out[0])).not.toThrow();
  });
});

describe("NodeZ model", () => {
  it("accepts haiku", () => {
    const n = { key: "b0", state: "working", model: "haiku", startedAt: 1, task: null, waiting: null };
    expect(NodeZ.safeParse(n).success).toBe(true);
    expect(NodeZ.safeParse({ ...n, model: "gpt-x" }).success).toBe(false); // the failure above is the model enum, not the shape
  });
});

describe("agent task tags", () => {
  it("copies the plan task id and role from the log_dispatch tag", () => {
    const out = toAgents(ledger([rec("a"), rec("b")]), {}, 2000, { a: { task: "worktree-x:3", role: "coder" } });
    expect(out.map((a) => [a.taskId, a.role])).toEqual([["worktree-x:3", "coder"], [null, null]]);
  });
  it("maps an unknown role to null and caps the id", () => {
    const out = toAgents(ledger([rec("a")]), {}, 2000, { a: { task: "t".repeat(200), role: "wizard" } });
    expect([out[0].taskId!.length, out[0].role]).toEqual([96, null]);
  });
});
