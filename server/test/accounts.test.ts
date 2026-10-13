import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountsFile, DEFAULT_ACCT, accountRoots, canonAcct, defaultLabel, expandHome, makeAccount, mergeAccounts, parseAccounts, parseDryasDirs, uniqueDirs } from "../src/accounts";
import { loadConfig, resolveJev } from "../src/config";
import { readRegistries } from "../src/registry";
import { Store } from "../src/store";
import { TranscriptTailer } from "../src/transcript";

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-acc-")));
const bare = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const env = { ...process.env, ...extra };
  for (const k of ["FO_JEV_LOGS", "FO_THRESHOLDS", "JEV_HANDOFF_DIR", "FO_TRANSCRIPTS", "FO_SESSIONS_DIR", "DRYAS_DATA_ROOT", "CLAUDE_CONFIG_DIR"])
    if (!(k in extra)) delete env[k];
  return env;
};

describe("resolveJev: env override > shared ~/.dryas/jev/logs and/or legacy ~/.claude/jev", () => {
  const home = path.resolve("/h"), J = (...p: string[]) => path.join(...p);
  const SH = J(home, ".dryas", "jev"), LG = J(home, ".claude", "jev");
  const has = (...ps: string[]) => (p: string) => ps.includes(p);
  it("shared only once its logs exist and the legacy logs are gone", () => {
    const j = resolveJev(bare(), home, has(J(SH, "logs")));
    expect(j).toEqual({ logDirs: [J(SH, "logs")], handoffDirs: [J(SH, "handoff")], thresholdsPath: J(SH, "thresholds.json") });
  });
  it("a bare ~/.dryas/jev (no logs yet) does not switch", () => {
    expect(resolveJev(bare(), home, has(SH, J(LG, "logs"))).logDirs).toEqual([J(LG, "logs")]);
  });
  it("$DRYAS_DATA_ROOT moves the shared dir", () => {
    const d = path.resolve("/d");
    expect(resolveJev(bare({ DRYAS_DATA_ROOT: d }), home, has(J(d, "jev", "logs"))).logDirs).toEqual([J(d, "jev", "logs")]);
  });
  it("legacy only when nothing is shared yet (not migrated, or no Dryas at all)", () => {
    expect(resolveJev(bare(), home, () => false)).toEqual({ logDirs: [J(LG, "logs")], handoffDirs: [J(LG, "handoff")], thresholdsPath: J(LG, "thresholds.json") });
  });
  it("mixed state: both dirs until .migrated.json lists ~/.claude; thresholds = first that exists", () => {
    const ex = has(J(SH, "logs"), J(LG, "logs"), J(LG, "thresholds.json"));
    const none = () => { throw new Error("ENOENT"); };
    const j = resolveJev(bare(), home, ex, none);
    expect(j.logDirs).toEqual([J(SH, "logs"), J(LG, "logs")]);
    expect(j.handoffDirs).toEqual([J(SH, "handoff"), J(LG, "handoff")]);
    expect(j.thresholdsPath).toBe(J(LG, "thresholds.json"));
    const other = () => JSON.stringify({ merged: [J(home, ".claude-team")] });
    expect(resolveJev(bare(), home, ex, other).logDirs).toHaveLength(2);
    const merged = () => JSON.stringify({ merged: [J(home, ".claude")] });
    expect(resolveJev(bare(), home, ex, merged).logDirs).toEqual([J(SH, "logs")]);
  });
  it("explicit FO_* / JEV_* overrides win", () => {
    const j = resolveJev(bare({ FO_JEV_LOGS: "/l", JEV_HANDOFF_DIR: "/ho", FO_THRESHOLDS: "/t.json" }), home, () => true);
    expect([j.logDirs, j.handoffDirs, j.thresholdsPath]).toEqual([["/l"], ["/ho"], "/t.json"]);
  });
});

