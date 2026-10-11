import { describe, expect, it } from "vitest";
import { toWire, type Event } from "@fo/shared";
import { toEvents, parseSpoolLine } from "../src/ingest";
import { ev as rawEv, run } from "./events";
import { mk } from "./helpers";

const ev = rawEv as unknown as (sec: number, k: string, f: Record<string, unknown>) => Event;
const disp = (sec: number, model: string, task: string) => [
  ev(sec, "AgentDispatch", { subType: "executor", model, task, useId: null }), ev(sec, "Dispatch", { model }),
];
const sub = (sec: number, id: string) => ev(sec, "SubStart", { subId: id, executor: true });
const done = (sec: number, id: string, ok = true) => ev(sec, "SubDone", { subId: id, ok });
const esc = (sec: number, from: string, to: string, skip?: true) => ev(sec, "Escalation", { from, to, task: "T1", ...(skip ? { skip } : {}) });

const scenario = (skip: boolean) => run([
  ...disp(1, "haiku", "T1"), sub(2, "t1"), done(3, "t1"),
  esc(4, "haiku", "sonnet", skip ? true : undefined),
  ...disp(5, "sonnet", "T1"), sub(6, "c1"),
]);

describe("skip-up", () => {
  it("skip-up is not a climb", () => {
    const { s, emit } = scenario(true);
    const l = s.agents!;
    expect(l.list.find((a) => a.id === "t1")!.state).toBe("done");
    expect(l.tally).toMatchObject({ passed: 1, failed: 0, escalated: 0 });
    expect(l.list.find((a) => a.id === "c1")!.escalatedFrom).toBeNull();
    expect(l.escNext).toBeNull();
    expect(s.cycleEscalations).toBe(0);
    expect(emit.escalations).toEqual([expect.objectContaining({ from: "haiku", to: "sonnet" })]); // still counted, as /tune counts it
  });
  it("a real climb still marks the failed run escalated", () => {
    const { s } = scenario(false);
    const l = s.agents!;
    expect(l.list.find((a) => a.id === "t1")!.state).toBe("escalated");
    expect(l.tally).toMatchObject({ passed: 0, failed: 1, escalated: 1 });
    expect(l.list.find((a) => a.id === "c1")!.escalatedFrom).toBe("haiku");
  });
});

describe("Opus start tier", () => {
  const opusStart = (skip: boolean) => [esc(1, "sonnet", "opus", skip ? true : undefined), ...disp(2, "opus", "T1"), sub(3, "o1")];
  it("a skip-up Opus start is Build, not Escalate, and still counts for ESC-M1", () => {
    const evs = opusStart(true);
    const stages = evs.map((_, i) => run(evs.slice(0, i + 1)).s.stage);
    const { s, emit } = run(evs);
    expect(stages).not.toContain(4);
    expect(s.stage).toBe(3);
    expect(s.esc).toBeNull();
    expect(toWire(s, {}).status).not.toBe("escalated");
    expect(emit.escalations).toEqual([expect.objectContaining({ from: "sonnet", to: "opus" })]);
  });
  it("the start credit is used once: a later Opus dispatch without a skip-up still escalates", () => {
    const { s } = run([...opusStart(true), ...disp(4, "opus", "T2")]);
    expect(s.stage).toBe(4);
  });
  it("a real sonnet to opus climb still reaches Escalate", () => {
    const { s } = run(opusStart(false));
    expect(s.stage).toBe(4);
    expect(s.esc).not.toBeNull();
  });
});

describe("Bash-read interrogate", () => {
  const m = mk();
  it("then two reviewers (sonnet, opus) never reach Escalate", () => {
    const bash = toEvents(parseSpoolLine(m.pre(1, "Bash", { command: "cat /Users/p/.claude/skills/interrogate/SKILL.md" }))!)!;
    const evs = [...bash, ...disp(2, "sonnet", "rev a"), ...disp(2, "opus", "rev b"), sub(3, "r1"), sub(3, "r2")];
    const stages = evs.map((_, i) => run(evs.slice(0, i + 1)).s.stage);
    const { s } = run(evs);
    expect(stages).not.toContain(4);
    expect(toWire(s, {}).status).not.toBe("escalated");
  });
});
