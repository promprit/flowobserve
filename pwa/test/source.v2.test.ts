import { beforeEach, describe, expect, it } from "vitest";
import { ingest, parse } from "../src/source";
import { store } from "../src/state";
import { reset } from "./helpers";

beforeEach(() => { reset(); Object.assign(store, { projects: [], rootMissing: false, helperToken: null }); });

describe("projects message", () => {
  it("parse() then ingest sets projects, rootMissing and the helper token", () => {
    const projects = [{ key: "a", name: "a", group: null, color: "#aabbcc", folders: [{ rel: "a", worktree: null, live: null, restore: [] }] }];
    const token = "b".repeat(64);
    const m = parse(JSON.stringify({ type: "projects", rootMissing: true, token, projects }));
    expect(m).not.toBeNull();
    ingest(m!);
    expect(store.projects).toEqual(projects);
    expect(store.rootMissing).toBe(true);
    expect(store.helperToken).toBe(token);
  });

  it("defaults are empty, present and no token", () => {
    expect(store.projects).toEqual([]);
    expect(store.rootMissing).toBe(false);
    expect(store.helperToken).toBeNull();
  });

  it("a null token clears the helper token", () => {
    store.helperToken = "c".repeat(64);
    ingest(parse(JSON.stringify({ type: "projects", rootMissing: false, token: null, projects: [] }))!);
    expect(store.helperToken).toBeNull();
  });
});
