import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectsMsg, Session } from "@fo/shared";
import { MsgZ } from "@fo/shared";
import { Engine } from "../src/engine";
import type { FsLike } from "../src/projects";
import { nameColor } from "../src/projects";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

function memFs(m: Record<string, string | "dir">): FsLike {
  const isDir = (p: string) => m[p] === "dir" || Object.keys(m).some((k) => k.startsWith(p + "/"));
  return {
    readdir(p) {
      const pre = p.endsWith("/") ? p : p + "/";
      const names = new Set<string>();
      for (const k of Object.keys(m)) if (k.startsWith(pre)) names.add(k.slice(pre.length).split("/")[0]);
      return [...names];
    },
    isDir,
    exists: (p) => p in m || isDir(p),
    read: (p) => (typeof m[p] === "string" && m[p] !== "dir" ? m[p] : null),
    realpath: (p) => (p in m || isDir(p) ? p : null),
  };
}
const ITERM = { entry: "cli", program: "iTerm.app", iterm: "w0t0p1:1B2C3D4E-0000-4000-8000-00000000ABCD" };
const files = { "/r/app/.git": "dir" as const, "/r/app/.vscode/settings.json": '{"peacock.color": "#151a60"}', "/r/bare/.git": "dir" as const };

function setup(store = new Store(":memory:"), createRoots?: { label: string; path: string }[], fsys: FsLike = memFs(files)) {
  const e = new Engine(store, () => at(10));
  const helperJson = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-col-")), "helper.json");
  if (createRoots) fs.writeFileSync(helperJson, JSON.stringify({ createRoots }));
  (e as unknown as { helperJson: string }).helperJson = helperJson;
  const projects: ProjectsMsg[] = [], sessions: Session[] = [];
  e.out = { projects: (m) => projects.push(m), session: (s) => sessions.push(s) };
  e.setProjectsRoot("/r", fsys);
  return { e, store, projects, sessions };
}
const colorOf = (e: Engine, key: string) => e.projectsMsg()!.projects.find((p) => p.key === key)!.color;

describe("Engine.setColor", () => {
  it("stores a palette pick, pushes projects, and beats Peacock", () => {
    const { e, store, projects } = setup();
    expect(e.setColor("app", "#e06c75")).toBe(true);
    expect(colorOf(e, "app")).toBe("#e06c75");
    expect(projects.at(-1)!.projects.find((p) => p.key === "app")!.color).toBe("#e06c75");
    expect(JSON.parse(store.kvGet("colors")!)).toEqual({ app: "#e06c75" });
  });
  it("reset falls back to Peacock, then name hash", () => {
    const { e } = setup();
    e.setColor("app", "#e06c75"); e.setColor("bare", "#61afef");
    e.setColor("app", null); e.setColor("bare", null);
    expect(colorOf(e, "app")).toBe("#151a60");
    expect(colorOf(e, "bare")).toBe(nameColor("bare"));
  });
  it("rejects non-palette colours and unknown keys", () => {
    const { e } = setup();
    expect(e.setColor("app", "#123456")).toBe(false);
    expect(e.setColor("app", "#E06C75")).toBe(false);
    expect(e.setColor("nope/deep", "#e06c75")).toBe(false);
    expect(e.setColor("Other:x", "#e06c75")).toBe(false);
    expect(e.setColor("../x", "#e06c75")).toBe(false);
  });
  it("accepts a pending new-project key under a known root", () => {
    const { e } = setup(new Store(":memory:"), [{ label: "projects", path: "/r" }, { label: "Dev", path: "/d" }]);
    expect(e.setColor("fresh", "#e06c75")).toBe(true);
    expect(e.setColor("Dev:fresh", "#e06c75")).toBe(true);
  });
  it("survives a restart and ignores a corrupt colors value", () => {
    const store = new Store(":memory:");
    store.kvSet("colors", "not json");
    const { e } = setup(store);
    expect(colorOf(e, "app")).toBe("#151a60");
    store.kvSet("colors", JSON.stringify({ app: "#e06c75", bare: "#123456", x: 5 }));
    const { e: e2 } = setup(store);
    expect(colorOf(e2, "app")).toBe("#e06c75");
    expect(colorOf(e2, "bare")).toBe(nameColor("bare"));
  });
  it("re-pushes a live session card with the new colour", () => {
    const { e, sessions } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2)]) e.ingestSpool(l);
    e.setColor("app", "#c678dd");
    expect(sessions.filter((s) => s.id === m.sid).at(-1)!.color).toBe("#c678dd");
  });
  it("setColor does not rescan the filesystem", () => {
    const inner = memFs(files);
    let reads = 0;
    const { e } = setup(new Store(":memory:"), undefined, { ...inner, readdir: (p) => (reads++, inner.readdir(p)) });
    const before = reads;
    expect(before).toBeGreaterThan(0);
    e.setColor("app", "#e06c75"); e.setColor("app", null); e.setColor("bare", "#61afef");
    expect(reads).toBe(before);
    expect(colorOf(e, "bare")).toBe("#61afef");
  });
  it("projects message carries base for a picked project and parses", () => {
    const { e, projects } = setup();
    e.setColor("app", "#e06c75");
    const m = projects.at(-1)!;
    expect(m.projects.find((p) => p.key === "app")!.base).toBe("#151a60");
    expect(m.projects.find((p) => p.key === "bare")!.base).toBeUndefined();
    MsgZ.parse(m);
  });
});
