import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MetricsZ, SessionZ, UsageZ } from "@fo/shared/wire";
import { pauseSim, simKey, startSim, stopSim } from "../src/sim";
import { store } from "../src/state";
import { T0, reset } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); });
afterEach(() => stopSim());

const strip = ({ order: _o, seen: _s, washAt: _w, ...rest }: Record<string, unknown>) => ({ ...rest, log: (rest.log as unknown[]).slice(-6) });

it("seeds n wire-valid sessions, metrics and usage", () => {
  startSim(4);
  expect(store.sessions.size).toBe(4);
  expect(store.demo).toBe(true);
  expect(store.link).toBe("live");
  for (const s of store.sessions.values()) SessionZ.parse(strip(s as unknown as Record<string, unknown>));
  MetricsZ.parse(store.metrics);
  UsageZ.parse(store.usage);
  vi.advanceTimersByTime(60_000);
  MetricsZ.parse(store.metrics);
  for (const s of store.sessions.values()) SessionZ.parse(strip(s as unknown as Record<string, unknown>));
});

it("never shows the dropped APPROVE DESIGN action", () => {
  startSim(7);
  for (let i = 0; i < 300; i++) {
    vi.advanceTimersByTime(1000);
    for (const s of store.sessions.values()) expect(s.action).not.toBe("APPROVE DESIGN");
  }
});

it("demo keys switch size, toggle offline and force states", () => {
  startSim(4);
  expect(simKey("1")).toBe(true);
  expect(store.sessions.size).toBe(1);
  expect(simKey("o")).toBe(true);
  expect(store.link).toBe("offline");
  simKey("o");
  expect(store.link).toBe("live");
  simKey("x");
  expect([...store.sessions.values()][0].status).toBe("deny");
  expect(simKey("q")).toBe(false);
});

it("demo usage includes a wire-valid fable meter", () => {
  startSim(2);
  expect(store.usage!.fable).toMatchObject({ used: expect.any(Number), resetsAt: expect.any(Number) });
  UsageZ.parse(store.usage);
});

it("demo sessions carry wire-valid nodes; a forced escalation shows the builder and Fable", () => {
  startSim(1);
  simKey("e");
  const s = [...store.sessions.values()][0];
  SessionZ.parse(strip(s as unknown as Record<string, unknown>));
  expect(s.nodes.map((n) => n.key)).toEqual(["b0", "b1", "b2", "fable"]);
  expect(s.nodes[0]).toMatchObject({ state: "failed", model: "fable", task: "parse_date edge cases" });
  expect(s.nodes[2]).toMatchObject({ state: "working", model: "sonnet" });
  expect(s.stageAt[4]).not.toBeNull();
});

it("a forced wait puts the waiting text on the you node", () => {
  startSim(1);
  simKey("w");
  const you = [...store.sessions.values()][0].nodes.find((n) => n.key === "you");
  expect(you).toMatchObject({ state: "waiting", waiting: "Waiting on you · approve plan (3 tasks)" });
});

it("forced idle clears builders; pauseSim freezes the simulation", () => {
  startSim(1);
  simKey("i");
  pauseSim();
  const s = [...store.sessions.values()][0];
  const before = JSON.stringify([s.stage, s.status, s.builders, s.nodes]);
  expect(s.status).toBe("idle");
  expect(s.builders).toEqual(["idle", "idle", "idle"]);
  vi.advanceTimersByTime(120_000);
  expect(JSON.stringify([s.stage, s.status, s.builders, s.nodes])).toBe(before);
});
