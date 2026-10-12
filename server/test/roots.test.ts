import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountRoots, type Account } from "../src/accounts";
import { loadConfig } from "../src/config";
import { readRegistries } from "../src/registry";
import { TranscriptTailer } from "../src/transcript";

const HOME = "/Users/dev";
const A: Account[] = [{ dir: "~/.claude", label: "Team", dryas: true }, { dir: "/opt/claude-pro", label: "Pro", dryas: false }];
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-roots-")));

describe("accountRoots", () => {
  it("<dir>/<sub> per account; an override replaces them all", () => {
    expect(accountRoots(A, "projects", null, HOME)).toEqual([path.join(HOME, ".claude", "projects"), path.join("/opt/claude-pro", "projects")]);
    expect(accountRoots(A, "sessions", null, HOME)).toEqual([path.join(HOME, ".claude", "sessions"), path.join("/opt/claude-pro", "sessions")]);
    expect(accountRoots(A, "projects", "/t", HOME)).toEqual(["/t"]);
  });
});

describe("TranscriptTailer with several roots", () => {
  it("accepts a transcript under any root, still rejects others, and follows setRoots", () => {
    const base = tmp();
    const file = (root: string) => { const p = path.join(base, root, "-p", "s.jsonl"); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); return p; };
    const [a, b, c] = [file("a"), file("b"), file("c")];
    const t = new TranscriptTailer([path.join(base, "a"), path.join(base, "b")], () => {});
    expect(t.watch("s1", a)).toBe("ok");
    expect(t.watch("s2", b)).toBe("ok");
    expect(t.watch("s3", c)).toBe("rejected");
    expect(t.watch("s4", path.join(base, "a", "..", "c", "-p", "s.jsonl"))).toBe("rejected");
    t.setRoots([path.join(base, "c")]);
    expect(t.watch("s5", c)).toBe("ok");
    expect(t.watch("s6", a)).toBe("rejected");
  });
});

describe("readRegistries", () => {
  it("merges every dir, skips missing ones, null only when all are missing", () => {
    const a = tmp(), b = tmp();
    fs.writeFileSync(path.join(a, "1.json"), JSON.stringify({ pid: 11, sessionId: "t1", kind: "" }));
    fs.writeFileSync(path.join(b, "2.json"), JSON.stringify({ pid: 22, sessionId: "p1", kind: "bg" }));
    const r = readRegistries([a, path.join(a, "missing"), b])!;
    expect([...r.keys()].sort()).toEqual(["p1", "t1"]);
    expect(r.get("p1")).toEqual({ pid: 22, sessionId: "p1", kind: "bg" });
    expect(readRegistries([path.join(a, "x"), path.join(b, "y")])).toBeNull();
  });
});

describe("loadConfig roots", () => {
  it("FO_TRANSCRIPTS / FO_SESSIONS_DIR are overrides; unset means per account (null)", () => {
    const { FO_TRANSCRIPTS: _t, FO_SESSIONS_DIR: _s, ...env } = process.env;
    expect(loadConfig(env).transcriptsRoot).toBeNull();
    expect(loadConfig(env).sessionsDir).toBeNull();
    expect(loadConfig({ ...env, FO_SESSIONS_DIR: "/s" }).sessionsDir).toBe("/s");
  });
});
