import { describe, expect, it } from "vitest";
import { clock, coarseFmt, dur, esc, fmtMs, hms, pct, quant, runFmt, safeOpenUrl } from "../src/util";
import { T0 } from "./helpers";

describe("util", () => {
  it("formats durations, clock times and latencies like the prototype", () => {
    expect(dur(65_000)).toBe("01:05");
    expect(dur(3_725_000)).toBe("1:02:05");
    expect(dur(-5)).toBe("00:00");
    expect(hms(3_725_000)).toBe("01:02:05");
    expect(clock(T0)).toBe("10:00");
    expect(fmtMs(null)).toBe("—");
    expect(fmtMs(850)).toBe("850ms");
    expect(fmtMs(1500)).toBe("1.5s");
    expect(fmtMs(12_400)).toBe("12s");
  });

  it("escapes markup and computes ratios", () => {
    expect(esc(`<b a="1">&`)).toBe("&lt;b a=&quot;1&quot;&gt;&amp;");
    expect(esc(null)).toBe("");
    expect(pct(1, 3)).toBe(33);
    expect(pct(1, 0)).toBe(0);
    expect(quant([5, 1, 3], 0.5)).toBe(3);
    expect(quant([], 0.5)).toBeNull();
  });

  it("only vscode://file/ links are safe to open", () => {
    expect(safeOpenUrl("vscode://file/x")).toBe("vscode://file/x");
    expect(safeOpenUrl("javascript:alert(1)")).toBeNull();
    expect(safeOpenUrl("http://x")).toBeNull();
    expect(safeOpenUrl("vscode://other")).toBeNull();
    expect(safeOpenUrl(null)).toBeNull();
    expect(safeOpenUrl(undefined)).toBeNull();
  });

  it("formats run and coarse durations", () => {
    expect(runFmt(42_000)).toBe("42s");
    expect(runFmt(252_000)).toBe("4m 12s");
    expect(runFmt(63_000)).toBe("1m 03s");
    expect(runFmt(3_900_000)).toBe("1h 05m");
    expect(runFmt(-5)).toBe("0s");
    expect(coarseFmt(30_000)).toBe("<1m");
    expect(coarseFmt(360_000)).toBe("6m");
    expect(coarseFmt(3_900_000)).toBe("1h 05m");
  });
});
