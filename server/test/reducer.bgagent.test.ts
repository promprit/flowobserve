import { describe, expect, it } from "vitest";
import { toWire } from "@fo/shared";
import { reduce, tick } from "../src/reducer";
import { ev, run } from "./events";
import { at } from "./helpers";

const MIN = 60;
/** Main dispatches a background plan agent, then its turn ends while the agent keeps working. */
const dispatched = [
  ev(1, "SubStart", { subId: "p", executor: false, agentType: "general-purpose" }),
  ev(2, "ToolPre", { tool: "Read", agentId: "p", useId: "u1" }),
  ev(3, "ToolPost", { tool: "Read", agentId: "p", useId: "u1" }),
  ev(4, "Say", { text: "Plan agent is still drafting." }),
  ev(5, "Await", { why: "stop", text: "" }),
];

describe("background subagent holds a passive wait", () => {
  it("stop while a background agent works is not waiting", () => {
    expect(run(dispatched).s.status).toBe("active");
  });
  it("an idle prompt while it works is not waiting either", () => {
    const { s } = run([...dispatched, ev(65, "Await", { why: "idle", text: "" })]);
    expect(s.status).not.toBe("waiting");
  });
  it("a permission prompt still waits while the agent works", () => {
    const { s } = run([...dispatched, ev(6, "Await", { why: "notification", text: "Claude needs your permission to use Bash" })]);
    expect(s.status).toBe("waiting");
  });
  it("an agent that keeps working past 2h stays live", () => {
    const steps = [];
    for (let t = 9 * MIN; t <= 130 * MIN; t += 9 * MIN) steps.push(ev(t, "ToolPost", { tool: "Write", agentId: "p" }));
    const { s } = run([...dispatched, ...steps]);
    expect(tick(s, at(131 * MIN)).state.status).not.toBe("waiting");
  });
  it("an agent silent for 10 minutes is stale, so the wait shows", () => {
    const { s } = run(dispatched);
    expect(tick(s, at(3) + 599_000).state.status).not.toBe("waiting");
    expect(tick(s, at(3) + 600_000).state.status).toBe("waiting");
  });
  it("a long tool call in flight keeps the agent live", () => {
    const { s } = run([...dispatched, ev(6, "ToolPre", { tool: "Bash", agentId: "p", useId: "u2" })]);
    expect(tick(s, at(6 + 40 * MIN)).state.status).not.toBe("waiting");
  });
  it("the agent finishing clears the held wait; main's next stop waits", () => {
    const { s } = run([...dispatched, ev(100, "SubDone", { subId: "p", ok: null })]);
    expect(s.status).toBe("active");
    expect(s.liveSubs ?? {}).toEqual({});
    expect(reduce(s, ev(110, "Await", { why: "stop", text: "Plan ready" })).state.status).toBe("waiting");
  });
  it("a SubDone with no start (Claude Code's own helpers) changes nothing", () => {
    const { s } = run([ev(1, "Await", { why: "stop", text: "Q" }), ev(2, "SubDone", { subId: "x", ok: null })]);
    expect(s.status).toBe("waiting");
  });
  it("a live agent in a long tool call reads active, not idle", () => {
    const { s } = run([...dispatched, ev(6, "ToolPre", { tool: "Bash", agentId: "p", useId: "u2" })]);
    expect(tick(s, at(6 + 40 * MIN)).state.status).toBe("active");
  });
  it("a dead agent's dangling tool call stops holding the wait after 3h", () => {
    const { s } = run([...dispatched, ev(6, "ToolPre", { tool: "Bash", agentId: "p", useId: "u2" })]);
    expect(tick(s, at(6 + 179 * MIN)).state.status).toBe("active");
    expect(tick(s, at(6 + 181 * MIN)).state.status).toBe("waiting");
  });
  it("a Stop after a permission prompt keeps the prompt showing", () => {
    const { s } = run([
      ...dispatched.slice(0, 3),
      ev(4, "Await", { why: "notification", text: "Claude needs your permission to use Bash" }),
      ev(5, "Await", { why: "stop", text: "" }),
    ]);
    expect(s.status).toBe("waiting");
    expect(s.waiting?.passive).toBeUndefined();
  });
  it("a plan Stop after a permission prompt still asks to APPROVE PLAN", () => {
    const { s } = run([
      ...dispatched.slice(0, 3),
      ev(4, "Await", { why: "notification", text: "Claude needs your permission to use Bash" }),
      ev(5, "PlanWritten", { path: "p", tasks: 4 }),
      ev(6, "Await", { why: "stop", text: "" }),
    ]);
    expect(s.status).toBe("waiting");
    expect(toWire(s).action).toBe("APPROVE PLAN");
  });
  it("two agents hold the wait until the last one finishes", () => {
    const { s } = run([
      ev(1, "SubStart", { subId: "q", executor: false, agentType: "Explore" }),
      ...dispatched,
      ev(50, "SubDone", { subId: "q", ok: null }),
    ]);
    expect(s.status).toBe("active");
    expect(s.waiting?.passive).toBe(true);
    expect(reduce(s, ev(60, "SubDone", { subId: "p", ok: null })).state.waiting).toBeNull();
  });
  it("a prompt during a held wait logs no gate time", () => {
    const { s } = run([ev(0, "PlanWritten", { path: "p", tasks: 3 }), ...dispatched]);
    expect(reduce(s, ev(30, "Prompt", {})).emit.calls.filter((c) => c.role === "gate")).toEqual([]);
  });
  it("End drops live agents", () => {
    const { s } = run([...dispatched, ev(6, "End", {})]);
    expect(s.liveSubs ?? {}).toEqual({});
  });
});
