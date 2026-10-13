import { describe, expect, it } from "vitest";
import { MsgZ, UsageZ } from "@fo/shared";
import type { Account } from "../src/accounts";
import { usageFromStore } from "../src/accountusage";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const TEAM: Account = { dir: "~/.claude", label: "Team", dryas: true };
const PRO: Account = { dir: "~/.claude-personal", label: "Pro", dryas: false };
const tag = (line: string, acct: string) => JSON.stringify({ ...JSON.parse(line), acct });
const team = mk("t1"), pro = mk("p1", "/Users/p/projects/web");
const proUsage = (sec: number, pct5: number, pct7: number | null = 10) => tag(pro.usage(sec, pct5, pct7, null), PRO.dir);
const reading = (pct5: number, sec: number) => ({ fiveHour: { pct: pct5, resetsAt: at(9000) }, sevenDay: { pct: 7, resetsAt: at(99000) }, fable: null, at: at(sec) });

function setup(accounts: Account[] = [TEAM, PRO], store = new Store(":memory:")) {
  const e = new Engine(store, () => at(60));
  e.setAccounts(accounts);
  return { store, e };
}

describe("weekly limit awareness", () => {
  it("api usage weekly is 0 after its reset", () => {
    const { e } = setup();
    e.setUsage({ ...reading(10, 31), sevenDay: { pct: 80, resetsAt: at(30) } }, TEAM.dir);
    expect(e.usageApi().accounts.find((a) => a.label === "Team")!.sevenDay).toBe(0);
  });

  it("a primary near only on weekly is near and hints a switch to the other account", () => {
    const { e } = setup();
    e.setUsage({ ...reading(10, 55), sevenDay: { pct: 95, resetsAt: at(99000) } }, TEAM.dir);
    e.setUsage(reading(5, 56), PRO.dir);
    const u = e.usageWire()!;
    expect(u.accounts!.find((a) => a.label === "Team")!.near).toBe(true);
    expect(u.switch).toEqual({ from: "Team", to: "Pro", used: 0.95 });
  });
});

