import { beforeEach, expect, it, vi } from "vitest";
import { eff, sorted } from "../src/select";
import { store } from "../src/state";
import { applySnapshot, upsert } from "../src/store";
import { T0, reset, sess, wire } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); });

it("sorts by attention rank, then arrival order", () => {
  store.sessions.set("a", sess("a", { status: "idle" }, 0));
  store.sessions.set("b", sess("b", { status: "escalated" }, 1));
  store.sessions.set("c", sess("c", { status: "waiting" }, 2));
  store.sessions.set("d", sess("d", {}, 3));
  expect(sorted().map((s) => s.id)).toEqual(["c", "b", "d", "a"]);
});

it("treats an active session quiet for 10 min as idle on the client too", () => {
  const s = sess("a", { lastEventAt: T0 - 600_001 });
  expect(eff(s)).toBe("idle");
});

it("upsert keeps a terminal log of distinct say lines, max 40", () => {
  for (let i = 0; i < 45; i++) upsert(wire("a", { say: { t: T0 + i, text: `line ${i}` } }), 0);
  upsert(wire("a", { say: { t: T0 + 44, text: "line 44" } }), 0);
  const log = store.sessions.get("a")!.log;
  expect(log).toHaveLength(40);
  expect(log[39].text).toBe("line 44");
});

it("a snapshot removes sessions it does not list and keeps arrival order", () => {
  applySnapshot([wire("a"), wire("b")]);
  applySnapshot([wire("b"), wire("c")]);
  expect([...store.sessions.keys()]).toEqual(["b", "c"]);
  expect(store.sessions.get("c")!.order).toBeGreaterThan(store.sessions.get("b")!.order);
});

const L = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ t: T0 + from + i, text: `w${from + i}` }));

it("empty client log is seeded from wire log", () => {
  upsert(wire("a", { log: L(3) }), 0);
  expect(store.sessions.get("a")!.log.map((l) => l.text)).toEqual(["w0", "w1", "w2"]);
  applySnapshot([wire("b", { log: L(2) })]);
  expect(store.sessions.get("b")!.log).toHaveLength(2);
});

it("seeds an existing session whose client log is empty (session message path)", () => {
  upsert(wire("a"), 0);
  upsert(wire("a", { log: L(2) }), 0);
  expect(store.sessions.get("a")!.log.map((l) => l.text)).toEqual(["w0", "w1"]);
});

it("does not duplicate when the wire say equals the last seeded entry", () => {
  const log = L(3);
  upsert(wire("a", { log, say: log[2] }), 0);
  expect(store.sessions.get("a")!.log).toHaveLength(3);
});

it("a longer client log is not overwritten by a shorter wire log", () => {
  for (let i = 0; i < 10; i++) upsert(wire("a", { say: { t: T0 + i, text: `c${i}` } }), 0);
  upsert(wire("a", { log: L(2), say: { t: T0 + 9, text: "c9" } }), 0);
  const log = store.sessions.get("a")!.log;
  expect(log).toHaveLength(10);
  expect(log[0].text).toBe("c0");
});

it("seeded card returns to normal max after a live line", () => {
  upsert(wire("a", { log: L(6) }), 0);
  expect(store.sessions.get("a")!.seeded).toBe(true);
  upsert(wire("a", { log: L(6), say: { t: T0 + 100, text: "live" } }), 0);
  expect(store.sessions.get("a")!.seeded).toBeFalsy();
});

it("pushLog skips a line with the same text as the last entry even at a new t", () => {
  upsert(wire("a", { say: { t: T0, text: "same" } }), 0);
  upsert(wire("a", { say: { t: T0 + 5, text: "same" } }), 0);
  expect(store.sessions.get("a")!.log).toHaveLength(1);
});

it("reconnect appends wire log lines newer than the client's last, in order, deduped", () => {
  upsert(wire("a", { log: L(2) }), 0);
  upsert(wire("a", { log: [...L(2), { t: T0 + 10, text: "gap1" }, { t: T0 + 11, text: "gap1" }, { t: T0 + 12, text: "gap2" }] }), 0);
  const s = store.sessions.get("a")!;
  expect(s.log.map((l) => l.text)).toEqual(["w0", "w1", "gap1", "gap2"]);
  expect(s.seeded).toBeFalsy();
});
