import type { TUsage } from "./transcript";

/** API-equivalent prices per million tokens (spec §9.3). Frozen: prices as of 2026-10-13 from claude-api skill (cached 2026-10-06); never auto-updated.
 *  Cache writes: 1.25x input (5 min), 2x (1 h). 1M context has no long-context premium on these models. */
export const PRICES_AS_OF = "2026-10-13";
interface Price { input: number; output: number; write5m: number; write1h: number; read: number }
const P = (input: number, output: number, read: number): Price => ({ input, output, write5m: input * 1.25, write1h: input * 2, read });
const PRICES: Record<string, Price> = {
  "claude-opus-5-5": P(4, 20, 0.2),
  "claude-sonnet-5-5": P(2, 10, 0.2),
  "claude-haiku-4-5": P(1, 5, 0.1),
  "claude-fable-5-1": P(10, 50, 0.25),
};

/** Haiku 5.5 is tiered by the request's prompt size (input + cache reads + cache writes): <= 100K tokens low, above high. */
const HAIKU_5_5_TIER = 100_000;
const HAIKU_5_5 = { low: P(0.1, 0.5, 0.01), high: P(0.5, 2.5, 0.05) };

export const baseModel = (model: string): string => model.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");

export function priceUsd(model: string, u: TUsage): number | null {
  const base = baseModel(model);
  const prompt = u.input + u.read + u.write5m + u.write1h;
  const p = base === "claude-haiku-5-5" ? (prompt <= HAIKU_5_5_TIER ? HAIKU_5_5.low : HAIKU_5_5.high) : PRICES[base];
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.write5m * p.write5m + u.write1h * p.write1h + u.read * p.read) / 1e6;
}
