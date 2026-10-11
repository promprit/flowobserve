import { describe, expect, it } from "vitest";
import { initState } from "../src/reducer";
import { type ClosedRow, Store } from "../src/store";

const row = (id: string, endedAt: number): ClosedRow =>
  ({ id, project: "/r/app", folder: "/r/app", endedAt, title: null });

describe("Store closed sessions", () => {
  it("round-trips a row and upsert replaces it by id", () => {
    const st = new Store(":memory:");
    st.closedUpsert({ ...row("a", 100), title: "first" });
    st.closedUpsert({ ...row("a", 200), title: "second" });
    expect(st.closedSince(0)).toEqual([{ ...row("a", 200), title: "second" }]);
  });
  it("deletes by id", () => {
    const st = new Store(":memory:");
    st.closedUpsert(row("a", 100));
    st.closedUpsert(row("b", 100));
    st.closedDelete("a");
    expect(st.closedSince(0).map((r) => r.id)).toEqual(["b"]);
  });
  it("closedSince keeps rows ended at or after the cut-off only", () => {
    const st = new Store(":memory:");
    st.closedUpsert(row("old", 99));
    st.closedUpsert(row("edge", 100));
    st.closedUpsert(row("new", 101));
    expect(st.closedSince(100).map((r) => r.id).sort()).toEqual(["edge", "new"]);
  });
});

describe("Store.loadSessions back-fill", () => {
  it("defaults the v2 fields when the saved state predates them", () => {
    const st = new Store(":memory:");
    const s = initState("s1", "/p/app", 1);
    st.saveSession(s);
    const old: Record<string, unknown> = { ...s };
    for (const k of ["term", "prompts", "lastEnd", "specPath", "planPath", "ready", "reviewDoneAt", "ranAt", "tryFound", "folderAbs"]) delete old[k];
    st.db.prepare("UPDATE sessions SET state_json = ? WHERE sid = ?").run(JSON.stringify(old), "s1");
    const [got] = st.loadSessions();
    expect(got).toMatchObject({
      term: null, prompts: 0, lastEnd: null, specPath: null, planPath: null,
      ready: null, reviewDoneAt: null, ranAt: null, tryFound: false, folderAbs: "/p/app",
    });
  });
});
