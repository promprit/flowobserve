import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { jevSrc, testPython } from "./helpers";
import { AGENT_FILE, MAX_READ, TranscriptTailer, WARN_DEFAULT, ctxOf, ctxTokens, parseTranscriptLine, warnPctFrom, windowFor, type TItem, type TMsg } from "../src/transcript";

const FX = path.resolve(__dirname, "../../fixtures/transcript");
let root: string;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-tr-"))); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const copyFixture = () => {
  const proj = path.join(root, "-p");
  fs.cpSync(FX, proj, { recursive: true });
  return path.join(proj, "main.jsonl");
};
const collect = () => { const got: [string, TMsg, boolean][] = []; return { got, on: (items: TItem[]) => { for (const { sid, m, main } of items) got.push([sid, m, main]); } }; };

describe("parseTranscriptLine", () => {
  it("reads id, model and usage; splits 1 h and 5 min cache writes", () => {
    const m = parseTranscriptLine(fs.readFileSync(path.join(FX, "main.jsonl"), "utf8").split("\n")[1])!;
    expect(m).toEqual({ id: "m1", model: "claude-opus-5-5", usage: { input: 2, output: 300, write5m: 0, write1h: 60000, read: 20000 }, ts: null });
  });
  it("without a cache_creation breakdown, writes count as 5 min", () => {
    const m = parseTranscriptLine('{"type":"assistant","message":{"id":"x","model":"m","usage":{"input_tokens":1,"cache_creation_input_tokens":9,"cache_read_input_tokens":0,"output_tokens":1}}}')!;
    expect(m.usage).toMatchObject({ write5m: 9, write1h: 0 });
  });
  it("null for users, bad JSON, missing usage and all-zero (synthetic) usage", () => {
    expect(parseTranscriptLine('{"type":"user"}')).toBeNull();
    expect(parseTranscriptLine("{oops")).toBeNull();
    expect(parseTranscriptLine('{"type":"assistant","message":{"id":"x","model":"m"}}')).toBeNull();
    expect(parseTranscriptLine('{"type":"assistant","message":{"id":"x","model":"<synthetic>","usage":{"input_tokens":0,"output_tokens":0}}}')).toBeNull();
  });
});

