import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { SessionState } from "@fo/shared";
import { emptyEmit, initState, reduce } from "../src/reducer";
import { Store } from "../src/store";

const tr = (sid: string, ts: number, toStatus: "active" | "waiting") =>
  ({ sid, ts, fromStage: 0, toStage: 0, fromStatus: "active" as const, toStatus, cause: "t" });

describe("Store", () => {
  it("opens the same file twice (idempotent schema) and keeps data", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-")), "fo.db");
    new Store(file).setOffset("/a", 10);
    expect(new Store(file).getOffset("/a")).toBe(10);
  });
  it("offsets default to 0 and can be deleted", () => {
    const st = new Store(":memory:");
    expect(st.getOffset("/x")).toBe(0);
    st.setOffset("/x", 5); st.setOffset("/x", 7);
    expect(st.getOffset("/x")).toBe(7);
    st.deleteOffset("/x");
    expect(st.getOffset("/x")).toBe(0);
  });
  it("round-trips session state", () => {
    const st = new Store(":memory:");
    const s = { ...initState("s1", "/p/app", 1), slots: { a: 0 }, retired: true };
    st.saveSession(s);
    st.saveSession({ ...s, stage: 3 });
    expect(st.loadSessions()).toEqual([{ ...s, stage: 3 }]);
  });
  it("transitionsFrom includes the last row before the window", () => {
    const st = new Store(":memory:");
    st.insert({ ...emptyEmit(), transitions: [tr("a", 1, "waiting"), tr("a", 2, "active"), tr("a", 3, "waiting"), tr("b", 1, "waiting"), tr("a", 10, "active")] });
    expect(st.transitionsFrom(5).map((r) => [r.sid, r.ts])).toEqual([["a", 3], ["a", 10], ["b", 1]]);
  });
  it("stores calls with nullable ms/ok and filters by time", () => {
    const st = new Store(":memory:");
    st.insert({ ...emptyEmit(), calls: [
      { ts: 1, sid: "a", role: "build", model: "sonnet", ms: null, ok: null },
      { ts: 5, sid: "a", role: "build", model: "sonnet", ms: 30, ok: false },
    ] });
    expect(st.callsSince(2)).toEqual([{ ts: 5, sid: "a", role: "build", model: "sonnet", ms: 30, ok: false }]);
    expect(st.callsSince(0)[0]).toMatchObject({ ms: null, ok: null });
  });
  it("upserts cycles by (sid, started)", () => {
    const st = new Store(":memory:");
    st.insert({ ...emptyEmit(), cycles: [{ sid: "a", started: 1, ended: null, lastStage: 0, tasks: 0, escalations: 0, outcome: null }] });
    st.insert({ ...emptyEmit(), cycles: [{ sid: "a", started: 1, ended: 9, lastStage: 6, tasks: 3, escalations: 1, outcome: "shipped" }] });
    expect(st.cycles("a")).toEqual([{ sid: "a", started: 1, ended: 9, lastStage: 6, tasks: 3, escalations: 1, reviews: null, planTasks: null, outcome: "shipped" }]);
  });
  it("spend rows and kv", () => {
    const st = new Store(":memory:");
    st.insert({ ...emptyEmit(), spend: [{ ts: 3, sid: null, project: "unattributed", model: "jev-1.13", source: "jev", usd: 0.5 }] });
    expect(st.spendSince(0)).toEqual([{ ts: 3, sid: null, project: "unattributed", model: "jev-1.13", source: "jev", usd: 0.5 }]);
    expect(st.kvGet("k")).toBeNull();
    st.kvSet("k", "v");
    expect(st.kvGet("k")).toBe("v");
  });
  it("tx rolls back on error and nests", () => {
    const st = new Store(":memory:");
    expect(() => st.tx(() => { st.setOffset("/a", 1); st.tx(() => st.setOffset("/b", 2)); throw new Error("x"); })).toThrow("x");
    expect([st.getOffset("/a"), st.getOffset("/b")]).toEqual([0, 0]);
  });
  it("back-fills stageAt for a session saved before it existed", () => {
    const st = new Store(":memory:");
    const { stageAt: _drop, ...old } = { ...initState("s1", "/p/app", 1), stage: 3, since: 50 };
    st.saveSession(old as SessionState);
    expect(st.loadSessions()[0].stageAt).toEqual([1, null, null, 50, null, null, null]);
  });
});

