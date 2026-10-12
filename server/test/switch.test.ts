import { describe, expect, it } from "vitest";
import type { Account } from "../src/accounts";
import { switchAtFrom } from "../src/config";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { switchHint, type SwitchRow } from "../src/switch";
import { at, mk } from "./helpers";

const NOW = at(10_000), MIN = 60_000, H = 3_600_000;
const r = (label: string, used: number | null, ago: number | null = 0): SwitchRow => ({ label, used, at: ago === null ? null : NOW - ago });

describe("switchHint", () => {
  it("nothing at the threshold: no hint", () => expect(switchHint([r("Team", 0.89), r("Pro", 0.1)], NOW, 0.9)).toBeNull());
  it("from = fresh reading at or over the threshold; to = lowest fresh account under it", () => {
    expect(switchHint([r("Team", 0.92), r("Pro", 0.4), r("Lab", 0.2)], NOW, 0.9)).toEqual({ from: "Team", to: "Lab", used: 0.92 });
    expect(switchHint([r("Team", 0.9), r("Pro", 0.4)], NOW, 0.9)).toEqual({ from: "Team", to: "Pro", used: 0.9 });
  });
  it("a from reading 10 minutes old or older does not count", () => {
    expect(switchHint([r("Team", 0.95, 10 * MIN), r("Pro", 0.1)], NOW, 0.9)).toBeNull();
    expect(switchHint([r("Team", 0.95, 10 * MIN - 1), r("Pro", 0.1)], NOW, 0.9)).not.toBeNull();
  });
  it("several accounts over: the highest is from", () => {
    expect(switchHint([r("Team", 0.91), r("Pro", 0.97), r("Lab", 0.3)], NOW, 0.9)).toEqual({ from: "Pro", to: "Lab", used: 0.97 });
  });
  it("no account to move to: null", () => expect(switchHint([r("Team", 0.95), r("Pro", 0.93)], NOW, 0.9)).toBeNull());
  it("never reported, or a reading 6 h old or older, is unknown and offered last", () => {
    expect(switchHint([r("Team", 0.95), r("Pro", null, null)], NOW, 0.9)).toEqual({ from: "Team", to: "Pro", used: 0.95 });
    expect(switchHint([r("Team", 0.95), r("Pro", null, null), r("Lab", 0.6)], NOW, 0.9)!.to).toBe("Lab");
    expect(switchHint([r("Team", 0.95), r("Pro", 0.2, 6 * H), r("Lab", 0.6, 6 * H - 1)], NOW, 0.9)!.to).toBe("Lab");
    expect(switchHint([r("Team", 0.95), r("Pro", 0.95, 6 * H)], NOW, 0.9)!.to).toBe("Pro");
  });
  it("threshold 1 turns the hint off", () => expect(switchHint([r("Team", 1), r("Pro", 0)], NOW, 1)).toBeNull());
});

describe("switchAtFrom", () => {
  it("FO_SWITCH_AT in (0, 1], else 0.9", () => {
    expect(switchAtFrom("0.8")).toBe(0.8);
    expect(switchAtFrom("1")).toBe(1);
    for (const v of [undefined, "", "0", "-1", "1.5", "90", "x"]) expect(switchAtFrom(v)).toBe(0.9);
  });
});

describe("Engine switch hint", () => {
  const TEAM: Account = { dir: "~/.claude", label: "Team", dryas: true };
  const PRO: Account = { dir: "~/.claude-personal", label: "Pro", dryas: false };
  const tag = (l: string, a: string) => JSON.stringify({ ...JSON.parse(l), acct: a });
  const setup = (accounts: Account[]) => { const e = new Engine(new Store(":memory:"), () => at(120)); e.setAccounts(accounts); return e; };

  it("Team at 92 % and Pro calm: Team → Pro; near only on Team; the hint sets no card to waiting", () => {
    const e = setup([TEAM, PRO]);
    e.ingestSpool(mk("t1").usage(100, 92, 40, null));
    e.ingestSpool(tag(mk("p1").usage(101, 10, 5, null), PRO.dir));
    const u = e.usageWire()!;
    expect(u.switch).toEqual({ from: "Team", to: "Pro", used: 0.92 });
    expect(u.accounts!.map((a) => [a.label, a.near, a.primary ?? false])).toEqual([["Team", true, true], ["Pro", false, false]]);
    expect(e.snapshot().sessions.every((s) => s.status !== "waiting")).toBe(true);
  });
  it("Pro never reported is still offered", () => {
    const e = setup([TEAM, PRO]);
    e.ingestSpool(mk("t1").usage(100, 95, 40, null));
    expect(e.usageWire()!.switch).toEqual({ from: "Team", to: "Pro", used: 0.95 });
  });
  it("FO_SWITCH_AT=1: switch null and nothing near", () => {
    const e = setup([TEAM, PRO]);
    e.switchAt = 1;
    e.ingestSpool(mk("t1").usage(100, 100, 40, null));
    const u = e.usageWire()!;
    expect(u.switch).toBeNull();
    expect(u.accounts![0].near).toBe(false);
  });
  it("one account: no switch key", () => {
    const e = setup([TEAM]);
    e.ingestSpool(mk("t1").usage(100, 99, 40, null));
    expect("switch" in e.usageWire()!).toBe(false);
  });
});
