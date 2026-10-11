import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { UsageCachePoller } from "../src/usagepoll";

const FIXTURE = path.resolve(__dirname, "../../fixtures/usage-cache.json");
let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-usagepoll-"));
  file = path.join(dir, "usage-cache.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("UsageCachePoller", () => {
  it("mtime change triggers exactly one update", () => {
    fs.copyFileSync(FIXTURE, file);
    const onUsage = vi.fn();
    const p = new UsageCachePoller(file, onUsage);
    p.check();
    expect(onUsage).toHaveBeenCalledTimes(1);
    p.check();
    expect(onUsage).toHaveBeenCalledTimes(1);
    const next = fs.readFileSync(FIXTURE, "utf8").replace('"utilization": 24', '"utilization": 30');
    fs.writeFileSync(file, next);
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(file, t, t);
    p.check();
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it("missing file: no calls, no throw", () => {
    const onUsage = vi.fn();
    const p = new UsageCachePoller(path.join(dir, "nope.json"), onUsage);
    expect(() => p.check()).not.toThrow();
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("malformed then fixed with same mtime: one update", () => {
    fs.writeFileSync(file, "{not json");
    const t = new Date(Date.now() - 5000);
    fs.utimesSync(file, t, t);
    const onUsage = vi.fn();
    const p = new UsageCachePoller(file, onUsage);
    p.check();
    expect(onUsage).not.toHaveBeenCalled();
    fs.copyFileSync(FIXTURE, file);
    fs.utimesSync(file, t, t);
    p.check();
    expect(onUsage).toHaveBeenCalledTimes(1);
  });

  it("throwing onUsage propagates and is retried with same mtime", () => {
    fs.copyFileSync(FIXTURE, file);
    const onUsage = vi.fn().mockImplementationOnce(() => { throw new Error("boom"); });
    const p = new UsageCachePoller(file, onUsage);
    expect(() => p.check()).toThrow("boom");
    p.check();
    expect(onUsage).toHaveBeenCalledTimes(2);
    p.check();
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it("malformed JSON: no calls, no throw", () => {
    fs.writeFileSync(file, "{not json");
    const onUsage = vi.fn();
    const p = new UsageCachePoller(file, onUsage);
    expect(() => p.check()).not.toThrow();
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe("loadConfig usageCachePath", () => {
  it("FO_USAGE_CACHE overrides", () => {
    expect(loadConfig({ ...process.env, FO_USAGE_CACHE: "/x/y.json" }).usageCachePath).toBe("/x/y.json");
  });
  it("defaults to ~/.claude/usage-cache.json", () => {
    const env = { ...process.env };
    delete env.FO_USAGE_CACHE;
    const p = loadConfig(env).usageCachePath;
    expect(p.endsWith(path.join(".claude", "usage-cache.json"))).toBe(true);
  });
  it("FO_DISKS sets the host disks, default System only", () => {
    expect(loadConfig({ ...process.env, FO_DISKS: "/x:X" }).disks).toEqual([{ path: "/x", label: "X" }]);
    const env = { ...process.env };
    delete env.FO_DISKS;
    if (process.platform === "win32") expect(loadConfig(env).disks).toEqual([{ path: "C:\\", label: "System" }]);
    else expect(loadConfig(env).disks.map((d) => d.label)).toEqual(["System"]);
  });
  it("transcripts, handoff dir and thresholds default under ~/.claude and honour env", () => {
    const c = loadConfig({ ...process.env, FO_TRANSCRIPTS: "/t", JEV_HANDOFF_DIR: "/h", FO_THRESHOLDS: "/th.json" });
    expect([c.transcriptsRoot, c.handoffDir, c.thresholdsPath]).toEqual(["/t", "/h", "/th.json"]);
  });
});