describe("loadConfig: Dryas and accounts paths", () => {
  it("accounts.json sits in the data root; ~/.claude always watched, CLAUDE_CONFIG_DIR added", () => {
    const h = tmp();
    const c = loadConfig(bare({ DRYAS_DATA_ROOT: path.join(h, "d"), CLAUDE_CONFIG_DIR: path.join(h, "cfg") }), "linux", h);
    expect(c.dryasAccountsPath).toBe(path.join(h, "d", "accounts.json"));
    expect(c.accountsPath).toBe(path.join(h, ".flowobserve", "accounts.json"));
    expect(c.claudeDirs).toEqual([path.join(h, ".claude"), path.join(h, "cfg")]);
    expect(c.jevLogDirs).toEqual([path.join(h, ".claude", "jev", "logs")]);
    fs.mkdirSync(path.join(h, "d", "jev", "logs"), { recursive: true });
    expect(loadConfig(bare({ DRYAS_DATA_ROOT: path.join(h, "d") }), "linux", h).jevLogDirs).toEqual([path.join(h, "d", "jev", "logs")]);
  });
  it("defaults: ~/.dryas/accounts.json, ~/.claude, no transcript or sessions override", () => {
    const c = loadConfig(bare(), "linux", "/h");
    expect([c.dryasAccountsPath, c.claudeDirs, c.transcriptsEnv, c.sessionsEnv]).toEqual([path.join("/h", ".dryas", "accounts.json"), [path.join("/h", ".claude")], null, null]);
  });
});


const HOME = "/Users/dev";
const none = () => false;
const dryasIn = (...dirs: string[]) => (p: string) => dirs.some((d) => p === path.join(d, "jev", "chain.json"));

describe("canonAcct", () => {
  it("keeps ~ and absolute forms without trailing slashes; anything else is null", () => {
    expect(canonAcct("~/.claude-personal/")).toBe("~/.claude-personal");
    expect(canonAcct("/opt/claude")).toBe("/opt/claude");
    expect(canonAcct("~")).toBe("~");
    for (const bad of ["", "/", "relative/dir", "~x", 42, null, "/" + "a".repeat(300)]) expect(canonAcct(bad)).toBeNull();
  });
});

describe("defaultLabel / expandHome", () => {
  it("label = basename without its leading dot", () => {
    expect(defaultLabel("~/.claude")).toBe("claude");
    expect(defaultLabel("~/.claude-personal")).toBe("claude-personal");
    expect(defaultLabel("/opt/work")).toBe("work");
    expect(defaultLabel("~/." + "x".repeat(40))).toHaveLength(32);
  });
  it("expands only the home prefix", () => {
    expect(expandHome("~/.claude", HOME)).toBe(path.join(HOME, ".claude"));
    expect(expandHome("~", HOME)).toBe(HOME);
    expect(expandHome("/opt/x", HOME)).toBe("/opt/x");
  });
});

describe("parseDryasDirs", () => {
  it("missing file → no extra dirs; corrupt or misshaped → null (keep what we had)", () => {
    expect(parseDryasDirs(null, "/h")).toEqual([]);
    expect(parseDryasDirs("{nope", "/h")).toBeNull();
    expect(parseDryasDirs("[]", "/h")).toBeNull();
    expect(parseDryasDirs('{"claude_dirs": "/x"}', "/h")).toBeNull();
  });
  it("keeps absolute string dirs (and ~/ ones) as ~-folded keys, skips others", () => {
    expect(parseDryasDirs(JSON.stringify({ claude_dirs: ["/a", 3, "", "rel/x", "~/.claude-team", null, "/b", "/h/.claude-team"] }), "/h"))
      .toEqual(["/a", "~/.claude-team", "/b"]);
  });
});

describe("uniqueDirs", () => {
  it("dedupes by resolved path and keeps the first spelling and order", () => {
    const h = tmp();
    fs.mkdirSync(path.join(h, "real"));
    fs.symlinkSync(path.join(h, "real"), path.join(h, "link"));
    expect(uniqueDirs([path.join(h, "real"), path.join(h, "link"), path.join(h, "real") + "/", path.join(h, "other"), path.join(h, "x", "..", "other")]))
      .toEqual([path.join(h, "real"), path.join(h, "other")]);
  });
});

