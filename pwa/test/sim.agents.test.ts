import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionZ } from "@fo/shared/wire";
import { agentView } from "../src/agents";
import { startAgents, stopSim } from "../src/sim";
import { store, ui, view } from "../src/state";
import { clearStaleSel } from "../src/ui/agents";
import { T0, reset } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); });
afterEach(() => stopSim());
const strip = ({ order: _o, seen: _s, washAt: _w, ...rest }: Record<string, unknown>) => ({ ...rest, log: (rest.log as unknown[]).slice(-6) });
const valid = () => { for (const s of store.sessions.values()) SessionZ.parse(strip(s as unknown as Record<string, unknown>)); };

for (const code of ["a", "b", "c", "d", "e", "f"])
  it(`?agents=${code} seeds wire-valid sessions in agents mode and stays valid while it runs`, () => {
    startAgents(code);
    expect(store.sessions.size).toBeGreaterThan(0);
    for (const s of store.sessions.values()) expect(Array.isArray(s.agents)).toBe(true);
    valid();
    vi.advanceTimersByTime(10_000);
    valid();
  });

it("c: executor 2 fails on Sonnet, then one lineage walks sonnet → opus", () => {
  startAgents("c");
  vi.advanceTimersByTime(4000);
  const v = agentView(store.sessions.get("flowobserve")!, Date.now())!;
  expect(v.byId.get("c2")!.chain.map((a) => a.model)).toEqual(["sonnet", "opus"]);
  expect(v.order).toHaveLength(3);
  expect(store.sessions.get("flowobserve")!.stage).toBe(4);
});

it("e: opens zoomed out on five projects, with a haiku explorer", () => {
  startAgents("e");
  expect(view.zt).toBe(0);
  expect([...store.sessions.keys()]).toEqual(["flowobserve", "atlas", "dryas", "harbor", "meadow"]);
  expect(store.sessions.get("meadow")!.agents![0].model).toBe("haiku");
});

it("f: replay spawns everything, then every agent wakes into work", () => {
  startAgents("f", true);
  expect(agentView(store.sessions.get("flowobserve")!, Date.now())!.order).toHaveLength(0);
  vi.advanceTimersByTime(8000);
  const v = agentView(store.sessions.get("flowobserve")!, Date.now())!;
  expect(v.order).toHaveLength(12);
  expect(v.counts.working).toBe(12);
});

it("?pick pins the scenario's agent; the pin outlives the 60 s clear", () => {
  startAgents("b", false, true);
  vi.advanceTimersByTime(2500);
  expect(ui.agentSel).toMatchObject({ sid: "flowobserve", aid: "b4" });
  vi.advanceTimersByTime(120_000);
  clearStaleSel(Date.now());
  expect(ui.agentSel).not.toBeNull();
});

it("an unknown code falls back to the normal demo (builders path)", () => {
  startAgents("z");
  expect(store.sessions.size).toBe(4);
  expect([...store.sessions.values()].every((s) => s.agents === undefined)).toBe(true);
});

it("demo executors carry plan task ids so the loop draws lanes", () => {
  startAgents("b");
  const s = [...store.sessions.values()].find((x) => x.agents?.some((a) => a.type === "executor"))!;
  expect(s.agents!.filter((a) => a.type === "executor").every((a) => typeof a.taskId === "string")).toBe(true);
  expect(s.tasksTotal).toBeGreaterThanOrEqual(s.agents!.filter((a) => a.type === "executor").length);
});
