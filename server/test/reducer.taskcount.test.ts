import { describe, expect, it } from "vitest";
import { toWire, type Event } from "@fo/shared";
import { ev as rawEv, run } from "./events";

const ev = rawEv as unknown as (sec: number, k: string, f: Record<string, unknown>) => Event;
const start = (sec: number, id: string, model = "haiku") => [
  ev(sec, "Dispatch", { model }), ev(sec, "SubStart", { subId: id, executor: true }),
];
const tag = (sec: number, task: string, role: string, tier = "haiku") => ev(sec, "TaskDispatch", { task, role, tier });
const done = (sec: number, id: string) => ev(sec, "SubDone", { subId: id, ok: true });
const T = (n: number) => `worktree-klum-m0:${n}`;

describe("tasksDone counts distinct coder tasks", () => {
  it("klum shape counts distinct coder tasks", () => {
    const evs: Event[] = [...start(1, "c1"), tag(2, T(1), "coder"), done(3, "c1")];
    const ids = [2, 3, 4, 5, 6];
    for (const n of ids) evs.push(...start(10, `t${n}`));
    for (const n of ids) evs.push(tag(13, T(n), "tester"));
    for (const n of ids) evs.push(done(20 + n, `t${n}`));
    for (const n of ids) {
      evs.push(...start(40 + n, `k${n}`, "sonnet"), tag(41 + n, T(n), "coder", "sonnet"), done(50 + n, `k${n}`));
    }
    expect(run(evs).s.tasksDone).toBe(6);
  });
  it("a coder retry on the same task counts once", () => {
    const { s } = run([
      ...start(1, "a"), tag(2, T(1), "coder"), done(3, "a"),
      ...start(4, "b"), tag(5, T(1), "coder"), done(6, "b"),
    ]);
    expect(s.tasksDone).toBe(1);
  });
  it("a tester-only task counts 0", () => {
    const { s } = run([...start(1, "a"), tag(2, T(2), "tester"), done(3, "a")]);
    expect(s.tasksDone).toBe(0);
  });
  it("no TaskDispatch keeps today's count", () => {
    const { s } = run([...start(1, "a"), ...start(2, "b"), done(3, "a"), done(4, "b")]);
    expect(s.tasksDone).toBe(2);
  });
  it("a sub finishing before its TaskDispatch: coder counts 1, not 2", () => {
    const { s } = run([...start(1, "a"), done(2, "a"), tag(3, T(1), "coder")]);
    expect(s.tasksDone).toBe(1);
  });
  it("a sub finishing before its TaskDispatch: tester counts 0", () => {
    const { s } = run([...start(1, "a"), done(2, "a"), tag(3, T(2), "tester")]);
    expect(s.tasksDone).toBe(0);
  });
  it("a tag whose tier matches no queued sub does not steal a haiku coder's pairing", () => {
    const { s } = run([
      ...start(1, "c"), tag(2, T(9), "reviewer", "opus"), tag(3, T(1), "coder"), done(4, "c"),
    ]);
    expect(s.tasksDone).toBe(1);
  });
  it("a tag arriving before its SubStart is applied at SubStart", () => {
    const { s } = run([tag(1, T(1), "coder"), ...start(2, "a"), done(3, "a")]);
    expect(s.tasksDone).toBe(1);
    expect(s.subQueue ?? []).toEqual([]);
  });
  it("a tagged review sub is never credited", () => {
    const { s } = run([
      ev(1, "Skill", { skill: "interrogate" }),
      ...start(2, "r", "opus"), tag(3, T(1), "reviewer", "opus"), done(4, "r"),
    ]);
    expect(s.tasksDone).toBe(0);
  });
  it("escalation retries on one task count once", () => {
    const { s } = run([
      ...start(1, "a", "sonnet"), tag(2, T(1), "coder", "sonnet"), ev(3, "SubDone", { subId: "a", ok: false }),
      ...start(4, "b", "sonnet"), tag(5, T(1), "coder", "sonnet"), ev(6, "SubDone", { subId: "b", ok: false }),
      ...start(7, "c", "opus"), tag(8, T(1), "coder", "opus"), done(9, "c"),
    ]);
    expect(s.tasksDone).toBe(1);
  });
});

describe("wire task tags", () => {
  it("an executor's wire agent carries its plan task and role", () => {
    const { s } = run([...start(1, "c1"), tag(2, T(4), "coder")]);
    const a = toWire(s).agents?.find((x) => x.id === "c1");
    expect([a?.taskId, a?.role]).toEqual([T(4), "coder"]);
  });
});

describe("wire task tags, untagged", () => {
  it("an untagged executor and a reviewer serialize taskId and role as null", () => {
    const { s } = run([
      ...start(1, "x"),
      ev(2, "Skill", { skill: "interrogate" }), ...start(3, "r", "opus"),
    ]);
    const w = toWire(s).agents ?? [];
    for (const id of ["x", "r"]) {
      const a = w.find((q) => q.id === id);
      expect(a, id).toBeDefined();
      expect([a?.taskId ?? null, a?.role ?? null]).toEqual([null, null]);
    }
  });
});
