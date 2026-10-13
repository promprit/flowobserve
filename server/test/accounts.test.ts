import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountsFile, DEFAULT_ACCT, canonAcct, defaultLabel, expandHome, parseAccounts } from "../src/accounts";
import { loadConfig } from "../src/config";

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

describe("parseAccounts", () => {
  it("missing file: the default account only, Dryas from its chain file", () => {
    expect(parseAccounts(null, HOME, dryasIn(path.join(HOME, ".claude"))))
      .toEqual({ accounts: [{ dir: DEFAULT_ACCT, label: "claude", dryas: true }], error: null });
  });
  it("an absolute dir under the home dir folds to its ~ form", () => {
    const text = JSON.stringify({ accounts: [{ dir: "/Users/dev/.claude" }, { dir: "/Users/dev/.claude-personal/" }, { dir: "~/.claude-personal" }, { dir: "/Users/devious/x" }] }); // leakcheck:allow (prefix-boundary case: /Users/devious is not under /Users/dev)
    expect(parseAccounts(text, HOME, none).accounts.map((a) => a.dir)).toEqual(["~/.claude", "~/.claude-personal", "/Users/devious/x"]); // leakcheck:allow
  });
  it("file order and labels; duplicates and bad dirs dropped; at most 8", () => {
    const text = JSON.stringify({ accounts: [
      { dir: "~/.claude", label: "Team" }, { dir: "~/.claude-personal/", label: "  Pro  " }, { dir: "~/.claude-personal" },
      { dir: "relative" }, { dir: "~/.claude-lab" }, ...Array.from({ length: 10 }, (_, i) => ({ dir: `~/.c${i}` })),
    ] });
    const { accounts, error } = parseAccounts(text, HOME, dryasIn(path.join(HOME, ".claude")));
    expect(error).toBeNull();
    expect(accounts.slice(0, 3)).toEqual([
      { dir: "~/.claude", label: "Team", dryas: true },
      { dir: "~/.claude-personal", label: "Pro", dryas: false },
      { dir: "~/.claude-lab", label: "claude-lab", dryas: false },
    ]);
    expect(accounts).toHaveLength(8);
  });
  it("bad JSON or no accounts array: default only, with an error to log", () => {
    for (const t of ["{bad", "null", "[]", '{"accounts":{}}']) {
      const r = parseAccounts(t, HOME, none);
      expect(r.accounts.map((a) => a.dir)).toEqual([DEFAULT_ACCT]);
      expect(r.error).not.toBeNull();
    }
  });
  it("an empty list: default only, no error", () => {
    expect(parseAccounts('{"accounts":[]}', HOME, none)).toEqual({ accounts: [{ dir: DEFAULT_ACCT, label: "claude", dryas: false }], error: null });
  });
});

describe("AccountsFile", () => {
  it("re-reads only when the file appears, changes or goes; reports list changes", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-acc-")), "accounts.json");
    const f = new AccountsFile(file, HOME, none);
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
