import { describe, expect, it } from "vitest";
import { toWire } from "@fo/shared";
import { ev, run } from "./events";
import type { ExecModel } from "@fo/shared";

const H = "haiku";
const build = (model: string, id = "a") => [ev(1, "Dispatch", { model: model as ExecModel }), ev(1, "SubStart", { subId: id, executor: true })];

describe("haiku rung", () => {
  it("a haiku dispatch advances to Build", () => {
    expect(run(build("haiku")).s.stage).toBe(3);
  });
  it("a haiku SubDone is recorded as a build call", () => {
    const { emit } = run([...build("haiku"), ev(31, "SubDone", { subId: "a", ok: true })]);
    expect(emit.calls).toContainEqual(expect.objectContaining({ role: "build", model: "haiku", ok: true }));
  });
  it("haiku→sonnet escalation keeps the session in Build", () => {
    const { s, emit } = run([...build("haiku"), ev(5, "SubDone", { subId: "a", ok: false }), ev(6, "Escalation", { from: H, to: "sonnet", task: "T1" })]);
    expect(s.stage).toBe(3);
    expect(s.esc).toBeNull();
    expect(s.cycleEscalations).toBe(0);
    expect(s.status).not.toBe("escalated");
    expect(toWire(s).status).not.toBe("escalated");
    expect(emit.escalations).toEqual([expect.objectContaining({ task: "T1", from: "haiku", to: "sonnet" })]);
  });
  it("a haiku skip-up to opus does not escalate either", () => {
    const { s, emit } = run([...build("haiku"), ev(6, "Escalation", { from: H, to: "opus", task: "T1" })]);
    expect(s.stage).toBe(3);
    expect(s.esc).toBeNull();
    expect(s.cycleEscalations).toBe(0);
    expect(emit.escalations).toHaveLength(1);
  });
  it("sonnet→opus still reaches Escalate and counts", () => {
    const { s } = run([...build("sonnet"), ev(5, "SubDone", { subId: "a", ok: false }), ev(6, "Escalation", { from: "sonnet", to: "opus", task: "T1" })]);
    expect(s.stage).toBe(4);
    expect(s.esc).not.toBeNull();
    expect(s.cycleEscalations).toBe(1);
  });
});