describe("Store spend msg_id", () => {
  const row = (msgId: string | null, usd = 1) => ({ ts: 1, sid: "s1", project: "p", model: "claude-opus-5-5", source: "claude" as const, usd, msgId });
  it("a message id is stored once; null ids (Jev) are never deduped", () => {
    const st = new Store(":memory:");
    st.insert({ ...emptyEmit(), spend: [row("m1"), row("m1", 9), row(null), row(null)] });
    st.insert({ ...emptyEmit(), spend: [row("m1")] });
    expect(st.spendSince(0).map((r) => r.usd)).toEqual([1, 1, 1]);
    expect(st.spendSince(0)[0]).toEqual({ ts: 1, sid: "s1", project: "p", model: "claude-opus-5-5", source: "claude", usd: 1 });
  });
  it("upgrades a pre-msg_id database and keeps its rows", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-")), "fo.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE spend(ts INTEGER, sid TEXT, project TEXT, model TEXT, source TEXT, usd REAL); INSERT INTO spend VALUES(1, NULL, 'x', 'jev-1', 'jev', 0.5);");
    old.close();
    const st = new Store(file);
    st.insert({ ...emptyEmit(), spend: [row("m1"), row("m1")] });
    expect(st.spendSince(0).map((r) => r.usd)).toEqual([0.5, 1]);
    new Store(file).insert({ ...emptyEmit(), spend: [row("m1")] }); // reopen: idempotent migration, still unique
    expect(new Store(file).spendSince(0)).toHaveLength(2);
  });
});

describe("Dryas KPI tables", () => {
  it("round-trips escalation rows and cycle reviews", () => {
    const st = new Store(":memory:");
    st.insert({ ...emptyEmit(), escalations: [{ ts: 5, sid: "a", task: "T1", from: "sonnet", to: "opus" }],
      cycles: [{ sid: "a", started: 1, ended: 9, lastStage: 6, tasks: 3, escalations: 1, reviews: 2, outcome: "shipped" }] });
    expect(st.escalationsSince(0)).toEqual([{ ts: 5, sid: "a", task: "T1", from: "sonnet", to: "opus" }]);
    expect(st.escalationsSince(6)).toEqual([]);
    expect(st.cyclesSince(0)).toEqual([{ sid: "a", started: 1, ended: 9, lastStage: 6, tasks: 3, escalations: 1, reviews: 2, planTasks: null, outcome: "shipped" }]);
    expect(st.cyclesSince(9)).toHaveLength(1); // ended inside the window
    expect(st.cyclesSince(10)).toEqual([]);
  });

  it("opens a database made before the KPI change and keeps its cycle rows", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-kpi-")), "fo.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE cycles(sid TEXT, started INTEGER, ended INTEGER, last_stage INTEGER, tasks INTEGER, escalations INTEGER, outcome TEXT, PRIMARY KEY(sid, started));");
    old.exec("INSERT INTO cycles VALUES('a', 1, 9, 6, 3, 0, 'shipped')");
    old.close();
    const st = new Store(file);
    expect(st.cyclesSince(0)[0]).toMatchObject({ sid: "a", tasks: 3 });
    expect(st.escalationsSince(0)).toEqual([]);
  });
  it("a database made before the change reads reviews and planTasks as null, not 0", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-kpi2-")), "fo.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE cycles(sid TEXT, started INTEGER, ended INTEGER, last_stage INTEGER, tasks INTEGER, escalations INTEGER, outcome TEXT, PRIMARY KEY(sid, started));");
    old.exec("INSERT INTO cycles VALUES('a', 1, 9, 6, 3, 0, 'shipped')");
    old.close();
    expect(new Store(file).cyclesSince(0)[0]).toMatchObject({ sid: "a", reviews: null, planTasks: null });
  });

  it("round-trips planTasks, and unset reviews/planTasks store as null", () => {
    const st = new Store(":memory:");
    st.insert({ ...emptyEmit(), cycles: [
      { sid: "a", started: 1, ended: 9, lastStage: 6, tasks: 3, escalations: 0, reviews: 1, planTasks: 5, outcome: "shipped" },
      { sid: "b", started: 1, ended: 9, lastStage: 6, tasks: 3, escalations: 0, outcome: "shipped" },
    ] });
    expect(st.cycles("a")[0]).toMatchObject({ reviews: 1, planTasks: 5 });
    expect(st.cycles("b")[0]).toMatchObject({ reviews: null, planTasks: null });
  });

  it("inserting the same escalation twice yields one row", () => {
    const st = new Store(":memory:");
    const x = { ts: 5, sid: "a", task: "T1", from: "sonnet" as const, to: "opus" as const };
    st.insert({ ...emptyEmit(), escalations: [x, x] });
    st.insert({ ...emptyEmit(), escalations: [x] });
    expect(st.escalationsSince(0)).toEqual([x]);
  });
  it("a legacy session keeps its tasksDone through the task-pairing fields", () => {
    const st = new Store(":memory:");
    const { untaggedDone, doneTasks, ...legacy } = { ...initState("s1", "/p/app", 1), tasksDone: 3 };
    st.saveSession(legacy as SessionState);
    const [s] = st.loadSessions();
    expect(s.untaggedDone).toHaveLength(3);
    expect(s.doneTasks).toEqual([]);
    const b = { ts: 2, sid: "s1", cwd: "/p/app", agentId: null };
    const out = [{ ...b, k: "Dispatch", model: "haiku" }, { ...b, k: "SubStart", subId: "x", executor: true }, { ...b, k: "SubDone", subId: "x", ok: true }]
      .reduce((cur, e) => reduce(cur, e as never).state, s);
    expect(out.tasksDone).toBe(4);
  });
});