describe("AccountsFile with Dryas's accounts.json and the server's own dirs", () => {
  function world() {
    const h = tmp();
    const base = path.join(h, ".claude"), team = path.join(h, ".claude-team"), acc = path.join(h, ".dryas", "accounts.json");
    fs.mkdirSync(path.dirname(acc), { recursive: true });
    const mk = (envT: string | null = null, envS: string | null = null) => {
      const f = new AccountsFile(path.join(h, "fo.json"), acc, [base], h, () => false);
      return { f, dirs: () => f.accounts().map((a) => path.join(h, a.dir.replace(/^~\//, ""))), t: () => accountRoots(f.accounts(), "projects", envT, h), s: () => accountRoots(f.accounts(), "sessions", envS, h) };
    };
    return { h, base, team, acc, mk };
  }
  it("base dir only when accounts.json is missing; a corrupt file keeps the previous list", () => {
    const { base, team, acc, mk } = world();
    const a = mk();
    a.f.check();
    expect(a.dirs()).toEqual([base]);
    fs.writeFileSync(acc, JSON.stringify({ claude_dirs: [team] }));
    a.f.check();
    expect(a.dirs()).toEqual([team, base]);
    fs.writeFileSync(acc, "{broken, half written");
    expect(a.f.check()).toBe(false);
    expect(a.dirs()).toEqual([team, base]);
  });
  it("lists every account, Dryas-listed first then the base dir, deduped; transcripts and sessions per dir", () => {
    const { base, team, acc, mk } = world();
    fs.writeFileSync(acc, JSON.stringify({ claude_dirs: [team, base, team] }));
    const a = mk();
    expect(a.f.check()).toBe(true);
    expect(a.dirs()).toEqual([team, base]);
    expect(a.t()).toEqual([path.join(team, "projects"), path.join(base, "projects")]);
    expect(a.s()).toEqual([path.join(team, "sessions"), path.join(base, "sessions")]);
  });
  it("re-reads only when the file changes, so a new account appears without restart", () => {
    const { base, team, acc, mk } = world();
    fs.writeFileSync(acc, JSON.stringify({ claude_dirs: [base] }));
    const a = mk();
    a.f.check();
    expect(a.f.check()).toBe(false);
    fs.writeFileSync(acc, JSON.stringify({ claude_dirs: [base, team] }));
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(acc, t, t);
    expect(a.f.check()).toBe(true);
    expect(a.dirs()).toEqual([base, team]);
    fs.rmSync(acc);
    expect(a.f.check()).toBe(true);
    expect(a.dirs()).toEqual([base]);
  });
  it("FO_TRANSCRIPTS / FO_SESSIONS_DIR pin a single dir", () => {
    const { team, acc, mk } = world();
    fs.writeFileSync(acc, JSON.stringify({ claude_dirs: [team] }));
    const a = mk("/t", "/s");
    a.f.check();
    expect(a.t()).toEqual([path.resolve("/t")]);
    expect(a.s()).toEqual([path.resolve("/s")]);
  });
});

describe("TranscriptTailer with several roots", () => {
  it("accepts transcripts under any account root, rejects others, and takes new roots", () => {
    const h = tmp();
    const r1 = path.join(h, "a", "projects"), r2 = path.join(h, "b", "projects"), r3 = path.join(h, "c", "projects");
    for (const r of [r1, r2, r3]) { fs.mkdirSync(path.join(r, "-p"), { recursive: true }); fs.writeFileSync(path.join(r, "-p", "s.jsonl"), ""); }
    const t = new TranscriptTailer([r1, r2], () => {});
    expect(t.watch("s1", path.join(r1, "-p", "s.jsonl"))).toBe("ok");
    expect(t.watch("s2", path.join(r2, "-p", "s.jsonl"))).toBe("ok");
    expect(t.watch("s3", path.join(r3, "-p", "s.jsonl"))).toBe("rejected");
    t.setRoots([r1, r2, r3]);
    expect(t.watch("s3", path.join(r3, "-p", "s.jsonl"))).toBe("ok");
    expect(t.watch("s1", path.join(r1, "-p", "s.jsonl"))).toBe("same"); // existing watches survive a root change
  });
  it("a root that did not exist when set is resolved again (symlinked config dir created later)", () => {
    const h = tmp();
    const real = path.join(h, "real"), link = path.join(h, "team");
    const t = new TranscriptTailer([path.join(link, "projects")], () => {});
    fs.mkdirSync(path.join(real, "projects", "-p"), { recursive: true });
    fs.writeFileSync(path.join(real, "projects", "-p", "s.jsonl"), "");
    fs.symlinkSync(real, link);
    expect(t.watch("s", path.join(link, "projects", "-p", "s.jsonl"))).toBe("ok");
  });
});

describe("readRegistries", () => {
  it("merges every account's sessions dir; null only when none exists", () => {
    const h = tmp();
    const d1 = path.join(h, "a"), d2 = path.join(h, "b");
    fs.mkdirSync(d1); fs.mkdirSync(d2);
    fs.writeFileSync(path.join(d1, "1.json"), JSON.stringify({ pid: 1, sessionId: "x", kind: "interactive" }));
    fs.writeFileSync(path.join(d2, "2.json"), JSON.stringify({ pid: 2, sessionId: "y", kind: "bg" }));
    const r = readRegistries([d1, path.join(h, "missing"), d2])!;
    expect([...r.keys()].sort()).toEqual(["x", "y"]);
    expect(r.get("y")).toEqual({ pid: 2, sessionId: "y", kind: "bg" });
    expect(readRegistries([path.join(h, "missing")])).toBeNull();
    expect(readRegistries([])).toBeNull();
  });
});

describe("parseAccounts", () => {
  it("missing file: no entries", () => {
    expect(parseAccounts(null, HOME)).toEqual([]);
  });
  it("an absolute dir under the home dir folds to its ~ form", () => {
    const text = JSON.stringify({ accounts: [{ dir: "/Users/dev/.claude" }, { dir: "/Users/dev/.claude-personal/" }, { dir: "~/.claude-personal" }, { dir: "/Users/devious/x" }] }); // leakcheck:allow (prefix-boundary case: /Users/devious is not under /Users/dev)
    expect(parseAccounts(text, HOME).map((a) => a.dir)).toEqual(["~/.claude", "~/.claude-personal", "/Users/devious/x"]); // leakcheck:allow
  });
  it("file order and labels; duplicates and bad dirs dropped; at most 8", () => {
    const text = JSON.stringify({ accounts: [
      { dir: "~/.claude", label: "Team" }, { dir: "~/.claude-personal/", label: "  Pro  " }, { dir: "~/.claude-personal" },
      { dir: "relative" }, { dir: "~/.claude-lab" }, ...Array.from({ length: 10 }, (_, i) => ({ dir: `~/.c${i}` })),
    ] });
    const accounts = parseAccounts(text, HOME);
    expect(accounts.slice(0, 3)).toEqual([
      { dir: "~/.claude", label: "Team" },
      { dir: "~/.claude-personal", label: "Pro" },
      { dir: "~/.claude-lab", label: null },
    ]);
    expect(accounts).toHaveLength(8);
  });
  it("bad JSON or no accounts array: no entries, with a reason to log", () => {
    for (const t of ["{bad", "null", "[]", '{"accounts":{}}']) {
      const why: string[] = [];
      expect(parseAccounts(t, HOME, (w) => why.push(w))).toEqual([]);
      expect(why).toHaveLength(1);
    }
  });
  it("an empty list: no entries, no reason", () => {
    const why: string[] = [];
    expect(parseAccounts('{"accounts":[]}', HOME, (w) => why.push(w))).toEqual([]);
    expect(why).toEqual([]);
  });
});

describe("AccountsFile", () => {
  it("re-reads only when the file appears, changes or goes; reports list changes", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-acc-")), "accounts.json");
    const f = new AccountsFile(file, path.join(path.dirname(file), "dryas.json"), ["~/.claude"], HOME, none);
    expect(f.check()).toBe(false);
    expect(f.accounts().map((a) => a.label)).toEqual(["claude"]);
    fs.writeFileSync(file, JSON.stringify({ accounts: [{ dir: "~/.claude", label: "Team" }, { dir: "~/.claude-personal", label: "Pro" }] }));
    expect(f.check()).toBe(true);
    expect(f.accounts().map((a) => a.label)).toEqual(["Team", "Pro"]);
    expect(f.check()).toBe(false);
    fs.rmSync(file);
    expect(f.check()).toBe(true);
    expect(f.accounts().map((a) => a.label)).toEqual(["claude"]);
  });
});

describe("loadConfig accountsPath", () => {
  it("lives in FO_HOME", () => {
    expect(loadConfig({ ...process.env, FO_HOME: "/Users/dev/.flowobserve" }).accountsPath).toBe(path.join("/Users/dev/.flowobserve", "accounts.json"));
  });
});

describe("mergeAccounts", () => {
  it("one account when Dryas names ~/.claude by absolute path", () => {
    const fo = [makeAccount("~/.claude", "Team", HOME, none)];
    const out = mergeAccounts(fo, parseDryasDirs('{"claude_dirs":["/Users/dev/.claude"]}', HOME)!, [], HOME, none);
    expect(out.map((a) => [a.dir, a.label, a.dryas])).toEqual([["~/.claude", "Team", true]]);
  });
  it("adds Dryas-only dirs after FlowObserve's, default label", () => {
    const fo = [makeAccount("~/.claude", null, HOME, none)];
    const out = mergeAccounts(fo, ["~/.claude-team"], [], HOME, none);
    expect(out.map((a) => a.dir)).toEqual(["~/.claude", "~/.claude-team"]);
    expect(out[1].label).toBe("claude-team");
  });
  it("this Mac today: no FlowObserve file, Dryas lists ~/.claude → one account", () => {
    const out = mergeAccounts([], ["~/.claude"], ["~/.claude"], HOME, none);
    expect(out).toHaveLength(1);
  });
});

describe("Dryas flag", () => {
  it("true for a v1 plugin dir (.dryas-plugin.json, no jev/chain.json)", () => {
    const exists = (p: string) => p === "/Users/dev/.claude/.dryas-plugin.json";
    expect(makeAccount("~/.claude", null, HOME, exists).dryas).toBe(true);
  });
  it("false with neither record nor listing", () => {
    expect(makeAccount("~/.claude-personal", null, HOME, none).dryas).toBe(false);
  });
});

describe("AccountsFile with a corrupt Dryas file", () => {
  it("keeps the previous Dryas dirs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-acc-"));
    const dry = path.join(dir, "dryas.json");
    fs.writeFileSync(dry, '{"claude_dirs":["~/.claude","~/.claude-team"]}');
    const f = new AccountsFile(path.join(dir, "missing.json"), dry, ["~/.claude"], HOME, none);
    f.check();
    fs.writeFileSync(dry, '{"claude_dirs":["~/.cla');   // half-written
    fs.utimesSync(dry, new Date(), new Date(Date.now() + 5000));
    f.check();
    expect(f.accounts().map((a) => a.dir)).toEqual(["~/.claude", "~/.claude-team"]);
  });
});

