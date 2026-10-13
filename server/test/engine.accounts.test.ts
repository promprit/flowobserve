import { describe, expect, it } from "vitest";
import { MsgZ, type Session } from "@fo/shared";
import type { Account } from "../src/accounts";
import { Engine } from "../src/engine";
import { parseSpoolLine } from "../src/ingest";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const TEAM: Account = { dir: "~/.claude", label: "Team", dryas: true };
const PRO: Account = { dir: "~/.claude-personal", label: "Pro", dryas: false };
const tag = (line: string, acct: string) => JSON.stringify({ ...JSON.parse(line), acct });

function setup(accounts: Account[] = [TEAM, PRO]) {
  const store = new Store(":memory:");
  const e = new Engine(store, () => at(60));
  e.exists = () => false;
  e.setAccounts(accounts);
  const sent: Session[] = [];
  e.out = { session: (s) => sent.push(s) };
  return { store, e, sent };
}
const last = (sent: Session[], id: string) => sent.filter((s) => s.id === id).at(-1)!;

describe("parseSpoolLine acct", () => {
  it("reads acct in canonical form; a bad or missing value is left out", () => {
    expect(parseSpoolLine(tag(mk().prompt(1), "~/.claude-personal/"))!.acct).toBe("~/.claude-personal");
    expect(parseSpoolLine(tag(mk().prompt(1), "relative"))!.acct).toBeUndefined();
    expect("acct" in parseSpoolLine(mk().prompt(1))!).toBe(false);
  });
});

describe("Engine accounts", () => {
  it("one account: no account on the wire for sessions from that account", () => {
    const { e, sent } = setup([TEAM]);
    e.ingestSpool(tag(mk("p1").prompt(1), TEAM.dir));
    e.ingestSpool(mk("p2").prompt(2));
    expect("account" in last(sent, "p1")).toBe(false);
    expect("account" in last(sent, "p2")).toBe(false);
  });

  it("labels a session from a dir that is not the only board account", () => {
    const only: Account = { dir: "~/.claude-team", label: "Team", dryas: true };
    const { e, sent } = setup([only]);
    e.ingestSpool(tag(mk("o1").prompt(1), "~/.claude"));
    e.ingestSpool(tag(mk("t1").prompt(2), only.dir));
    expect(last(sent, "o1").account).toEqual({ label: "claude", dryas: false });
    expect(e.health().counts.unknownAccount).toBe(1);
    expect("account" in last(sent, "t1")).toBe(false);
  });

  it("two accounts: every card names its account; a line without acct is the default account", () => {
    const { e, sent } = setup();
    e.ingestSpool(mk("t1").prompt(1));
    e.ingestSpool(tag(mk("p1", "/Users/p/projects/web").prompt(2), PRO.dir));
    expect(last(sent, "t1").account).toEqual({ label: "Team", dryas: true });
    expect(last(sent, "p1").account).toEqual({ label: "Pro", dryas: false });
    expect(MsgZ.safeParse(e.snapshot()).success).toBe(true);
    expect(e.health().counts.unknownAccount).toBeUndefined();
  });

  it("the account is set by the first event and never changes", () => {
    const { e } = setup();
    e.ingestSpool(tag(mk("p1").prompt(1), PRO.dir));
    e.ingestSpool(tag(mk("p1").stop(2), TEAM.dir));
    expect(e.sessions.get("p1")!.acct).toBe(PRO.dir);
  });

  it("an untagged first line does not fix the account: the first tagged line does", () => {
    const { e, sent } = setup([TEAM, { dir: "~/.claude-work", label: "Work", dryas: false }]);
    e.ingestSpool(mk("w1").prompt(1));
    expect(e.sessions.get("w1")!.acct).toBeUndefined();
    expect(last(sent, "w1").account).toEqual({ label: "Team", dryas: true }); // readers read undefined as the default
    e.ingestSpool(tag(mk("w1").stop(2), "~/.claude-work"));
    expect(e.sessions.get("w1")!.acct).toBe("~/.claude-work");
    expect(last(sent, "w1").account).toEqual({ label: "Work", dryas: false });
  });

  it("an unknown account shows its basename, is counted once per session and never dropped", () => {
    const { e, sent } = setup();
    e.ingestSpool(tag(mk("x1").prompt(1), "~/.claude-lab"));
    e.ingestSpool(tag(mk("x1").stop(2), "~/.claude-lab"));
    expect(last(sent, "x1").account).toEqual({ label: "claude-lab", dryas: false });
    expect(e.health().counts.unknownAccount).toBe(1);
  });

  it("one account: a line naming that account bumps no counter", () => {
    const { e } = setup([TEAM]);
    e.ingestSpool(tag(mk("p1").prompt(1), TEAM.dir));
    expect(e.health().counts.unknownAccount).toBeUndefined();
  });

  it("a usage line is read under its own acct, whatever account the session was first seen under", () => {
    const { e } = setup();
    e.ingestSpool(mk("s1").prompt(1));
    e.ingestSpool(tag(mk("s1").usage(30, 10, 5, null), PRO.dir));
    const u = e.usageWire()!;
    expect(u.accounts!.find((a) => a.label === "Pro")!.session.used).toBe(0.1);
  });

  it("a session persisted without acct takes the account of the next line that carries one", () => {
    const { e } = setup();
    e.ingestSpool(mk("s1").prompt(1));
    delete e.sessions.get("s1")!.acct;
    e.ingestSpool(tag(mk("s1").stop(2), PRO.dir));
    expect(e.sessions.get("s1")!.acct).toBe(PRO.dir);
  });

  it("setAccounts re-sends live cards with or without their account", () => {
    const { e, sent } = setup([TEAM]);
    e.ingestSpool(mk("t1").prompt(1));
    e.setAccounts([TEAM, PRO]);
    expect(last(sent, "t1").account).toEqual({ label: "Team", dryas: true });
    e.setAccounts([TEAM]);
    expect("account" in last(sent, "t1")).toBe(false);
  });

  it("the account survives a restart", () => {
    const { store, e } = setup();
    e.ingestSpool(tag(mk("p1").prompt(1), PRO.dir));
    const e2 = new Engine(store, () => at(70));
    e2.setAccounts([TEAM, PRO]);
    e2.load();
    expect(e2.snapshot().sessions.find((s) => s.id === "p1")!.account).toEqual({ label: "Pro", dryas: false });
  });
});
