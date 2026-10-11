import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { Store } from "../src/store";

const FILE = path.resolve(__dirname, "../../fixtures/golden/2026-10-07-review.jsonl");
const hm = (t: number | null | undefined) => t == null ? null : new Date(t).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });

describe("review stage golden (session e87d0569, 2026-10-07, times UTC)", () => {
  const store = new Store(":memory:"), clock = { t: 0 };
  const engine = new Engine(store, () => clock.t);
  for (const l of fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean)) {
    const t = Date.parse(JSON.parse(l).ts); if (Number.isFinite(t)) clock.t = t;
    engine.ingestSpool(l);
  }
  const sid = [...engine.sessions.values()][0].id;
  const trans = store.transitionsFrom(0).filter((r) => r.sid === sid);
  const cycles = store.cyclesSince(0).filter((c) => c.sid === sid);
  const c2 = cycles.find((c) => hm(c.started) === "12:39")!;
  const story = cycles.filter((c) => ["12:05", "12:39"].includes(hm(c.started)!));

  it("enters Review at 12:24 via the wreview skill", () => {
    const first5 = trans.find((r) => r.toStage === 5);
    expect(hm(first5?.ts)).toBe("12:24");
    expect(first5?.cause).toBe("skill:wreview");
  });
  it("cycle 2: Build at 12:41, Review at 13:19 (ReviewLogged), fix tasks keep Review until the 13:57 commit", () => {
    expect(c2).toBeTruthy();
    const inCycle = trans.filter((r) => r.ts >= c2.started);
    expect(hm(inCycle.find((r) => r.toStage === 3)?.ts)).toBe("12:41");
    const rev = inCycle.find((r) => r.toStage === 5);
    expect(hm(rev?.ts)).toBe("13:19");
    expect(rev?.cause).toBe("ReviewLogged");
    const commitAt = Date.parse("2026-10-07T13:57:00Z");
    expect(inCycle.filter((r) => r.ts > rev!.ts && r.ts < commitAt + 60_000 && r.toStage < 5 && r.ts < commitAt)).toEqual([]);
  });
  it("4 review rounds across the two story cycles", () => {
    expect(story).toHaveLength(2);
    expect(story.reduce((n, c) => n + (c.reviews ?? 0), 0)).toBe(4);
  });
});
