import { describe, expect, it } from "vitest";
import { MsgZ } from "@fo/shared";
import type { Account } from "../src/accounts";
import { usageFromStore } from "../src/accountusage";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const TEAM: Account = { dir: "~/.claude", label: "Team", dryas: true };
const PRO: Account = { dir: "~/.claude-personal", label: "Pro", dryas: false };
const tag = (line: string, acct: string) => JSON.stringify({ ...JSON.parse(line), acct });
const team = mk("t1"), pro = mk("p1", "/Users/p/projects/web");
const proUsage = (sec: number, pct5: number, pct7 = 10) => tag(pro.usage(sec, pct5, pct7, null), PRO.dir);
const reading = (pct5: number, sec: number) => ({ fiveHour: { pct: pct5, resetsAt: at(9000) }, sevenDay: { pct: 7, resetsAt: at(99000) }, fable: null, at: at(sec) });

function setup(accounts: Account[] = [TEAM, PRO], store = new Store(":memory:")) {
  const e = new Engine(store, () => at(60));
  e.setAccounts(accounts);
  return { store, e };
}

describe("usage per account", () => {
  it("interleaved readings never mix: one row per account, top level = default account", () => {
    const { e } = setup();
    e.ingestSpool(team.usage(30, 50, 25, null));
    e.ingestSpool(proUsage(31, 10, 5));
    e.ingestSpool(team.usage(32, 60, 26, null));
    e.ingestSpool(proUsage(33, 12, 6));
    const u = e.usageWire()!;
    expect(MsgZ.parse({ type: "usage", usage: u })).toBeTruthy();
    expect([u.session.used, u.weekly.used, u.at]).toEqual([0.6, 0.26, at(32)]);
    expect(u.accounts!.map((a) => [a.label, a.session.used, a.weekly.used, a.at, a.primary ?? false])).toEqual([
      ["Team", 0.6, 0.26, at(32), true], ["Pro", 0.12, 0.06, at(33), false]]);
  });

  it("the older-reading rule applies per account", () => {
    const { e } = setup();
    e.ingestSpool(proUsage(40, 30));
    e.ingestSpool(proUsage(35, 90));
    e.ingestSpool(team.usage(20, 70, 20, null));
    expect(e.usageWire()!.accounts!.map((a) => a.session.used)).toEqual([0.7, 0.3]);
  });

  it("the usage cache (setUsage without acct) feeds the default account only, fable included", () => {
    const { e } = setup();
    e.ingestSpool(proUsage(30, 10));
    e.setUsage({ ...reading(70, 40), fable: { pct: 31, resetsAt: at(50000) } });
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.7);
    expect(u.fable).toEqual({ used: 0.31, resetsAt: at(50000) });
    expect(u.accounts!.find((a) => a.label === "Pro")!.session.used).toBe(0.1);
  });

  it("an account without a reading has no row yet; only the default when Pro is first to report is not primary", () => {
    const { e } = setup();
    e.ingestSpool(proUsage(30, 10));
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.1);
    expect(u.accounts!.map((a) => [a.label, a.primary ?? false])).toEqual([["Pro", true]]);
  });

  it("one account: no accounts list on the wire", () => {
    const { e } = setup([TEAM]);
    e.ingestSpool(team.usage(30, 50, 25, null));
    expect("accounts" in e.usageWire()!).toBe(false);
  });

  it("persists the map and reloads it", () => {
    const { store, e } = setup();
    e.ingestSpool(team.usage(30, 50, 25, null));
    e.ingestSpool(proUsage(31, 10, 5));
    expect(Object.keys(JSON.parse(store.kvGet("usage")!))).toEqual(["~/.claude", "~/.claude-personal"]);
    const e2 = setup([TEAM, PRO], store).e;
    e2.load();
    expect(e2.usageWire()!.accounts!.map((a) => a.session.used)).toEqual([0.5, 0.1]);
  });

  it("an old single persisted value loads as the default account's", () => {
    const store = new Store(":memory:");
    store.kvSet("usage", JSON.stringify(reading(42, 1)));
    const { e } = setup([TEAM, PRO], store);
    e.load();
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.42);
    expect(u.accounts!.map((a) => a.label)).toEqual(["Team"]);
  });
});

describe("usageFromStore", () => {
  it("drops corrupt values and entries that are not readings", () => {
    expect(usageFromStore(null).size).toBe(0);
    expect(usageFromStore("{bad").size).toBe(0);
    const m = usageFromStore(JSON.stringify({ "~/.claude": reading(1, 1), "relative": reading(2, 2), "~/.x": { fiveHour: 1 } }));
    expect([...m.keys()]).toEqual(["~/.claude"]);
  });
});
