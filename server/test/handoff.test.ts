import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RESTORE_MS, RootCache, gitRoot, handoffKey, handoffSavedAt } from "../src/handoff";
import { jevSrc, testPython } from "./helpers";

describe("handoffKey (same rule as handoff_paths.py)", () => {
  it("sanitised basename (max 48) + first 12 hex of sha256(root)", () => {
    const h = (r: string) => crypto.createHash("sha256").update(r).digest("hex").slice(0, 12);
    expect(handoffKey("/Users/dev/code/flowobserve")).toBe(`flowobserve-${h("/Users/dev/code/flowobserve")}`);
    expect(handoffKey("/x/my app.v2")).toBe(`my_app_v2-${h("/x/my app.v2")}`);
    expect(handoffKey("/x/" + "a".repeat(60))).toBe(`${"a".repeat(48)}-${h("/x/" + "a".repeat(60))}`);
    expect(handoffKey("/")).toBe(`root-${h("/")}`);
  });
  // Needs Jev's handoff_paths.py (FO_JEV_SRC, the Dryas plugin, or a legacy copy install); skipped where none is found.
  const jevDir = jevSrc() ?? path.join(os.homedir(), ".claude", "jev");
  it.skipIf(!fs.existsSync(path.join(jevDir, "handoff_paths.py")))("matches handoff_paths.py for this repo (worktrees map to the main repo root)", async () => {
    const here = path.resolve(__dirname, "../..");
    const py = testPython();
    const out = execFileSync(py.cmd, [...py.pre, "-c",
      "import sys;sys.path.insert(0,sys.argv[2]);import handoff_paths as h;print(h.key_for(sys.argv[1]))",
      here, jevDir], { encoding: "utf8" }).trim();
    const root = (await gitRoot(fs.realpathSync(here))) ?? fs.realpathSync(here);
    expect(handoffKey(root)).toBe(out);
  });
});

describe("RootCache", () => {
  it("asks git once per cwd, falls back to realpath, keeps at most 64 entries", async () => {
    const run = vi.fn(async (cwd: string) => (cwd.includes("wt") ? "/repo" : null));
    const c = new RootCache(run, 2);
    expect(await c.get("/repo/.claude/worktrees/wt")).toBe("/repo");
    expect(await c.get("/repo/.claude/worktrees/wt")).toBe("/repo");
    expect(run).toHaveBeenCalledTimes(1);
    expect(await c.get(os.tmpdir())).toBe(fs.realpathSync(os.tmpdir()));
    await c.get("/a"); await c.get("/b");
    await c.get("/repo/.claude/worktrees/wt");
    expect(run).toHaveBeenCalledTimes(5); // evicted, asked again
  });
});

describe("handoffSavedAt", () => {
  it("mtime when saved < 30 min ago, else null; missing file → null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-ho-"));
    const root = "/x/app", f = path.join(dir, handoffKey(root) + ".md");
    expect(handoffSavedAt(dir, root, Date.now())).toBeNull();
    fs.writeFileSync(f, "x");
    const m = fs.statSync(f).mtimeMs;
    expect(handoffSavedAt(dir, root, m + 1000)).toBe(m);
    expect(handoffSavedAt(dir, root, m + RESTORE_MS + 1)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
