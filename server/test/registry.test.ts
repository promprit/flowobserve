import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "@fo/shared";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { readRegistry } from "../src/registry";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "fo-reg-"));

describe("readRegistry", () => {
  it("keeps only pid, sessionId and kind; skips bad and .key files; missing dir = null", () => {
    const d = dir();
    fs.writeFileSync(path.join(d, "1.json"), JSON.stringify({ pid: 11, sessionId: "a", kind: "bg", cwd: "/secret", name: "x" }));
    fs.writeFileSync(path.join(d, "2.json"), "{nope");
    fs.writeFileSync(path.join(d, "3.json"), JSON.stringify({ pid: "x", sessionId: "c" }));
    fs.writeFileSync(path.join(d, "4.key"), JSON.stringify({ pid: 1, sessionId: "k", kind: "k" }));
    const r = readRegistry(d)!;
    expect([...r.keys()]).toEqual(["a"]);
    expect(r.get("a")).toEqual({ pid: 11, sessionId: "a", kind: "bg" });
    expect(readRegistry(path.join(d, "missing"))).toBeNull();
  });
});

function setup() {
  const clock = { t: at(10) };
  const e = new Engine(new Store(":memory:"), () => clock.t);
  const wire: Session[] = [];
  e.out = { session: (s) => wire.push(s) };
  e.ingestSpool(mk().pre(1, "Skill", { skill: "writing-plans" }));
  return { e, clock, wire };
}
const live = (e: Engine) => e.liveIds().map((x) => x.id);

describe("Engine.onRegistry", () => {
  it("no registry dir: nothing ends", () => {
    const { e, clock } = setup();
    e.onRegistry(null, () => false);
    clock.t += 60_000;
    e.onRegistry(null, () => false);
    expect(live(e)).toEqual(["s1"]);
  });

  it("a session never seen in the registry survives", () => {
    const { e, clock } = setup();
    e.onRegistry(new Map(), () => true);
    clock.t += 60_000;
    e.onRegistry(new Map(), () => true);
    e.onRegistry(new Map([["other", { pid: 1, kind: "" }]]), () => false);
    expect(live(e)).toEqual(["s1"]);
  });

  it("seen, then absent from the registry, ends only after the 10 s grace", () => {
    const { e, clock } = setup();
    e.onRegistry(new Map([["s1", { pid: 5, kind: "" }]]), () => true);
    e.onRegistry(new Map(), () => true);
    clock.t += 10_000;
    e.onRegistry(new Map(), () => true);
    expect(live(e)).toEqual(["s1"]);
    clock.t += 1;
    e.onRegistry(new Map(), () => true);
    expect(live(e)).toEqual([]);
  });

  it("seen with a dead pid ends after the grace; a pid that comes back resets it", () => {
    const { e, clock } = setup();
    const reg = new Map([["s1", { pid: 5, kind: "" }]]);
    e.onRegistry(reg, () => false);
    clock.t += 8_000;
    e.onRegistry(reg, () => true);
    clock.t += 8_000;
    e.onRegistry(reg, () => false);
    expect(live(e)).toEqual(["s1"]);
    clock.t += 11_000;
    e.onRegistry(reg, () => false);
    expect(live(e)).toEqual([]);
  });

  it("an alive session is untouched and a bg kind goes on the wire", () => {
    const { e, clock, wire } = setup();
    e.onRegistry(new Map([["s1", { pid: 5, kind: "bg" }]]), () => true);
    clock.t += 60_000;
    e.onRegistry(new Map([["s1", { pid: 5, kind: "bg" }]]), () => true);
    expect(live(e)).toEqual(["s1"]);
    expect(wire[wire.length - 1].kind).toBe("bg");
    expect(e.snapshot().sessions[0].kind).toBe("bg");
  });

  it("an interactive kind leaves kind off the wire", () => {
    const { e } = setup();
    e.onRegistry(new Map([["s1", { pid: 5, kind: "interactive" }]]), () => true);
    expect(e.snapshot().sessions[0].kind).toBeUndefined();
  });
});
