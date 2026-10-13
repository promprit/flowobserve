import { describe, expect, it } from "vitest";
import { baseModel, priceUsd } from "../src/pricing";

const U = (o: Partial<{ input: number; output: number; write5m: number; write1h: number; read: number }>) => ({ input: 0, output: 0, write5m: 0, write1h: 0, read: 0, ...o });

describe("pricing (prices as of 2026-10-13)", () => {
  it("strips [1m] and date suffixes", () => {
    expect(baseModel("claude-opus-5-5[1m]")).toBe("claude-opus-5-5");
    expect(baseModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });
  it("prices input, output, 5 min and 1 h writes, reads per million", () => {
    expect(priceUsd("claude-opus-5-5", U({ input: 1e6 }))).toBeCloseTo(4);
    expect(priceUsd("claude-opus-5-5", U({ output: 1e6 }))).toBeCloseTo(20);
    expect(priceUsd("claude-opus-5-5", U({ write5m: 1e6 }))).toBeCloseTo(5);
    expect(priceUsd("claude-opus-5-5", U({ write1h: 1e6 }))).toBeCloseTo(8);
    expect(priceUsd("claude-opus-5-5", U({ read: 1e6 }))).toBeCloseTo(0.2);
    expect(priceUsd("claude-sonnet-5-5", U({ input: 1e6, output: 1e6 }))).toBeCloseTo(12);
    expect(priceUsd("claude-haiku-4-5", U({ read: 1e6 }))).toBeCloseTo(0.1);
    expect(priceUsd("claude-fable-5-1", U({ input: 1e6, read: 1e6 }))).toBeCloseTo(10.25);
  });
  it("unknown model → null (never guessed)", () => {
    expect(priceUsd("claude-mystery-9", U({ input: 1e6 }))).toBeNull();
  });
  it("claude-haiku-5-5 low tier: prompt <= 100K tokens is $0.10 in / $0.50 out, read 0.1x, writes 1.25x / 2x", () => {
    expect(priceUsd("claude-haiku-5-5", U({ input: 50_000, output: 1e6 }))).toBeCloseTo(0.005 + 0.5);
    expect(priceUsd("claude-haiku-5-5", U({ input: 40_000, read: 30_000, write5m: 20_000, write1h: 10_000 }))).toBeCloseTo((40_000 * 0.1 + 30_000 * 0.01 + 20_000 * 0.125 + 10_000 * 0.2) / 1e6);
  });
  it("claude-haiku-5-5 high tier: prompt > 100K tokens is $0.50 in / $2.50 out; exactly 100_000 is still low", () => {
    expect(priceUsd("claude-haiku-5-5", U({ input: 100_000, output: 1e6 }))).toBeCloseTo(0.01 + 0.5);
    expect(priceUsd("claude-haiku-5-5", U({ input: 100_001, output: 1e6 }))).toBeCloseTo(100_001 * 0.5 / 1e6 + 2.5);
    expect(priceUsd("claude-haiku-5-5", U({ input: 10_000, read: 90_001, output: 1e6 }))).toBeCloseTo((10_000 * 0.5 + 90_001 * 0.05) / 1e6 + 2.5);
    expect(priceUsd("claude-haiku-5-5", U({ write5m: 60_000, write1h: 50_000 }))).toBeCloseTo((60_000 * 0.625 + 50_000 * 1) / 1e6);
  });
});
