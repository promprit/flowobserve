import { describe, expect, it } from "vitest";
import { toWire } from "@fo/shared";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { ev, run } from "./events";
import { at } from "./helpers";

describe("RC takeover (spec §7)", () => {
  it("takeover sets rc; a later bridge clears it", () => {
    const a = run([ev(1, "Prompt", {}), ev(5, "Rc", { takenOverAt: at(5) })]);
    expect(a.s.rc).toEqual({ takenOverAt: at(5) });
    expect(toWire(a.s).rc).toEqual({ takenOverAt: at(5) });
    const b = run([ev(1, "Prompt", {}), ev(5, "Rc", { takenOverAt: at(5) }), ev(9, "Rc", { takenOverAt: null })]);
    expect(b.s.rc).toBeNull();
    expect(toWire(b.s).rc).toBeNull();
  });
  it("SessionEnd clears it", () => {
    expect(run([ev(1, "Prompt", {}), ev(5, "Rc", { takenOverAt: at(5) }), ev(6, "End", {})]).s.rc).toBeNull();
  });
  it("is passive: lastEventAt does not move", () => {
    expect(run([ev(1, "Prompt", {}), ev(500, "Rc", { takenOverAt: at(500) })]).s.lastEventAt).toBe(at(1));
  });
});

describe("Engine.onRc", () => {
  const line = (ts: string) => JSON.stringify({ v: 1, ts, src: "hook", sid: "s1", cwd: "/p/app", event: "UserPromptSubmit", payload: {}, truncated: false });
  it("bridge with no alarm is a no-op; takeover then bridge sets and clears; unknown sid ignored", () => {
    const t = Date.parse("2026-10-07T05:00:00Z");
    const e = new Engine(new Store(":memory:"), () => t);
    e.ingestSpool(line("2026-10-07T05:00:00Z"));
    const before = JSON.stringify(e.sessions.get("s1"));
    e.onRc("s1", { kind: "bridge" });
    expect(JSON.stringify(e.sessions.get("s1"))).toBe(before);
    e.onRc("s1", { kind: "takeover", ts: t + 1000 });
    expect(e.sessions.get("s1")!.rc).toEqual({ takenOverAt: t + 1000 });
    e.onRc("s1", { kind: "bridge" });
    expect(e.sessions.get("s1")!.rc).toBeNull();
    expect(() => e.onRc("nobody", { kind: "takeover", ts: t })).not.toThrow();
  });
});

describe("Engine.onRc after End", () => {
  const line = (ts: string, event: string) => JSON.stringify({ v: 1, ts, src: "hook", sid: "s1", cwd: "/p/app", event, payload: {}, truncated: false });
  it("a takeover mark after End leaves rc null", () => {
    const t = Date.parse("2026-10-07T05:00:00Z");
    const e = new Engine(new Store(":memory:"), () => t);
    e.ingestSpool(line("2026-10-07T05:00:00Z", "UserPromptSubmit"));
    e.ingestSpool(line("2026-10-07T05:00:01Z", "SessionEnd"));
    e.onRc("s1", { kind: "takeover", ts: t + 2000 });
    expect(e.sessions.get("s1")?.rc ?? null).toBeNull();
  });
});
