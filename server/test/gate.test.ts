import { describe, expect, it } from "vitest";
import { toWire } from "@fo/shared";
import { Engine } from "../src/engine";
import { parseJevLine } from "../src/jev";
import { Store } from "../src/store";
import { ev, run } from "./events";
import { at, jev, mk } from "./helpers";

const gate = (o: object) => JSON.stringify({ ts: "2026-10-07T12:00:00+0700", tool: "Bash", head: "rm -rf x", ...o });

describe("parseJevLine ask", () => {
  it("gate ask → ask; deny → deny; no decision → other; ask outside gate → other", () => {
    expect(parseJevLine("gate", gate({ decision: "ask" }))!.kind).toBe("ask");
    expect(parseJevLine("gate", gate({ decision: "deny" }))!.kind).toBe("deny");
    expect(parseJevLine("gate", gate({}))!.kind).toBe("other");
    expect(parseJevLine("judge", gate({ decision: "ask" }))!.kind).toBe("other");
  });
});

const sub = [ev(1, "Prompt", {}), ev(2, "Dispatch", { model: "sonnet" }), ev(3, "SubStart", { subId: "a1", executor: true })];

describe("gateFlash (spec §11)", () => {
  it("ask from a builder → its d ring", () => {
    const r = run([...sub, ev(10, "ToolPre", { tool: "Bash", agentId: "a1" }), ev(10, "JevAsk", { tool: "Bash" })]);
    expect(r.s.gateFlash).toEqual({ gate: "d0", kind: "ask", at: at(10) });
    expect(toWire(r.s).gateFlash).toEqual({ gate: "d0", kind: "ask", at: at(10) });
  });
  it("ask from main → route; at Ship → commit", () => {
    expect(run([ev(1, "Prompt", {}), ev(5, "ToolPre", { tool: "Bash" }), ev(5, "JevAsk", { tool: "Bash" })]).s.gateFlash?.gate).toBe("route");
    expect(run([ev(1, "Prompt", {}), ev(2, "Dispatch", { model: "sonnet" }), ev(3, "Skill", { skill: "commit" }), ev(5, "ToolPre", { tool: "Bash" }), ev(5, "JevAsk", { tool: "Bash" })]).s.gateFlash?.gate).toBe("commit");
  });
  it("deny sets kind deny on the same rule and keeps today's deny state", () => {
    const r = run([...sub, ev(10, "ToolPre", { tool: "Bash", agentId: "a1" }), ev(10, "JevDeny", { tool: "Bash", command: "Bash rm" })]);
    expect(r.s.gateFlash).toEqual({ gate: "d0", kind: "deny", at: at(10) });
    expect(r.s.deny).toEqual({ builder: 0, command: "Bash rm" });
  });
  it("ask is passive and changes nothing else", () => {
    const base = run([ev(1, "Prompt", {})]).s;
    const r = run([ev(1, "Prompt", {}), ev(400, "JevAsk", { tool: "Bash" })]).s;
    expect({ ...r, gateFlash: undefined }).toEqual({ ...base, gateFlash: undefined });
  });
});

describe("gateFlash through the engine", () => {
  it("a Jev gate ask line for a live session flashes kind ask", () => {
    const e = new Engine(new Store(":memory:"), () => at(11));
    const a = mk("s1", "/p/app");
    e.ingestSpool(a.pre(10, "Bash", { command: "rm -rf x" }));
    e.ingestJev("gate", jev(11, { tool: "Bash", head: "rm", decision: "ask", session_id: "s1" }));
    expect(e.sessions.get("s1")!.gateFlash?.kind).toBe("ask");
  });
});
