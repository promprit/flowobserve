import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { Tailer, backfillJevSeen } from "../src/tailer";
import { at } from "./helpers";

/** One Jev spend line; n makes it unique. */
const line = (n: number, cost = 0.01) => JSON.stringify({ ts: "2026-10-03T10:00:" + String(n).padStart(2, "0") + "+0700", cost, session_id: "s" + n, tool: "Bash" }) + "\n";
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-jd-")));

function world() {
  const h = tmp(), legacy = path.join(h, ".claude", "jev", "logs"), shared = path.join(h, ".dryas", "jev", "logs"), spool = path.join(h, "spool");
  for (const d of [legacy, shared, spool]) fs.mkdirSync(d, { recursive: true });
  const db = path.join(h, "fo.db");
  /** One server run: new Engine on the same db, backfill, then one poll of the given dirs. */
  const run = (dirs: string[]) => {
    const store = new Store(db), e = new Engine(store, () => at(60));
    backfillJevSeen(store, [spool], dirs.includes(shared) ? shared : null);
    new Tailer(store, dirs.map((dir) => ({ dir, match: /\.jsonl$/, onLine: (f: string, l: string) => e.ingestJev(path.basename(f, ".jsonl"), l) }))).pollOnce();
    const n = store.spendSince(0).length;
    store.db.close();
    return n;
  };
  /** A server from before this change: reads the legacy dir and stores spend without line keys or a backfill mark. */
  const oldRun = () => {
    const store = new Store(db);
    new Tailer(store, [{ dir: legacy, match: /\.jsonl$/, onLine: () => store.insert({ transitions: [], calls: [], cycles: [], escalations: [], spend: [{ ts: at(1), sid: null, project: "p", model: "jev", source: "jev", usd: 0.01 }] }) }]).pollOnce();
    const n = store.spendSince(0).length;
    store.db.close();
    return n;
  };
  return { legacy, shared, run, oldRun };
}

describe("Jev lines are counted once across ~/.claude/jev/logs and ~/.dryas/jev/logs", () => {
  it("upgrade after Dryas migrated (logs copied, another account appended): only new lines count", () => {
    const w = world();
    fs.writeFileSync(path.join(w.legacy, "gate.jsonl"), line(1) + line(2));
    expect(w.oldRun()).toBe(2); // the old server read the legacy dir
    fs.writeFileSync(path.join(w.shared, "gate.jsonl"), line(1) + line(2) + line(3)); // migration copy + team account
    expect(w.run([w.shared])).toBe(3);
    expect(w.run([w.shared, w.legacy])).toBe(3); // tailing both is safe
  });
  it("another account's logs reached ~/.dryas first, then ~/.claude's were appended", () => {
    const w = world();
    fs.writeFileSync(path.join(w.legacy, "gate.jsonl"), line(1) + line(2));
    w.oldRun();
    fs.writeFileSync(path.join(w.shared, "gate.jsonl"), line(7) + line(1) + line(2));
    expect(w.run([w.shared])).toBe(3);
  });
  it("legacy log already deleted at upgrade: its offset carries to the shared file of the same name", () => {
    const w = world();
    fs.writeFileSync(path.join(w.legacy, "gate.jsonl"), line(1) + line(2));
    w.oldRun();
    fs.renameSync(path.join(w.legacy, "gate.jsonl"), path.join(w.shared, "gate.jsonl"));
    fs.appendFileSync(path.join(w.shared, "gate.jsonl"), line(3));
    expect(w.run([w.shared])).toBe(3);
  });
  it("mixed state: a copy install still writes legacy while the plugin writes shared; each line once", () => {
    const w = world();
    w.run([w.shared, w.legacy]);
    fs.writeFileSync(path.join(w.legacy, "gate.jsonl"), line(1));
    fs.writeFileSync(path.join(w.shared, "gate.jsonl"), line(2));
    expect(w.run([w.shared, w.legacy])).toBe(2);
    fs.appendFileSync(path.join(w.shared, "gate.jsonl"), line(1)); // Dryas migrates the legacy log by appending
    fs.appendFileSync(path.join(w.legacy, "gate.jsonl"), line(3));
    expect(w.run([w.shared, w.legacy])).toBe(3);
  });
  it("a truncated and rewritten log is re-read without double counting", () => {
    const w = world();
    const f = path.join(w.shared, "calls.jsonl");
    fs.writeFileSync(f, line(1) + line(2) + line(3));
    expect(w.run([w.shared])).toBe(3);
    fs.writeFileSync(f, line(3) + line(4)); // smaller than the stored offset: read again from 0
    expect(w.run([w.shared])).toBe(4);
  });
});

describe("Jev lines older than the dedupe horizon", () => {
  it("are skipped, so a re-read after the keys were pruned cannot count them twice", () => {
    const store = new Store(":memory:");
    const now = Date.parse("2026-12-20T00:00:00Z");
    const e = new Engine(store, () => now);
    const old = JSON.stringify({ ts: "2026-11-01T10:00:00+0700", cost: 0.5, session_id: "o" });
    const fresh = JSON.stringify({ ts: "2026-12-19T10:00:00+0700", cost: 0.5, session_id: "f" });
    e.ingestJev("gate", old);
    e.ingestJev("gate", fresh);
    store.jevSeenPrune(now); // every key gone
    e.ingestJev("gate", old);
    expect(store.spendSince(0).map((r) => r.sid ?? r.project).length).toBe(1);
  });
});
