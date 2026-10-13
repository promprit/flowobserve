import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MsgZ, toPosix, type Session } from "@fo/shared";
import { Engine } from "../src/engine";
import { DAY_MS } from "../src/config";
import { projectName } from "../src/reducer";
import { clearWorktreeCache } from "../src/worktree";
import { Store } from "../src/store";
import { TranscriptTailer, parseTranscriptLine, type TMsg } from "../src/transcript";
import { at, jev, mk, tline } from "./helpers";

function setup(nowSec = 0) {
  const store = new Store(":memory:");
  const clock = { t: at(nowSec) };
  const e = new Engine(store, () => clock.t);
  const sent: Session[] = [];
  const snaps: number[] = [];
  e.out = { session: (s) => sent.push(s), snapshot: (m) => snaps.push(m.sessions.length) };
  return { store, clock, e, sent, snaps };
}

describe("Engine", () => {
  it("drives a session from spool lines and pushes wire sessions", () => {
    const { e, sent } = setup();
    const a = mk();
    for (const l of [a.start(0), a.pre(1, "Skill", { skill: "superpowers:writing-plans" }),
      a.post(2, "Write", { file_path: "/Users/p/projects/app/docs/superpowers/plans/p.md" }, { planTasks: 3 }), a.stop(3)]) e.ingestSpool(l);
    const last = sent[sent.length - 1];
    expect(MsgZ.parse({ type: "session", session: last })).toBeTruthy();
    expect(last).toMatchObject({ name: "app", stage: 1, status: "waiting", action: "APPROVE PLAN", tasksTotal: 3 });
  });

  it("drops a card after 24 h without events and brings it back on the next event", () => {
    const { e, clock, snaps } = setup();
    const a = mk();
    e.ingestSpool(a.prompt(0));
    e.flush(true);
    expect(e.snapshot().sessions).toHaveLength(1);
    clock.t = at(10) + DAY_MS;
    e.tick();
    expect(e.snapshot().sessions).toHaveLength(0);
    expect(snaps[snaps.length - 1]).toBe(0);
    clock.t = at(20) + DAY_MS;
    e.ingestSpool(a.prompt(20 + DAY_MS / 1000));
    expect(e.snapshot().sessions).toHaveLength(1);
  });

  it("counts malformed, unknown and sessionless lines without inventing sessions", () => {
    const { e } = setup();
    const a = mk();
    e.ingestSpool("{half");
    e.ingestSpool(a.line("BrandNewHook", 1));
    e.ingestSpool(JSON.stringify({ ...JSON.parse(a.stop(1)), sid: "" }));
    e.ingestSpool(JSON.stringify({ ...JSON.parse(a.stop(2)), truncated: true }));
    expect(e.counts).toMatchObject({ malformed: 1, "unknown:BrandNewHook": 1, nosid: 1, truncated: 1, "lines:spool": 4 });
    expect([...e.sessions.keys()]).toEqual(["s1"]);
  });

  it("keeps interleaved sessions independent", () => {
    const { e } = setup();
    const a = mk("s1", "/p/app"), b = mk("s2", "/p/web");
    for (const l of [a.pre(1, "Skill", { skill: "writing-plans" }), b.pre(2, "Skill", { skill: "wreview" }), a.stop(3)]) e.ingestSpool(l);
    expect(e.sessions.get("s1")).toMatchObject({ stage: 1, status: "waiting" });
    expect(e.sessions.get("s2")).toMatchObject({ stage: 5, status: "active" });
  });

  it("two chats in one folder both stay live; SessionEnd retires only its own", () => {
    const { e } = setup(60);
    e.ingestSpool(mk({ sid: "A" }).prompt(1));
    e.ingestSpool(mk({ sid: "B" }).prompt(2));
    expect(e.liveIds().map((x) => x.id).sort()).toEqual(["A", "B"]);
    e.ingestSpool(mk({ sid: "A" }).end(3));
    expect(e.liveIds().map((x) => x.id)).toEqual(["B"]);
  });

  it("a startup with nothing since is the extension's spare: hidden until its first prompt", () => {
    const { e } = setup(60);
    const spare = mk({ sid: "spare" }), real = mk({ sid: "real" });
    e.ingestSpool(spare.start(1));
    e.ingestSpool(real.start(2));
    e.ingestSpool(real.prompt(3));
    expect(e.liveIds().map((x) => x.id)).toEqual(["real"]);
    expect(e.snapshot().sessions.map((s) => s.id)).toEqual(["real"]);
    e.ingestSpool(spare.prompt(4));
    expect(e.liveIds().map((x) => x.id)).toEqual(["spare", "real"]);
  });

  it("a spare is never pushed; its first prompt pushes it once; a later startup does not re-hide it", () => {
    const { e, sent } = setup(60);
    const spare = mk({ sid: "spare" });
    e.ingestSpool(spare.start(1));
    expect(sent.filter((s) => s.id === "spare")).toHaveLength(0);
    e.ingestSpool(spare.prompt(2));
    expect(sent.filter((s) => s.id === "spare")).toHaveLength(1);
    e.ingestSpool(spare.start(3));
    expect(e.liveIds().map((x) => x.id)).toEqual(["spare"]);
  });

  it("a /clear start stays visible (it offers RESUME); statusline-only lines do not unhide a spare", () => {
    const { e } = setup(60);
    e.ingestSpool(mk({ sid: "c" }).line("SessionStart", 1, { source: "clear" }));
    expect(e.liveIds().map((x) => x.id)).toEqual(["c"]);
    const s = mk({ sid: "s" });
    e.ingestSpool(s.start(2));
    e.ingestSpool(s.line("statusline", 3, { rate_limits: {} }, "statusline"));
    expect(e.liveIds().map((x) => x.id)).toEqual(["c"]);
  });

  it("worktree move updates worktree, not project", () => {
    const { e, sent } = setup(60);
    e.ingestSpool(mk({ sid: "A", cwd: "/r/app" }).prompt(1));
    e.ingestSpool(mk({ sid: "A", cwd: "/r/app/.claude/worktrees/fix" }).prompt(2));
    expect(sent.at(-1)!.name).toBe("app");
    expect(sent.at(-1)!.worktree).toBe("fix");
  });

  it("Jev line matching two live sessions: worktree cwd wins, else the latest event", () => {
    const { e } = setup(60);
    e.ingestSpool(mk({ sid: "W", cwd: "/r/app/.claude/worktrees/fix" }).prompt(1));
    e.ingestSpool(mk({ sid: "M", cwd: "/r/app" }).prompt(5));
    const j = (cwd: string) => ({ file: "judge", kind: "other", ts: at(6), cwd, sid: null, tool: "", head: "", cost: 0 }) as const;
    expect(e.attribute(j("/r/app/.claude/worktrees/fix"))).toBe("W"); // worktree match beats M's later event
    expect(e.attribute(j("/r/app"))).toBe("M"); // both match /r/app; M has the later event
  });

  it("Jev line from a subfolder of the repo attributes to the repo session", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fo-sub-"));
    const app = path.join(root, "app");
    fs.mkdirSync(path.join(app, ".git"), { recursive: true });
    fs.mkdirSync(path.join(app, "pwa"));
    clearWorktreeCache();
    const { e } = setup(60);
    e.ingestSpool(mk({ sid: "A", cwd: app }).prompt(5));
    const j = (cwd: string) => ({ file: "judge", kind: "other", ts: at(6), cwd, sid: null, tool: "", head: "", cost: 0 }) as const;
    expect(e.attribute(j(path.join(app, "pwa")))).toBe("A");
    clearWorktreeCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an event from a repo subfolder keeps the session's project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fo-sub-"));
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.mkdirSync(path.join(repo, "pwa"));
    clearWorktreeCache();
    const { e, sent } = setup(60);
    e.ingestSpool(mk({ sid: "A", cwd: repo }).prompt(1));
    e.ingestSpool(mk({ sid: "A", cwd: path.join(repo, "pwa") }).prompt(2));
    expect(e.snapshot().sessions).toHaveLength(1);
    expect(sent.at(-1)!.name).toBe("repo");
    expect(sent.at(-1)!.worktree).toBeNull();
    expect(e.sessions.get("A")!.cwd).toBe(toPosix(repo));
    clearWorktreeCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("Jev line from a sibling worktree (git-file) attributes to that session; main line prefers main", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fo-wt-"));
    const main = path.join(root, "app"), sib = path.join(root, "sib");
    fs.mkdirSync(path.join(main, ".git", "worktrees", "sib"), { recursive: true });
    fs.mkdirSync(sib);
    fs.writeFileSync(path.join(sib, ".git"), `gitdir: ${main}/.git/worktrees/sib\n`);
    clearWorktreeCache();
    const { e } = setup(60);
    e.ingestSpool(mk({ sid: "S", cwd: sib }).prompt(5));
    const j = (cwd: string) => ({ file: "judge", kind: "other", ts: at(6), cwd, sid: null, tool: "", head: "", cost: 0 }) as const;
    expect(e.attribute(j(sib))).toBe("S");
    e.ingestSpool(mk({ sid: "M", cwd: main }).prompt(4));
    expect(e.sessions.get("S")!.cwd).toBe(toPosix(main));
    expect(e.attribute(j(main))).toBe("M"); // main-folder line prefers the main session despite S's later event
    clearWorktreeCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("explicit SessionEnd retires a session; a later event revives it", () => {
    const { e, snaps } = setup();
    const old = mk("s1", "/p/app"), neu = mk("s2", "/p/app/.worktrees/x");
    e.ingestSpool(old.start(0));
    e.ingestSpool(old.end(5));
    e.ingestSpool(neu.prompt(6));
    e.flush();
    expect(e.snapshot().sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(snaps.length).toBeGreaterThan(0);
    e.ingestSpool(old.prompt(7));
    expect(e.snapshot().sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("blocked time stops when a waiting session ends", () => {
    const { e, clock } = setup();
    const a = mk("s1", "/p/app");
    e.ingestSpool(a.pre(0, "AskUserQuestion", { questions: [{ question: "Which?" }] }));
    e.ingestSpool(a.line("SessionEnd", 60));
    clock.t = at(3600);
    expect(e.metricsMsg().blockedMs).toBe(60_000);
  });

  it("a waiting session stays live and blocked when another chat starts in its folder", () => {
    const { e, clock } = setup();
    const a = mk("s1", "/p/app"), b = mk("s2", "/p/app");
    e.ingestSpool(a.pre(0, "AskUserQuestion", { questions: [{ question: "Which?" }] }));
    e.ingestSpool(b.prompt(60));
    clock.t = at(3600);
    expect(e.metricsMsg().blockedMs).toBe(3_600_000);
    expect(e.snapshot().sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("snapshot carries jev presence", () => {
    const e = new Engine(new Store(":memory:"));
    expect(e.snapshot().jev).toBe(true);
    e.jevPresent = false;
    expect(e.snapshot().jev).toBe(false);
  });

  it("survives a corrupt stored usage value", () => {
    const store = new Store(":memory:");
    store.kvSet("usage", "{bad");
    expect(() => new Engine(store).load()).not.toThrow();
  });

  it("attributes a Jev deny to the one session that just called that tool", () => {
    const { e } = setup();
    const a = mk("s1", "/p/app"), b = mk("s2", "/p/web");
    e.ingestSpool(a.pre(10, "Bash", { command: "rm -rf x" }));
    e.ingestSpool(b.pre(10, "Read", { file_path: "/p/web/x" }));
    e.ingestJev("gate", jev(11, { tool: "Bash", head: "rm", decision: "deny", cost: 0.001 }));
    expect(e.sessions.get("s1")).toMatchObject({ status: "deny", deny: { command: "Bash rm" } });
    expect(e.sessions.get("s2")!.status).toBe("active");
    expect(e.spend("today").rows).toEqual([{ project: "app", model: "jev-1.13", source: "jev", usd: 0.001 }]);
  });

  it("leaves an ambiguous Jev line unattributed", () => {
    const { e } = setup();
    e.ingestSpool(mk("s1", "/p/app").pre(10, "Bash", { command: "rm a" }));
    e.ingestSpool(mk("s2", "/p/web").pre(10, "Bash", { command: "rm b" }));
    e.ingestJev("gate", jev(10, { tool: "Bash", head: "rm", decision: "deny", cost: 0.002 }));
    expect([e.sessions.get("s1")!.status, e.sessions.get("s2")!.status]).toEqual(["active", "active"]);
    expect(e.counts["jev:unattributed"]).toBe(1);
    expect(e.spend("today").rows[0].project).toBe("Jev · gate");
  });

  it("Jev line with worktree cwd attributes to project session", () => {
    const { e } = setup();
    e.ingestSpool(mk("s1", "/p/app").pre(10, "Bash", { command: "ls" }));
    e.ingestSpool(mk("s2", "/p/web").pre(10, "Bash", { command: "ls" }));
    e.ingestJev("route", jev(11, { cwd: "/p/app/.worktrees/feat", cost: 0.01 }));
    expect(e.spend("today").rows[0].project).toBe("app");
  });

  it("jev line for a retired session is attributed to it", () => {
    const { e } = setup();
    const old = mk("s1", "/p/app"), neu = mk("s2", "/p/app/.worktrees/x");
    e.ingestSpool(old.start(0));
    e.ingestSpool(old.end(5));
    e.ingestSpool(neu.start(6));
    expect(e.sessions.get("s1")!.retired).toBe(true);
    e.ingestJev("route", jev(20, { session_id: "s1", cost: 0.01 }));
    expect(e.counts["jev:unattributed"]).toBeUndefined();
    expect(e.spend("today").rows).toEqual([{ project: "app", model: "jev-1.13", source: "jev", usd: 0.01 }]);
  });

  it("jev line without a known session falls back to the project name from its cwd", () => {
    const { e } = setup();
    e.ingestJev("route", jev(20, { session_id: "gone", cwd: "/p/web/.worktrees/feat", cost: 0.02 }));
    expect(e.counts["jev:unattributed"]).toBe(1);
    expect(e.spend("today").rows).toEqual([{ project: "web", model: "jev-1.13", source: "jev", usd: 0.02 }]);
  });

  it("jev line with no sid and no cwd is booked to Jev · <file>", () => {
    const { e } = setup();
    e.ingestJev("handoff", jev(20, { cost: 0.03 }));
    expect(e.counts["jev:unattributed"]).toBe(1);
    expect(e.spend("today").rows).toEqual([{ project: "Jev · handoff", model: "jev-1.13", source: "jev", usd: 0.03 }]);
  });

  it("session_id on a Jev line wins over guessing", () => {
    const { e } = setup();
    e.ingestSpool(mk("s1", "/p/app").start(0));
    e.ingestSpool(mk("s2", "/p/web").start(0));
    e.ingestJev("gate", jev(500, { session_id: "s2", tool: "Bash", head: "curl", decision: "deny" }));
    expect(e.sessions.get("s2")!.status).toBe("deny");
  });

  it("overrides feed the judge metric even when unattributed", () => {
    const { e } = setup(100);
    for (let i = 0; i < 20; i++) e.ingestSpool(mk().post(10 + i, "mcp__jev__jev_judge"));
    for (let i = 0; i < 10; i++) e.ingestJev("overrides", jev(40 + i, { question: "q" }));
    expect(e.metricsMsg().metrics.judge).toMatchObject({ calls: 20, warn: true, signal: expect.stringMatching(/^GOV-M2 50%/) });
  });

  it("builds usage from statusline lines plus the Jev meter", () => {
    const { e } = setup(60);
    const got: unknown[] = [];
    e.out.usage = (u) => got.push(u);
    e.ingestSpool(mk().usage(30, 50, 25, 2));
    e.ingestJev("gate", jev(40, { tool: "Bash", cost: 0.5 }));
    e.flush(true);
    const u = e.usageWire()!;
    expect(MsgZ.parse({ type: "usage", usage: u })).toBeTruthy();
    expect(u.session.used).toBe(0.5);
    expect(u.weekly!.used).toBe(0.25);
    expect(u.jev).toMatchObject({ usedUsd: 0.5, budgetUsd: 5 });
    expect(got.length).toBe(1);
  });

  it("usage has no jev block when Jev is not installed", () => {
    const { e } = setup(60);
    e.ingestSpool(mk().usage(30, 50, 25, 2));
    e.jevPresent = false;
    expect(e.usageWire()!.jev).toBeNull();
    e.jevPresent = true;
    expect(e.usageWire()!.jev).not.toBeNull();
  });

  it("older statusline usage does not override newer cache usage", () => {
    const { e } = setup(60);
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, at: at(2) });
    e.ingestSpool(mk().usage(1, 10, 20, null));
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.7);
    expect(u.weekly!.used).toBe(0.8);
    expect(u.weekly!.resetsAt).toBe(at(99000));
  });

  it("older cache usage does not override newer statusline usage", () => {
    const { e } = setup(60);
    e.ingestSpool(mk().usage(2, 10, 20, null));
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, at: at(1) });
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.1);
    expect(u.weekly!.used).toBe(0.2);
    expect(u.weekly!.resetsAt).toBe(at(2) + 86400_000);
  });

  it("newer setUsage replaces usage and marks it for push", () => {
    const { e } = setup(60);
    const got: unknown[] = [];
    e.out.usage = (u) => got.push(u);
    e.ingestSpool(mk().usage(1, 10, 20, null));
    e.flush(true);
    got.length = 0;
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, at: at(2) });
    e.flush(true);
    expect(got.length).toBe(1);
    expect(e.usageWire()!.weekly!.used).toBe(0.8);
  });

  it("equal at accepts the later setUsage", () => {
    const { e } = setup(60);
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, at: at(2) });
    e.setUsage({ fiveHour: { pct: 10, resetsAt: at(9000) }, sevenDay: { pct: 20, resetsAt: at(99000) }, at: at(2) });
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.1);
    expect(u.weekly!.used).toBe(0.2);
  });

  it("statusline usage after the cache keeps the cache's fable", () => {
    const { e } = setup(60);
    const resetsAt = at(50000);
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, fable: { pct: 31, resetsAt }, at: at(1) });
    e.ingestSpool(mk().usage(5, 10, 20, null));
    expect(e.usageWire()!.fable).toEqual({ used: 0.31, resetsAt });
  });

  it("usageWire sends fable null when absent and clamps used to 0..1", () => {
    const { e } = setup(60);
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, fable: null, at: at(1) });
    expect(e.usageWire()!.fable).toBeNull();
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, fable: { pct: 130, resetsAt: at(7) }, at: at(2) });
    expect(e.usageWire()!.fable).toEqual({ used: 1, resetsAt: at(7) });
    e.setUsage({ fiveHour: { pct: 70, resetsAt: at(9000) }, sevenDay: { pct: 80, resetsAt: at(99000) }, fable: { pct: -4, resetsAt: at(7) }, at: at(3) });
    expect(e.usageWire()!.fable!.used).toBe(0);
  });

  it("tick moves quiet sessions to idle and reports blocked time", () => {
    const { e, clock, sent } = setup();
    const a = mk();
    e.ingestSpool(a.pre(0, "AskUserQuestion", { questions: [{ question: "Q" }] }));
    e.ingestSpool(mk("s2", "/p/web").prompt(0));
    clock.t = at(700);
    e.tick();
    expect(e.sessions.get("s2")!.status).toBe("idle");
    expect(sent[sent.length - 1]).toMatchObject({ id: "s2", status: "idle" });
    expect(e.metricsMsg().blockedMs).toBe(700_000);
  });

  it("restores sessions from the store", () => {
    const { store, e } = setup();
    e.ingestSpool(mk().pre(1, "Skill", { skill: "wreview" }));
    const e2 = new Engine(store, () => at(2));
    e2.load();
    expect(e2.sessions.get("s1")!.stage).toBe(5);
    expect(e2.snapshot().sessions).toHaveLength(1);
  });

  it("snapshot validates against the wire schema", () => {
    const { e } = setup();
    e.ingestSpool(mk().prompt(0));
    expect(MsgZ.safeParse(e.snapshot()).success).toBe(true);
    expect(e.health()).toMatchObject({ ok: true, sessions: 1 });
  });

  it("includes the latest host sample in snapshots only once one exists", () => {
    const { e } = setup();
    expect("host" in e.snapshot()).toBe(false);
    const host = { at: 1, cpu: 0.2, gpu: null, mem: { used: 0.5, pressure: "normal" as const }, disks: [] };
    e.setHost(host);
    expect(e.snapshot().host).toEqual(host);
    expect(MsgZ.safeParse(e.snapshot()).success).toBe(true);
  });
  it("statusline cost no longer writes Claude spend rows (transcripts do)", () => {
    const { e } = setup(60);
    e.ingestSpool(mk().usage(30, 50, 25, 2));
    expect(e.spend("today").rows.filter((r) => r.source === "claude")).toEqual([]);
  });

  it("watches the transcript path from the spool and counts rejected paths", () => {
    const { e } = setup(60);
    const seen: string[] = [];
    e.transcripts = { watch: (sid, p) => { seen.push(`${sid}:${p}`); return p.startsWith("/ok/") ? "ok" : "rejected"; }, forget: () => {} };
    e.ingestSpool(mk().line("PreToolUse", 1, { tool_name: "Bash", tool_input: {}, transcript_path: "/ok/s1.jsonl" }));
    e.ingestSpool(mk("s2").line("PreToolUse", 2, { tool_name: "Bash", tool_input: {}, transcript_path: "/etc/x.jsonl" }));
    expect(seen).toEqual(["s1:/ok/s1.jsonl", "s2:/etc/x.jsonl"]);
    expect(e.health().counts.transcriptRejected).toBe(1);
  });

  it("main messages set CTX (with the live warn_pct); every priced message adds a Claude spend row", () => {
    const { e, sent } = setup(60);
    let warn = 0.55;
    e.warnPct = () => warn;
    e.ingestSpool(mk().prompt(1));
    const msg = (id: string, read: number, model = "claude-haiku-4-5"): TMsg => ({ id, model, usage: { input: 0, output: 1000, write5m: 0, write1h: 0, read }, ts: null });
    e.onTranscript("s1", msg("m1", 120_000), true);
    expect(sent.at(-1)!.ctx).toMatchObject({ tokens: 120_000, window: 200_000, level: "crit" });
    warn = 0.6; // the workflow agent edits thresholds.json while we run
    e.onTranscript("s1", msg("m2", 121_000), true);
    expect(sent.at(-1)!.ctx!.level).toBe("warn");
    e.onTranscript("s1", msg("sub1", 999_000, "claude-sonnet-5-5"), false); // subagent: cost only
    expect(sent.at(-1)!.ctx!.tokens).toBe(121_000);
    const rows = e.spend("today").rows.filter((r) => r.source === "claude");
    expect(rows.map((r) => r.model).sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-5-5"]);
    e.onTranscript("s1", msg("m3", 1, "claude-mystery-9"), true);
    expect(e.health().counts.unpricedModel).toBe(1);
  });

  it("CTX and handoff updates do not count as activity", () => {
    const { e } = setup(60);
    e.ingestSpool(mk().prompt(1));
    const before = e.sessions.get("s1")!.lastEventAt;
    e.onTranscript("s1", { id: "m1", model: "claude-opus-5-5", usage: { input: 1, output: 1, write5m: 0, write1h: 0, read: 50_000 }, ts: null }, true);
    e.setHandoff("s1", Date.now());
    expect(e.sessions.get("s1")!.lastEventAt).toBe(before);
    expect(e.sessions.get("s1")!.handoffAt).not.toBeNull();
  });

  it("metrics and snapshot carry nine KPIs; an out-of-order Fable escalation shows in ESC-M2", () => {
    const { e } = setup(60);
    const a = mk();
    e.ingestSpool(a.prompt(1));
    e.ingestSpool(a.pre(2, "mcp__jev__log_escalation", { task: "T1", from_model: "sonnet", to_model: "fable", reason: "x" }));
    expect(e.metricsMsg().kpis.map((k) => k.id)).toEqual(["ESC-M1", "GOV-M2", "ESC-M2", "REV-M1", "EXE-M2", "EXE-M3", "FO-GATE", "FO-SHIP", "FO-TRY"]);
    expect(e.snapshot().kpis.find((k) => k.id === "ESC-M2")).toMatchObject({ value: 1, warn: true });
    expect(e.snapshot().metrics.escalate).toMatchObject({ warn: true, signal: expect.stringMatching(/^ESC-M2 1 /) });
    expect(MsgZ.safeParse(e.snapshot()).success).toBe(true);
  });

  it("a KPI failure sends kpis [] and keeps metrics flowing", () => {
    const { e, store } = setup(60);
    vi.spyOn(store, "escalationsSince").mockImplementation(() => { throw new Error("boom"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(e.metricsMsg().kpis).toEqual([]);
    expect(e.snapshot().metrics.build.signal).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("a new escalation does not change kpis until tick", () => {
    const { e, clock } = setup(60);
    const a = mk();
    e.ingestSpool(a.prompt(1));
    const esc = (m: ReturnType<Engine["metricsMsg"]>) => m.kpis.find((x) => x.id === "ESC-M2")!.value;
    expect(esc(e.metricsMsg())).toBe(0);
    e.ingestSpool(a.pre(2, "mcp__jev__log_escalation", { task: "T1", from_model: "sonnet", to_model: "fable", reason: "x" }));
    expect(esc(e.metricsMsg())).toBe(0);
    clock.t = at(61);
    e.tick();
    expect(esc(e.metricsMsg())).toBe(1);
  });

  it("a KPI failure is cached: console.error once for two metricsMsg calls, and kpisReport is not ok", () => {
    const { e, store } = setup(60);
    vi.spyOn(store, "escalationsSince").mockImplementation(() => { throw new Error("boom"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    e.metricsMsg();
    e.metricsMsg();
    expect(err).toHaveBeenCalledTimes(1);
    expect(e.kpisReport().ok).toBe(false);
    err.mockRestore();
  });

  it("ESC-M1 end to end: 5-task plan, one sonnet->opus climb, merge, tick", () => {
    const { e, clock } = setup(10);
    const a = mk();
    for (const l of [a.start(0), a.pre(1, "Skill", { skill: "superpowers:writing-plans" }),
      a.post(2, "Write", { file_path: "/Users/p/projects/app/docs/superpowers/plans/p.md" }, { planTasks: 5 }),
      a.pre(3, "mcp__jev__log_escalation", { task: "T1", from_model: "sonnet", to_model: "opus", reason: "x" }),
      a.post(4, "Bash", { command: "git merge feature" })]) e.ingestSpool(l);
    clock.t = at(20);
    e.tick();
    expect(e.metricsMsg().kpis.find((k) => k.id === "ESC-M1")).toMatchObject({ value: 0.2, n: 5, ready: true });
  });

  it("sets an agent's tokens from its newest subagent transcript message and pushes the session", () => {
    const { e, sent } = setup();
    const a = mk();
    for (const l of [a.start(0), a.prompt(1), a.pre(2, "Agent", { subagent_type: "executor" }), a.subStart(3, "ab12cd")]) e.ingestSpool(l);
    e.onTranscripts([{ sid: "s1", m: parseTranscriptLine(tline("x1", 4, 30_000))!, main: false, agent: "ab12cd" }]);
    e.onTranscripts([{ sid: "s1", m: parseTranscriptLine(tline("x2", 5, 48_000))!, main: false, agent: "ab12cd" }]);
    const last = sent[sent.length - 1];
    expect(last.agents!.find((x) => x.id === "ab12cd")!.tokens).toBe(48_001); // tline: input 1 + cache read 48_000
  });
});

describe("Engine agent plumbing", () => {
  it("meta binding fixes a crossed same-type burst", () => {
    const { e, sent } = setup();
    const a = mk();
    const disp = (sec: number, id: string, task: string, model: string) =>
      a.line("PreToolUse", sec, { tool_name: "Agent", tool_input: { subagent_type: "executor", description: task, model }, tool_use_id: id });
    for (const l of [a.start(0), a.prompt(1), disp(2, "u1", "A", "sonnet"), disp(3, "u2", "B", "opus"), a.subStart(4, "x"), a.subStart(5, "y")]) e.ingestSpool(l);
    e.onMeta("s1", { agentId: "x", useId: "u2" });
    const ag = sent.at(-1)!.agents!;
    expect(ag.find((x) => x.id === "x")).toMatchObject({ task: "B", model: "opus" });
    expect(ag.find((x) => x.id === "y")).toMatchObject({ task: "A", model: "sonnet" });
  });

  it("token push survives an unchanged main ctx in the same batch", () => {
    const { e, sent } = setup();
    const a = mk();
    for (const l of [a.start(0), a.prompt(1), a.pre(2, "Agent", { subagent_type: "executor" }), a.subStart(3, "ab12cd")]) e.ingestSpool(l);
    e.onTranscripts([{ sid: "s1", m: parseTranscriptLine(tline("m1", 4, 20_000))!, main: true }]);
    e.onTranscripts([
      { sid: "s1", m: parseTranscriptLine(tline("m2", 5, 20_000))!, main: true }, // same ctx as m1
      { sid: "s1", m: parseTranscriptLine(tline("x1", 5, 30_000))!, main: false, agent: "ab12cd" }]);
    expect(sent.at(-1)!.agents!.find((x) => x.id === "ab12cd")!.tokens).toBe(30_001);
  });
});

describe("projectName", () => {
  it("uses the last path segment, collapsing worktrees and trailing slashes", () => {
    expect(projectName("/a/b/proj")).toBe("proj");
    expect(projectName("/a/b/proj/")).toBe("proj");
    expect(projectName("/a/b/proj/.claude/worktrees/wt/sub")).toBe("proj");
    expect(projectName("/")).toBe("/");
  });
});

describe("Engine transcripts (batched)", () => {
  it("500 messages in one poll: one spend transaction with 500 rows, CTX applied once with the last main value", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-et-")));
    const tp = path.join(root, "-p", "s1.jsonl");
    fs.mkdirSync(path.dirname(tp));
    const lines = Array.from({ length: 500 }, (_, i) => tline(`m${i}`, 1 + i, i === 10 ? 300_000 : 1000 + i));
    fs.writeFileSync(tp, lines.join("\n") + "\n");
    const { e, sent, store } = setup(600);
    const t = new TranscriptTailer(root, (items) => e.onTranscripts(items));
    e.transcripts = t;
    e.ingestSpool(mk().line("UserPromptSubmit", 1, { prompt: "go", transcript_path: tp }));
    const inserts = vi.spyOn(store, "insert"), txs = vi.spyOn(store, "tx");
    const before = sent.length;
    t.poll();
    expect(inserts.mock.calls.filter(([em]) => em.spend.length)).toHaveLength(1); // the other insert is the one Ctx commit
    expect(txs).toHaveBeenCalledTimes(1);
    expect(sent.length - before).toBe(1);
    // biggest-total tracking saw message 10 (300k) so the window is 1M; tokens are the last message's
    expect(sent.at(-1)!.ctx).toMatchObject({ tokens: 1 + 1499, window: 1_000_000 });
    expect(store.spendSince(0).filter((r) => r.source === "claude")).toHaveLength(500);
  });

  it("spend rows are dated by the record timestamp, else now()", () => {
    const { e, store } = setup(600);
    e.ingestSpool(mk().prompt(1));
    const u = { input: 0, output: 1000, write5m: 0, write1h: 0, read: 0 };
    e.onTranscripts([{ sid: "s1", m: { id: "a", model: "claude-opus-5-5", usage: u, ts: at(5) }, main: true },
      { sid: "s1", m: { id: "b", model: "claude-opus-5-5", usage: u, ts: null }, main: true }]);
    expect(store.spendSince(0).map((r) => r.ts)).toEqual([at(5), at(600)]);
  });

  it("transcriptRejected counts each rejected path once per sid", () => {
    const { e } = setup(60);
    e.transcripts = { watch: () => "rejected", forget: () => {} };
    const bad = (sid: string, sec: number, p = "/etc/x.jsonl") =>
      e.ingestSpool(mk(sid).line("PreToolUse", sec, { tool_name: "Bash", tool_input: {}, transcript_path: p }));
    bad("s1", 1); bad("s1", 2); bad("s1", 3);
    expect(e.health().counts.transcriptRejected).toBe(1);
    bad("s2", 4);
    bad("s1", 5, "/etc/y.jsonl");
    expect(e.health().counts.transcriptRejected).toBe(3);
  });
});