describe("context math (same rule as context_watch.py)", () => {
  it("tokens = input + cache writes + cache reads", () => {
    expect(ctxTokens({ input: 5, output: 400, write5m: 1000, write1h: 0, read: 80000 })).toBe(81005);
  });
  it("window: env, else 1M for [1m], 1M models or past 200k, else 200k", () => {
    expect(windowFor("claude-opus-5-5", 10, "500000")).toBe(500_000);
    expect(windowFor("claude-opus-4-5[1m]", 10)).toBe(1_000_000);
    expect(windowFor("claude-opus-4-5", 200_001)).toBe(1_000_000);
    expect(windowFor("claude-opus-4-5", 200_000)).toBe(200_000);
    expect(windowFor("claude-opus-4-5", 10, "junk")).toBe(200_000);
  });
  it("window: model table, 1M for Fable/Mythos and Opus/Sonnet 4.6+", () => {
    for (const m of ["claude-fable-5-1", "claude-mythos-5-1", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-6", "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6"])
      expect(windowFor(m, 10), m).toBe(1_000_000);
    for (const m of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-opus-4-5-20251101", "claude-sonnet-4-5", "claude-opus-4-1", "claude-sonnet-4-20250514", "claude-3-opus-20240229", "claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219", "", "m"])
      expect(windowFor(m, 10), m).toBe(200_000);
  });
  it("levels at warn_pct and warn_pct + 0.05; pct clamps to 1", () => {
    expect(ctxOf(109_999, "m", 0, 0.55).level).toBe("ok");
    expect(ctxOf(110_000, "m", 0, 0.55)).toEqual({ pct: 0.55, tokens: 110_000, window: 200_000, level: "warn" });
    expect(ctxOf(120_000, "m", 0, 0.55).level).toBe("crit");
    expect(ctxOf(125_000, "m", 0, 0.6).level).toBe("warn");
    expect(ctxOf(1_200_000, "m", 0, 0.55).pct).toBe(1);
  });
  it("warn_pct from thresholds.json, else Jev's default 0.65", () => {
    expect(warnPctFrom('{"context":{"warn_pct":0.6}}')).toBe(0.6);
    for (const t of [null, "", "{bad", "{}", '{"context":{"warn_pct":"x"}}', '{"context":{"warn_pct":1.5}}']) expect(warnPctFrom(t)).toBe(0.65);
    expect(WARN_DEFAULT).toBe(0.65);
  });
  // Needs Jev's thresholds.py (FO_JEV_SRC, the Dryas plugin, or a legacy copy install); skipped where none is found.
  const src = jevSrc();
  it.skipIf(!src || !fs.existsSync(path.join(src, "thresholds.py")))("WARN_DEFAULT matches Dryas thresholds.py DEFAULTS.context.warn_pct", () => {
    const py = testPython();
    const out = execFileSync(py.cmd, [...py.pre, "-c", "import sys;sys.path.insert(0,sys.argv[1]);import thresholds as t;print(t.DEFAULTS['context']['warn_pct'])", src!], { encoding: "utf8" }).trim();
    expect(Number(out)).toBe(WARN_DEFAULT);
  });
});

describe("TranscriptTailer", () => {
  it("rejects paths outside the root or not .jsonl; same path twice is 'same'", () => {
    const t = new TranscriptTailer(root, () => {});
    const p = copyFixture();
    expect(t.watch("s", "/etc/hosts")).toBe("rejected");
    expect(t.watch("s", path.join(root, "x.txt"))).toBe("rejected");
    expect(t.watch("s", path.join(root, "-p", "..", "..", "evil.jsonl"))).toBe("rejected");
    expect(t.watch("s", p)).toBe("ok");
    expect(t.watch("s", p)).toBe("same");
  });
  it("emits each message once (dedupe), main and subagent files, skipping synthetic", () => {
    const c = collect(), t = new TranscriptTailer(root, c.on);
    t.watch("s", copyFixture());
    t.poll(); t.poll();
    expect(c.got.map(([, m, main]) => [m.id, main])).toEqual([["m1", true], ["m2", true], ["s1", false]]);
  });
  it("a partial last line waits for the next poll; appended lines arrive", () => {
    const c = collect(), t = new TranscriptTailer(root, c.on), p = copyFixture();
    t.watch("s", p); t.poll();
    const line = '{"type":"assistant","message":{"id":"m3","model":"claude-opus-5-5","usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":90000,"output_tokens":5}}}';
    fs.appendFileSync(p, line.slice(0, 40));
    t.poll();
    expect(c.got.some(([, m]) => m.id === "m3")).toBe(false);
    fs.appendFileSync(p, line.slice(40) + "\n");
    t.poll();
    expect(c.got.filter(([, m]) => m.id === "m3")).toHaveLength(1);
  });
  it("a truncated file restarts from 0 without double counting", () => {
    const c = collect(), t = new TranscriptTailer(root, c.on), p = copyFixture();
    t.watch("s", p); t.poll();
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").split("\n").slice(0, 2).join("\n") + "\n");
    t.poll();
    expect(c.got.filter(([, m]) => m.id === "m1")).toHaveLength(1);
  });
  it("reads at most MAX_READ bytes per file per poll and catches up", () => {
    const c = collect(), t = new TranscriptTailer(root, c.on), p = copyFixture();
    const filler = '{"type":"user","message":{"role":"user","pad":"' + "x".repeat(1000) + '"}}\n';
    fs.writeFileSync(p, filler.repeat(Math.ceil((MAX_READ * 1.5) / filler.length)) + fs.readFileSync(path.join(FX, "main.jsonl"), "utf8"));
    t.watch("s", p);
    t.poll();
    expect(c.got.filter(([, , main]) => main)).toHaveLength(0);
    t.poll();
    expect(c.got.filter(([, , main]) => main).map(([, m]) => m.id)).toEqual(["m1", "m2"]);
  });
  it("a multi-byte char split at the read boundary is not corrupted", () => {
    const c = collect(), p = copyFixture();
    const line = '{"type":"assistant","message":{"id":"u1","model":"claude-ไทย-🙂","usage":{"input_tokens":1,"output_tokens":1}}}\n';
    fs.writeFileSync(p, line);
    const at = Buffer.from(line).indexOf(Buffer.from("ไ")) + 1; // one byte into a 3-byte char
    const t = new TranscriptTailer(root, c.on, { maxRead: at });
    t.watch("s", p);
    for (let i = 0; i < 20 && !c.got.length; i++) t.poll();
    expect(c.got.map(([, m]) => m.model)).toEqual(["claude-ไทย-🙂"]);
  });
  it("timestamp: ISO -> ms; invalid or missing -> null", () => {
    const rec = (ts?: unknown) => JSON.stringify({ type: "assistant", ...(ts === undefined ? {} : { timestamp: ts }), message: { id: "x", model: "m", usage: { input_tokens: 1 } } });
    expect(parseTranscriptLine(rec("2026-10-03T03:00:00.000Z"))!.ts).toBe(Date.parse("2026-10-03T03:00:00.000Z"));
    expect(parseTranscriptLine(rec("nope"))!.ts).toBeNull();
    expect(parseTranscriptLine(rec(12))!.ts).toBeNull();
    expect(parseTranscriptLine(rec())!.ts).toBeNull();
  });
  it("one poll hands every new message to the consumer in a single batch", () => {
    const batches: number[] = [], t = new TranscriptTailer(root, (items) => batches.push(items.length));
    t.watch("s", copyFixture());
    t.poll(); t.poll();
    expect(batches).toEqual([3]);
  });
  it("missing file: no throw, no messages; forget stops reading", () => {
    const c = collect(), t = new TranscriptTailer(root, c.on);
    const p = path.join(root, "-p", "gone.jsonl");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "");
    t.watch("s", p);
    fs.rmSync(p);
    expect(() => t.poll()).not.toThrow();
    t.forget("s");
    expect(() => t.poll()).not.toThrow();
    expect(c.got).toEqual([]);
  });

  it("tags subagent messages with the agent id from the file name", () => {
    const items: TItem[] = [], t = new TranscriptTailer(root, (b) => items.push(...b));
    t.watch("s", copyFixture());
    t.poll();
    expect(items.map((i) => [i.m.id, i.agent])).toEqual([["m1", null], ["m2", null], ["s1", "a1"]]);
  });
});

describe("AGENT_FILE", () => {
  it("takes the agent id from posix and Windows paths", () => {
    expect(AGENT_FILE.exec("/a/b/subagents/agent-a1.jsonl")?.[1]).toBe("a1");
    expect(AGENT_FILE.exec("C:\\Users\\dev\\.claude\\projects\\x\\s\\subagents\\agent-a1.jsonl")?.[1]).toBe("a1");
    expect(AGENT_FILE.exec("C:\\x\\notagent-a1.jsonl")).toBeNull();
  });
});

describe("subagent meta files", () => {
  const metaDir = (main: string) => path.join(main.slice(0, -".jsonl".length), "subagents");
  it("onMeta gets only {agentId, useId}, once across polls", () => {
    const main = copyFixture();
    const metas: unknown[] = [];
    const t = new TranscriptTailer(root, () => {}, { onMeta: (_sid: string, m: unknown) => metas.push(m) });
    expect(t.watch("s1", main)).toBe("ok");
    t.poll(); t.poll();
    expect(metas).toEqual([{ agentId: "a1", useId: "toolu_A1" }]);
  });
  it("retries a partial meta file on the next poll once it is complete", () => {
    const main = copyFixture();
    const f = path.join(metaDir(main), "agent-b2.meta.json");
    fs.writeFileSync(f, '{"agentType":"exec');
    const metas: unknown[] = [];
    const t = new TranscriptTailer(root, () => {}, { onMeta: (_sid: string, m: unknown) => metas.push(m) });
    t.watch("s1", main);
    t.poll();
    expect(metas).toEqual([{ agentId: "a1", useId: "toolu_A1" }]);
    fs.writeFileSync(f, '{"agentType":"executor","toolUseId":"toolu_B2"}');
    t.poll(); t.poll();
    expect(metas).toEqual([{ agentId: "a1", useId: "toolu_A1" }, { agentId: "b2", useId: "toolu_B2" }]);
  });
  it("a meta file that parses but has no valid toolUseId is read once, not every poll", () => {
    const main = copyFixture();
    const f = path.join(metaDir(main), "agent-c3.meta.json");
    fs.writeFileSync(f, '{"agentType":"executor"}');
    const t = new TranscriptTailer(root, () => {}, { onMeta: () => {} });
    t.watch("s1", main);
    const reads = () => vi.mocked(fs.readFileSync).mock.calls.filter((c) => String(c[0]) === f).length;
    const spy = vi.spyOn(fs, "readFileSync");
    try {
      t.poll(); t.poll(); t.poll();
      expect(reads()).toBe(1);
    } finally { spy.mockRestore(); }
  });
});