describe("usage per account", () => {
  it("interleaved readings never mix: one row per account, top level = default account", () => {
    const { e } = setup();
    e.ingestSpool(team.usage(30, 50, 25, null));
    e.ingestSpool(proUsage(31, 10, 5));
    e.ingestSpool(team.usage(32, 60, 26, null));
    e.ingestSpool(proUsage(33, 12, 6));
    const u = e.usageWire()!;
    expect(MsgZ.parse({ type: "usage", usage: u })).toBeTruthy();
    expect([u.session.used, u.weekly!.used, u.at]).toEqual([0.6, 0.26, at(32)]);
    expect(u.accounts!.map((a) => [a.label, a.session.used, a.weekly!.used, a.at, a.primary ?? false])).toEqual([
      ["Team", 0.6, 0.26, at(32), true], ["Pro", 0.12, 0.06, at(33), false]]);
  });

  it("primary follows accounts.json order, not ~/.claude", () => {
    const TEAM2: Account = { dir: "~/.claude-team", label: "Team2", dryas: true };
    const CL: Account = { dir: "~/.claude", label: "Claude", dryas: true };
    const { e } = setup([TEAM2, CL]);
    e.ingestSpool(tag(mk("a1").usage(30, 40, 20, null), TEAM2.dir));
    e.ingestSpool(mk("c1").usage(31, 10, 5, null));
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.4);
    expect(u.accounts!.map((a) => [a.label, a.primary ?? false])).toEqual([["Team2", true], ["Claude", false]]);
  });

  it("each row carries its own account's Fable; the top level stays the primary's", () => {
    const CL: Account = { dir: "~/.claude", label: "Claude", dryas: true };
    const { e } = setup([PRO, CL]);
    e.ingestSpool(proUsage(30, 40));
    e.setUsage({ ...reading(10, 31), fable: { pct: 30, resetsAt: at(99000) } }, CL.dir);
    const u = e.usageWire()!;
    expect(u.accounts!.map((a) => [a.label, a.primary ?? false, a.fable ?? null])).toEqual([
      ["Pro", true, null], ["Claude", false, { used: 0.3, resetsAt: at(99000) }]]);
    expect(u.fable ?? null).toBeNull();
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

  it("when only Pro has reported, it is the primary row and the top level shows its reading", () => {
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

describe("single default account with CLAUDE_CONFIG_DIR set (no accounts.json)", () => {
  const XDG = "~/.config/claude";
  const line = (sec: number, pct5: number) => tag(team.usage(sec, pct5, 25, null), XDG);

  it("top-level usage shows the latest reading even though its acct is not listed", () => {
    const { e } = setup([]);
    e.ingestSpool(line(30, 50));
    e.ingestSpool(line(32, 60));
    const u = e.usageWire()!;
    expect([u.session.used, u.at]).toEqual([0.6, at(32)]);
    expect("accounts" in u).toBe(false);
  });

  it("blocked() uses that reading's window", () => {
    const { e } = setup([]);
    e.ingestSpool(line(30, 50));
    const win = e.usageWire()!.session.startedAt;
    const seen: number[] = [];
    const orig = e["store"].transitionsFrom.bind(e["store"]);
    e["store"].transitionsFrom = (t: number) => (seen.push(t), orig(t));
    e.metricsMsg();
    expect(seen).toContain(win);
  });
});

describe("usageFromStore", () => {
  it("drops corrupt values and entries that are not readings", () => {
    expect(usageFromStore(null).size).toBe(0);
    expect(usageFromStore("{bad").size).toBe(0);
    const m = usageFromStore(JSON.stringify({ "~/.claude": reading(1, 1), "relative": reading(2, 2), "~/.x": { fiveHour: 1 } }));
    expect([...m.keys()]).toEqual(["~/.claude"]);
  });

  it("loads an entry whose sevenDay is null or missing as null", () => {
    const r = reading(3, 3);
    const m = usageFromStore(JSON.stringify({
      "~/.claude": { ...r, sevenDay: null },
      "~/.x": (({ sevenDay: _s, ...rest }) => rest)(r),
    }));
    expect([...m.keys()]).toEqual(["~/.claude", "~/.x"]);
    expect(m.get("~/.claude")!.sevenDay).toBeNull();
    expect(m.get("~/.x")!.sevenDay).toBeNull();
  });
});

describe("a reading with only five_hour", () => {
  it("a reading with only five_hour on a second account appears in /api/usage with sevenDay null", () => {
    const { e } = setup();
    e.ingestSpool(team.usage(30, 50, 25, null));
    e.ingestSpool(proUsage(31, 12, null));
    const api = e.usageApi().accounts.find((a) => a.label === "Pro")!;
    expect(typeof api.fiveHour).toBe("number");
    expect(api.sevenDay).toBeNull();
    const row = e.usageWire()!.accounts!.find((a) => a.label === "Pro")!;
    expect(row.session.used).toBe(0.12);
    expect(row.weekly).toBeNull();
  });

  it("a five_hour-only reading after a full one sets weekly null", () => {
    const { e } = setup();
    e.ingestSpool(proUsage(30, 10, 40));
    e.ingestSpool(proUsage(31, 12, null));
    const pro = () => e.usageWire()!.accounts!.find((a) => a.label === "Pro")!;
    expect(pro().session.used).toBe(0.12);
    expect(pro().weekly).toBeNull();
    expect(e.usageApi().accounts.find((a) => a.label === "Pro")!.sevenDay).toBeNull();
  });

  it("a five_hour-only reading survives persist and reload", () => {
    const { store, e } = setup();
    e.ingestSpool(team.usage(30, 50, 25, null));
    e.ingestSpool(proUsage(31, 12, null));
    const e2 = setup([TEAM, PRO], store).e;
    e2.load();
    const row = e2.usageWire()!.accounts!.find((a) => a.label === "Pro")!;
    expect(row.session.used).toBe(0.12);
    expect(row.weekly).toBeNull();
    expect(e2.usageApi().accounts.find((a) => a.label === "Pro")!.sevenDay).toBeNull();
  });

  it("one account, five_hour only: top-level usage weekly is null and the message parses", () => {
    const { e } = setup([TEAM]);
    e.ingestSpool(team.usage(30, 50, null, null));
    const u = e.usageWire()!;
    expect(u.weekly).toBeNull();
    expect(typeof u.session.used).toBe("number");
    expect(UsageZ.parse(u)).toBeTruthy();
    expect(MsgZ.parse({ type: "usage", usage: u })).toBeTruthy();
  });
});
