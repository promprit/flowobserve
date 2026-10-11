import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MsgZ } from "@fo/shared";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { replayGolden } from "./golden";
import { at, mk } from "./helpers";

const a = mk();
const orchestrate = [
  a.start(0), a.prompt(1), a.pre(2, "Skill", { skill: "orchestrate" }),
  a.pre(10, "Agent", { subagent_type: "executor", description: "T1 hook", prompt: "SECRET-PROMPT" }),
  a.pre(10, "Agent", { subagent_type: "executor", description: "T2 ingest" }),
  a.pre(10, "Agent", { subagent_type: "executor", model: "opus", description: "T3 ledger" }),
  a.subStart(11, "e1"), a.subStart(11, "e2"), a.subStart(11, "e3"),
  a.pre(12, "Edit", { file_path: "/x" }, "e1"), a.post(13, "Edit", { file_path: "/x" }, undefined, "e1"),
  a.pre(14, "Bash", { command: "pnpm test" }, "e2"),
  a.subStop(20, "e1", "pass"), a.subStop(21, "e3", "fail"),
  a.pre(22, "mcp__jev__log_escalation", { from_model: "opus", to_model: "fable", task: "T3 ledger" }),
  a.pre(23, "Agent", { subagent_type: "executor", model: "fable" }), a.subStart(24, "e4"),
  a.pre(25, "Agent", { subagent_type: "ecc:code-reviewer", description: "review T1" }), a.subStart(26, "r1", "ecc:code-reviewer"),
];
const TALLY = { spawned: 5, passed: 1, failed: 1, escalated: 1 };

describe("agents through the real engine", () => {
  it("projects fan-out, a reviewer and an escalation onto the session", () => {
    const { snapshot } = replayGolden(orchestrate.join("\n") + "\n");
    MsgZ.parse(snapshot);
    const s = snapshot.sessions[0];
    expect(s.agents!.map((x) => [x.id, x.type, x.model, x.state, x.task, x.escalatedFrom])).toEqual([
      ["e1", "executor", "sonnet", "done", "T1 hook", null],
      ["e2", "executor", "sonnet", "working", "T2 ingest", null],
      ["e3", "executor", "opus", "escalated", "T3 ledger", null],
      ["e4", "executor", "fable", "spawning", "T3 ledger", "opus"],
      ["r1", "reviewer", null, "spawning", "review T1", null],
    ]);
    expect(s.agents!.find((x) => x.id === "e2")!.running).toEqual({ tool: "Bash", since: at(14) });
    expect(s.agentTally).toEqual(TALLY);
    expect(JSON.stringify(snapshot)).not.toContain("SECRET-PROMPT");
  });

  it("survives a restart from the saved session", () => {
    const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-ag-")), "fo.db");
    const one = new Engine(new Store(db), () => at(30));
    one.load();
    for (const l of orchestrate) one.ingestSpool(l);
    const two = new Engine(new Store(db), () => at(31));
    two.load();
    expect(two.snapshot().sessions[0].agentTally).toEqual(TALLY);
    expect(two.snapshot().sessions[0].agents!.map((x) => x.id)).toEqual(["e1", "e2", "e3", "e4", "r1"]);
  });
});
