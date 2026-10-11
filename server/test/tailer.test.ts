import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Store } from "../src/store";
import { pruneSpool, Tailer } from "../src/tailer";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fo-tail-"));
const SPOOL = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function setup() {
  const dir = tmp();
  const store = new Store(":memory:");
  const got: string[] = [];
  const t = new Tailer(store, [{ dir, match: SPOOL, onLine: (_f, l) => got.push(l) }]);
  return { dir, store, got, t };
}

describe("Tailer", () => {
  it("skips a file that vanishes between stat and open, and still runs after()", () => {
    const dir = tmp();
    const store = new Store(":memory:");
    const got: string[] = [];
    let afterRuns = 0;
    const t = new Tailer(store, [{ dir, match: SPOOL, onLine: (_f, l) => got.push(l) }], () => afterRuns++);
    const gone = path.join(dir, "2026-10-03.jsonl");
    fs.writeFileSync(gone, "lost\n");
    fs.writeFileSync(path.join(dir, "2026-10-04.jsonl"), "kept\n");
    const real = fs.openSync;
    const spy = vi.spyOn(fs, "openSync").mockImplementation(((f: fs.PathLike, ...rest: unknown[]) => {
      if (f === gone) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return (real as (...a: unknown[]) => number)(f, ...rest);
    }) as typeof fs.openSync);
    try { t.pollOnce(); } finally { spy.mockRestore(); }
    expect(got).toEqual(["kept"]);
    expect(afterRuns).toBe(1);
    t.pollOnce();
    expect(got).toEqual(["kept", "lost"]);
  });
  it("delivers complete lines only and finishes a half-written line later", () => {
    const { dir, got, t } = setup();
    const f = path.join(dir, "2026-10-03.jsonl");
    fs.writeFileSync(f, "a\nb\nhal");
    t.pollOnce();
    expect(got).toEqual(["a", "b"]);
    fs.appendFileSync(f, "f\n");
    t.pollOnce();
    expect(got).toEqual(["a", "b", "half"]);
  });
  it("follows midnight rotation in name order", () => {
    const { dir, got, t } = setup();
    fs.writeFileSync(path.join(dir, "2026-10-03.jsonl"), "late\n");
    t.pollOnce();
    fs.writeFileSync(path.join(dir, "2026-10-04.jsonl"), "next-day\n");
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored\n");
    t.pollOnce();
    expect(got).toEqual(["late", "next-day"]);
  });
  it("restarts a file that shrank", () => {
    const { dir, got, t } = setup();
    const f = path.join(dir, "2026-10-03.jsonl");
    fs.writeFileSync(f, "one\ntwo\n");
    t.pollOnce();
    fs.writeFileSync(f, "new\n");
    t.pollOnce();
    expect(got).toEqual(["one", "two", "new"]);
  });
  it("skips a throwing handler without stalling", () => {
    const dir = tmp();
    const store = new Store(":memory:");
    const got: string[] = [];
    const t = new Tailer(store, [{ dir, match: SPOOL, onLine: (_f, l) => { if (l === "bad") throw new Error("x"); got.push(l); } }]);
    fs.writeFileSync(path.join(dir, "2026-10-03.jsonl"), "bad\ngood\n");
    t.pollOnce();
    t.pollOnce();
    expect(got).toEqual(["good"]);
    expect(t.errors).toBe(1);
  });
  it("tolerates a missing directory", () => {
    const store = new Store(":memory:");
    const t = new Tailer(store, [{ dir: "/nonexistent/fo", match: SPOOL, onLine: () => {} }]);
    expect(() => t.pollOnce()).not.toThrow();
  });
});

describe("pruneSpool", () => {
  it("removes files older than the retention window and their offsets", () => {
    const dir = tmp();
    const store = new Store(":memory:");
    for (const d of ["2026-09-18", "2026-09-19", "2026-10-03"]) fs.writeFileSync(path.join(dir, `${d}.jsonl`), "x\n");
    store.setOffset(path.join(dir, "2026-09-18.jsonl"), 2);
    const removed = pruneSpool(store, dir, new Date("2026-10-03T10:00:00").getTime(), 14);
    expect(removed).toEqual(["2026-09-18.jsonl"]);
    expect(fs.readdirSync(dir).sort()).toEqual(["2026-09-19.jsonl", "2026-10-03.jsonl"]);
    expect(store.getOffset(path.join(dir, "2026-09-18.jsonl"))).toBe(0);
  });
});
