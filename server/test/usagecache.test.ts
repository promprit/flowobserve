import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUsageCache } from "../src/usagecache";

const raw = readFileSync(resolve(__dirname, "../../fixtures/usage-cache.json"), "utf8");
const base = () => JSON.parse(raw);
const parse = (o: unknown) => parseUsageCache(JSON.stringify(o));

describe("parseUsageCache", () => {
  it("parses the real-shape fixture", () => {
    expect(parseUsageCache(raw)).toEqual({
      fiveHour: { pct: 24, resetsAt: Date.parse("2026-10-03T15:10:00.683659+00:00") },
      sevenDay: { pct: 73, resetsAt: Date.parse("2026-10-04T10:00:00.755992+00:00") },
      fable: { pct: 31, resetsAt: Date.parse("2026-10-04T12:00:00+00:00") },
      at: 1791028012424,
    });
  });

  it("returns exactly the documented keys (no spend/extra_usage leak)", () => {
    const r = parseUsageCache(raw)!;
    expect(Object.keys(r).sort()).toEqual(["at", "fable", "fiveHour", "sevenDay"]);
    expect(Object.keys(r.fiveHour).sort()).toEqual(["pct", "resetsAt"]);
    expect(Object.keys(r.sevenDay!).sort()).toEqual(["pct", "resetsAt"]);
  });

  it("passes out-of-range utilization through unchanged", () => {
    const o = base();
    o.data.five_hour.utilization = 130;
    o.data.seven_day.utilization = -5;
    const r = parse(o)!;
    expect(r.fiveHour.pct).toBe(130);
    expect(r.sevenDay!.pct).toBe(-5);
  });

  it("returns null for invalid JSON", () => {
    expect(parseUsageCache("{nope")).toBeNull();
    expect(parseUsageCache("")).toBeNull();
  });

  it("returns null for non-object root", () => {
    for (const t of ["null", "42", '"x"', "[]", "true"]) expect(parseUsageCache(t)).toBeNull();
  });

  it("returns null for missing or non-finite fetchedAt", () => {
    const a = base(); delete a.fetchedAt;
    expect(parse(a)).toBeNull();
    const b = base(); b.fetchedAt = "1791028012424";
    expect(parse(b)).toBeNull();
    const c = base(); c.fetchedAt = null;
    expect(parse(c)).toBeNull();
    expect(parseUsageCache(raw.replace("1791028012424", "1e999"))).toBeNull();
  });

  it("returns null for missing data", () => {
    const o = base(); delete o.data;
    expect(parse(o)).toBeNull();
  });

  it("a cache without seven_day parses with sevenDay null", () => {
    const o = base(); delete o.data.seven_day;
    const r = parse(o)!;
    expect(r.fiveHour).toEqual({ pct: 24, resetsAt: Date.parse("2026-10-03T15:10:00.683659+00:00") });
    expect(r.sevenDay).toBeNull();
  });

  it("returns null for missing five_hour", () => {
    const a = base(); delete a.data.five_hour;
    expect(parse(a)).toBeNull();
  });

  it("returns null when five_hour utilization is not a finite number, and sevenDay null when seven_day's is not", () => {
    for (const v of ["24", null, undefined]) {
      const o = base(); o.data.five_hour.utilization = v;
      expect(parse(o)).toBeNull();
      const p = base(); p.data.seven_day.utilization = v;
      expect(parse(p)!.sevenDay).toBeNull();
      expect(parse(p)!.fiveHour.pct).toBe(24);
    }
  });

  it("returns null when five_hour resets_at is missing or unparseable, sevenDay null when seven_day's is", () => {
    const a = base(); delete a.data.five_hour.resets_at;
    expect(parse(a)).toBeNull();
    const b = base(); b.data.seven_day.resets_at = "not a date";
    expect(parse(b)!.sevenDay).toBeNull();
    const c = base(); c.data.five_hour.resets_at = 12345;
    expect(parse(c)).toBeNull();
  });

  it("reads the Fable weekly limit from data.limits", () => {
    expect(parseUsageCache(raw)!.fable).toEqual({ pct: 31, resetsAt: Date.parse("2026-10-04T12:00:00+00:00") });
  });

  it("finds Fable by display name, case-insensitive, not by index", () => {
    const o = base();
    o.data.limits.reverse();
    o.data.limits[1].scope.model.display_name = "FABLE";
    expect(parse(o)!.fable).toEqual({ pct: 31, resetsAt: Date.parse("2026-10-04T12:00:00+00:00") });
  });

  it("gives fable null when no Fable entry or no limits, without nulling the parse", () => {
    const a = base(); a.data.limits = a.data.limits.filter((l: any) => l.scope.model.display_name !== "Fable");
    expect(parse(a)).toMatchObject({ fable: null, fiveHour: { pct: 24 } });
    const b = base(); delete b.data.limits;
    expect(parse(b)).toMatchObject({ fable: null, sevenDay: { pct: 73 } });
  });

  it("gives fable null for malformed limits without nulling the parse", () => {
    for (const bad of ["x", 5, null, {}, [null, 3, "s", { scope: 1 }, { scope: { model: null } }],
      [{ percent: "31", resets_at: "2026-10-04T12:00:00+00:00", scope: { model: { display_name: "Fable" } } }],
      [{ percent: 31, resets_at: "nope", scope: { model: { display_name: "Fable" } } }]]) {
      const o = base(); o.data.limits = bad;
      expect(parse(o)).toMatchObject({ fable: null, fiveHour: { pct: 24 } });
    }
  });
});