describe("windows dirs", () => {
  const WH = "C:\\Users\\dev";
  it("Dryas claude_dirs with C:\\ paths and ~\\ fold under a Windows home", () => {
    const text = JSON.stringify({ claude_dirs: ["C:\\Users\\dev\\.claude-team", "c:/users/DEV/.claude", "~\\.claude-lab", "D:\\work\\claude\\", "\\\\srv\\share\\cl", "C:/"] });
    expect(parseDryasDirs(text, WH)).toEqual(["~/.claude-team", "~/.claude", "~/.claude-lab", "D:\\work\\claude", "\\\\srv\\share\\cl"]);
  });
  it("canonAcct matches the hook's Windows keys", () => {
    expect(canonAcct("D:/work/x")).toBe("D:\\work\\x");
    expect(canonAcct("D:\\work\\x\\")).toBe("D:\\work\\x");
    expect(canonAcct("~/.claude-x")).toBe("~/.claude-x");
    expect(canonAcct("~\\.claude-x")).toBe("~/.claude-x");
    expect(canonAcct("C:")).toBeNull();
  });
  it("expandHome and defaultLabel handle Windows forms", () => {
    expect(expandHome("~/.claude-x", WH)).toBe("C:\\Users\\dev\\.claude-x");
    expect(defaultLabel("D:\\work\\claude")).toBe("claude");
  });
  it("accounts.json: Windows dirs fold and keep labels, no makeAccount needed", () => {
    const text = JSON.stringify({ accounts: [{ dir: "C:\\Users\\dev\\.claude", label: "Team" }, { dir: "E:\\cl" }] });
    expect(parseAccounts(text, WH)).toEqual([{ dir: "~/.claude", label: "Team" }, { dir: "E:\\cl", label: null }]);
  });
});

describe("AccountsFile read failure", () => {
  it("advances the stamp so an unreadable file is logged once, not every tick", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-acc-"));
    const file = path.join(dir, "fo.json");
    fs.mkdirSync(file); // stat works, readFileSync throws EISDIR
    const log: string[] = [];
    const orig = console.error;
    console.error = (m: string) => { log.push(m); };
    try {
      const f = new AccountsFile(file, path.join(dir, "d.json"), ["~/.claude"], HOME, none);
      f.check(); f.check(); f.check();
    } finally { console.error = orig; }
    expect(log).toHaveLength(1);
  });
});
