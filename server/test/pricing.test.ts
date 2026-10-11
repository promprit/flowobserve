import { describe, expect, it } from "vitest";
import { baseModel, priceUsd } from "../src/pricing";

const U = (o: Partial<{ input: number; output: number; write5m: number; write1h: number; read: number }>) => ({ input: 0, output: 0, write5m: 0, write1h: 0, read: 0, ...o });

describe("pricing (prices as of 2026-09-25)", () => {
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
});
