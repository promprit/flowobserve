import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { Tailer } from "../src/tailer";
import { TranscriptTailer } from "../src/transcript";
import { at, mk, tline } from "./helpers";

function boot(dbFile: string, spool: string) {
  const store = new Store(dbFile);
  const engine = new Engine(store, () => at(100));
  engine.load();
  const tailer = new Tailer(store, [{ dir: spool, match: /^\d{4}-\d{2}-\d{2}\.jsonl$/, onLine: (_f, l) => engine.ingestSpool(l) }]);
  return { store, engine, tailer };
}

describe("restart", () => {
  it("restart resumes from offset without duplicates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fo-rs-"));
    const spool = path.join(root, "spool");
    fs.mkdirSync(spool);
    const db = path.join(root, "fo.db");
    const file = path.join(spool, "2026-10-03.jsonl");
    const a = mk();
    fs.writeFileSync(file, [a.pre(1, "Skill", { skill: "writing-plans" }), a.usage(2, 10, 5, 1)].join("\n") + "\n" + a.stop(3).slice(0, 20));

    const one = boot(db, spool);
    one.tailer.pollOnce();
    expect(one.engine.sessions.get("s1")).toMatchObject({ stage: 1, status: "active" });

    // "crash": finish the half line, start a fresh process on the same files
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").slice(0, -20) + a.stop(3) + "\n");
    const two = boot(db, spool);
    expect(two.engine.sessions.get("s1")).toMatchObject({ stage: 1 });
    two.tailer.pollOnce();
    two.tailer.pollOnce();

    expect(two.engine.sessions.get("s1")).toMatchObject({ stage: 1, status: "waiting" });
    expect(two.store.spendSince(0)).toHaveLength(0); // statusline cost no longer writes spend rows
    const causes = two.store.transitionsFrom(0).map((t) => t.cause);
    expect(causes.filter((c) => c === "skill:writing-plans")).toHaveLength(1);
    expect(causes.filter((c) => c === "await:stop")).toHaveLength(1);
  });

  it("a session saved without log loads with log: []", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fo-rs-"));
    const db = path.join(root, "fo.db");
    const one = boot(db, root);
    one.engine.ingestSpool(mk().pre(1, "Skill", { skill: "writing-plans" }));
    const saved = { ...one.engine.sessions.get("s1")! } as Record<string, unknown>;
    delete saved.log;
    one.store.saveSession(saved as never);
    const two = boot(db, root);
    expect(two.engine.sessions.get("s1")!.log).toEqual([]);
  });

  it("transcript spend is not double counted after restart", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-rs-")));
    const spool = path.join(root, "spool"), proj = path.join(root, "projects", "-p");
    fs.mkdirSync(spool); fs.mkdirSync(proj, { recursive: true });
    const tp = path.join(proj, "s1.jsonl");
    fs.writeFileSync(tp, [tline("m1", 1), tline("m2", 2), tline("m3", 3)].join("\n") + "\n");
    const db = path.join(root, "fo.db");
    const run = () => {
      const b = boot(db, spool);
      const t = new TranscriptTailer(path.join(root, "projects"), (items) => b.engine.onTranscripts(items));
      b.engine.transcripts = t;
      b.engine.ingestSpool(mk().line("UserPromptSubmit", 1, { prompt: "go", transcript_path: tp }));
      t.poll();
      return { ...b, t };
    };
    const one = run();
    const first = one.store.spendSince(0);
    expect(first).toHaveLength(3);
    const two = run(); // fresh process: new Engine + new TranscriptTailer, same DB and file
    expect(two.store.spendSince(0)).toHaveLength(3);
    two.t.forget("s1"); // session re-watched
    two.engine.ingestSpool(mk().line("UserPromptSubmit", 2, { prompt: "go", transcript_path: tp }));
    two.t.poll();
    const rows = two.store.spendSince(0);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((a, r) => a + r.usd, 0)).toBeCloseTo(first.reduce((a, r) => a + r.usd, 0), 10);
  });
});
