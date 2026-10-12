import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectsMsg, Session } from "@fo/shared";
import { DAY_MS } from "../src/config";
import { Engine } from "../src/engine";
import type { FsLike } from "../src/projects";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const ITERM = { entry: "cli", program: "iTerm.app", iterm: "w0t0p1:1B2C3D4E-0000-4000-8000-00000000ABCD" };
const TOKEN = "ab".repeat(32);

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
const tree = (): Record<string, string | "dir"> => ({
  "/r/app/.git": "dir",
  "/r/app/.vscode/settings.json": '{"peacock.color": "#151a60"}',
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fo-v2-"));

function setup(opts: { db?: string; files?: Record<string, string | "dir"> } = {}) {
  const store = new Store(opts.db ?? ":memory:");
  const clock = { t: at(10) };
  const e = new Engine(store, () => clock.t);
  const files = opts.files ?? tree();
  const helperJson = path.join(tmp(), "helper.json");
  (e as unknown as { helperJson: string }).helperJson = helperJson;
  const projects: ProjectsMsg[] = [];
  const sessions: Session[] = [];
  e.out = { projects: (m) => projects.push(m), session: (s) => sessions.push(s) };
  e.setProjectsRoot("/r", memFs(files));
  return { store, clock, e, files, helperJson, projects, sessions };
}
const restoreIds = (e: Engine) => e.projectsMsg()!.projects[0].folders[0].restore.map((r) => r.id);

describe("Engine v2 restore list", () => {
  it("a window-closed session becomes restorable and leaves on resume", () => {
    const { e } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2), m.endR(3, "other")]) e.ingestSpool(l);
    expect(e.projectsMsg()!.projects[0].folders[0].restore.map((r) => r.id)).toEqual([m.sid]);
    e.ingestSpool(m.startT(4, ITERM));
    const f = e.projectsMsg()!.projects[0].folders[0];
    expect(f.restore).toEqual([]);
    expect(f.live).toBe(m.sid);
  });

  it("reason clear is not restorable", () => {
    const { e } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2), m.endR(3, "clear")]) e.ingestSpool(l);
    expect(restoreIds(e)).toEqual([]);
  });

  it("a session with zero prompts is not restorable", () => {
    const { e } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.endR(3, "other")]) e.ingestSpool(l);
    expect(restoreIds(e)).toEqual([]);
  });

  it("drops a session that ended 8 days ago", () => {
    const { e, clock } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2), m.endR(3, "other")]) e.ingestSpool(l);
    expect(restoreIds(e)).toEqual([m.sid]);
    clock.t = at(3) + 8 * DAY_MS;
    expect(restoreIds(e)).toEqual([]);
  });

  it("a session silent since before the Mac booted is closed and restorable", () => {
    const { e } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2)]) e.ingestSpool(l);
    e.machineBootAt = at(5);
    e.tick();
    expect(e.snapshot().sessions.map((s) => s.id)).toEqual([]);
    expect(restoreIds(e)).toEqual([m.sid]);
    e.ingestSpool(m.startT(6, ITERM));
    expect(e.snapshot().sessions.map((s) => s.id)).toEqual([m.sid]);
    expect(restoreIds(e)).toEqual([]);
  });

  it("a session active after boot stays live", () => {
    const { e } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(6)]) e.ingestSpool(l);
    e.machineBootAt = at(5);
    e.tick();
    expect(e.snapshot().sessions.map((s) => s.id)).toEqual([m.sid]);
  });

  it("survives a new Engine on the same store file", () => {
    const db = path.join(tmp(), "fo.db");
    const a = setup({ db });
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2), m.endR(3, "other")]) a.e.ingestSpool(l);
    const b = setup({ db });
    b.e.load();
    b.e.rescan();
    expect(restoreIds(b.e)).toEqual([m.sid]);
  });
});

describe("Engine v2 colour and runnable", () => {
  it("fills color and runnable=false on the snapshot session", () => {
    const { e } = setup();
    e.ingestSpool(mk({ cwd: "/r/app" }).prompt(1));
    expect(e.snapshot().sessions[0]).toMatchObject({ color: "#151a60", runnable: false });
  });

  it("runnable follows runSpec", () => {
    const { e } = setup({ files: { ...tree(), "/r/app/package.json": '{"scripts":{"dev":"vite"}}', "/r/app/pnpm-lock.yaml": "x" } });
    e.ingestSpool(mk({ cwd: "/r/app" }).prompt(1));
    expect(e.snapshot().sessions[0]).toMatchObject({ color: "#151a60", runnable: true });
  });

  it("without a root there is no projects message, colour null and runnable false", () => {
    const e = new Engine(new Store(":memory:"), () => at(10));
    e.ingestSpool(mk({ cwd: "/r/app" }).prompt(1));
    expect(e.projectsMsg()).toBeNull();
    expect(e.snapshot().sessions[0]).toMatchObject({ color: null, runnable: false });
  });
});

describe("Engine v2 helper token", () => {
  it("equals the 64-hex token in helper.json and is re-read on rescan", () => {
    const { e, helperJson } = setup();
    expect(e.projectsMsg()!.token).toBeNull();
    fs.writeFileSync(helperJson, JSON.stringify({ root: "/r", token: TOKEN }));
    e.rescan();
    expect(e.projectsMsg()!.token).toBe(TOKEN);
  });

  it.each([
    ["malformed json", "{nope"],
    ["not 64 hex", JSON.stringify({ token: "abc123" })],
    ["uppercase / non-hex", JSON.stringify({ token: "Z".repeat(64) })],
    ["token not a string", JSON.stringify({ token: 5 })],
  ])("is null for %s", (_n, body) => {
    const { e, helperJson } = setup();
    fs.writeFileSync(helperJson, body);
    e.rescan();
    expect(e.projectsMsg()!.token).toBeNull();
  });

  it("never appears in the snapshot or any session message", () => {
    const { e, helperJson, sessions } = setup();
    fs.writeFileSync(helperJson, JSON.stringify({ token: TOKEN }));
    e.rescan();
    expect(e.projectsMsg()!.token).toBe(TOKEN);
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2), m.endR(3, "other")]) e.ingestSpool(l);
    e.flush(true);
    expect(sessions.length).toBeGreaterThan(0);
    expect(JSON.stringify(e.snapshot())).not.toContain(TOKEN);
    expect(JSON.stringify(sessions)).not.toContain(TOKEN);
  });
});

describe("Engine v2 rescan", () => {
  it("root removed then rescan gives rootMissing and out.projects fires once", () => {
    const { e, files, projects } = setup();
    expect(e.projectsMsg()!.rootMissing).toBe(false);
    projects.length = 0;
    for (const k of Object.keys(files)) delete files[k];
    e.rescan();
    expect(e.projectsMsg()).toMatchObject({ rootMissing: true, projects: [] });
    expect(projects).toHaveLength(1);
    e.rescan();
    expect(projects).toHaveLength(1);
  });
});

describe("Engine v2 cached scan", () => {
  it("SessionSeen updates live without reading the filesystem again", () => {
    const { e, files, projects } = setup();
    const base = memFs(files);
    let reads = 0;
    e.setProjectsRoot("/r", { ...base, readdir: (p) => { reads++; return base.readdir(p); } });
    reads = 0;
    projects.length = 0;
    const m = mk({ cwd: "/r/app" });
    e.ingestSpool(m.startT(1, ITERM));
    e.ingestSpool(m.prompt(2));
    expect(reads).toBe(0);
    expect(e.projectsMsg()!.projects[0].folders[0].live).toBe(m.sid);
    expect(projects.length).toBeGreaterThan(0);
  });
});

describe("Engine v2 helper rows without a sid", () => {
  it("an empty-sid run row resolved by cwd sets ranAt on the live session there", () => {
    const { e, clock } = setup();
    const m = mk({ cwd: "/r/app" });
    for (const l of [m.startT(1, ITERM), m.prompt(2)]) e.ingestSpool(l);
    const row = JSON.parse(m.helper(3, "run", true));
    row.cwd = "/r/app";
    e.ingestSpool(JSON.stringify(row));
    expect(e.sessions.get(m.sid)!.ranAt).toBe(at(3));
    void clock;
  });
});

describe("Engine v2 worktree sessions", () => {
  it("worktree session gets project colour and runnable", () => {
    const files = {
      ...tree(),
      "/r/app/package.json": '{"scripts":{"dev":"x"}}',
      "/r/app/pnpm-lock.yaml": "",
      "/r/app/.git/worktrees/feat/gitdir": "/r/wt/feat/.git\n",
      "/r/wt/feat": "dir" as const,
    };
    const { e } = setup({ files });
    const m = mk({ cwd: "/r/wt/feat" });
    for (const l of [m.startT(1, ITERM), m.prompt(2)]) e.ingestSpool(l);
    const w = e.snapshot().sessions.find((s) => s.id === m.sid)!;
    expect(w.color).toBe("#151a60");
    expect(w.runnable).toBe(true);
  });
});

describe("Engine v2 group folder", () => {
  it("a group folder never takes its members' sessions and owns sessions closed in it", () => {
    const files = {
      "/r/dryas/CLAUDE.md": "x",
      "/r/dryas/site/.git": "dir" as const,
      "/r/dryas/site/.vscode/settings.json": '{"peacock.color": "#151a60"}',
      "/r/dryas/quarry/.git": "dir" as const,
    };
    const { e } = setup({ files });
    const live = mk({ cwd: "/r/dryas/site" });
    const closed = mk({ sid: "s2", cwd: "/r/dryas" });
    for (const l of [live.startT(1, ITERM), live.prompt(2)]) e.ingestSpool(l);
    for (const l of [closed.startT(3, ITERM), closed.prompt(4), closed.endR(5, "other")]) e.ingestSpool(l);
    const folders = e.projectsMsg()!.projects.flatMap((p) => p.folders);
    const group = folders.find((f) => f.rel === "dryas")!;
    const site = folders.find((f) => f.rel === "dryas/site")!;
    expect(site.live).toBe(live.sid);
    expect(site.restore).toEqual([]);
    expect(group.live).not.toBe(live.sid);
    expect(group.restore.map((r) => r.id)).toEqual([closed.sid]);
    const siteColor = e.projectsMsg()!.projects.find((p) => p.folders.some((f) => f.rel === "dryas/site"))!.color;
    const groupColor = e.projectsMsg()!.projects.find((p) => p.folders.some((f) => f.rel === "dryas"))!.color;
    const s = e.snapshot().sessions.find((x) => x.id === live.sid)!;
    expect(s.color).toBe("#151a60");
    expect(s.color).toBe(siteColor);
    expect(s.color).not.toBe(groupColor);
  });
});

describe("Engine v2 createRoots", () => {
  function engineWith(files: Record<string, string | "dir">, helper: object) {
    const s = setup({ files });
    fs.writeFileSync(s.helperJson, JSON.stringify(helper));
    s.e.setProjectsRoot("/p", memFs(files));
    return s.e;
  }

  it("extra createRoots appear as label-keyed projects and carry their root label", () => {
    const e = engineWith({ "/p/app/.git": "dir", "/d/tool/.git": "dir" }, { root: "/p", token: "a".repeat(64),
      createRoots: [{ label: "projects", path: "/p" }, { label: "Dev", path: "/d" }] });
    const m = e.projectsMsg()!;
    expect(m.projects.map((p) => p.key).sort()).toEqual(["Dev:tool", "app"]);
    const tool = m.projects.find((p) => p.key === "Dev:tool")!;
    expect(tool.folders[0].root).toBe("Dev");
    expect(m.projects.find((p) => p.key === "app")!.folders[0].root ?? null).toBeNull();
    expect(m.createRoots).toEqual([
      { label: "projects", path: "/p", exists: true },
      { label: "Dev", path: "/d", exists: true },
    ]);
  });

  it("an unplugged extra root is listed as not existing and scans nothing", () => {
    const e = engineWith({ "/p/app/.git": "dir" }, { root: "/p", token: "a".repeat(64),
      createRoots: [{ label: "projects", path: "/p" }, { label: "Dev", path: "/gone" }] });
    const m = e.projectsMsg()!;
    expect(m.projects.map((p) => p.key)).toEqual(["app"]);
    expect(m.createRoots!.find((r) => r.label === "Dev")!.exists).toBe(false);
  });

  it("session in Dev:<name> gets project colour and runnable", () => {
    const files = { "/p/app/.git": "dir" as const, "/d/tool/.git": "dir" as const,
      "/d/tool/.vscode/settings.json": '{"peacock.color": "#151a60"}',
      "/d/tool/package.json": '{"scripts":{"dev":"x"}}', "/d/tool/pnpm-lock.yaml": "" };
    const e = engineWith(files, { root: "/p", token: "a".repeat(64),
      createRoots: [{ label: "projects", path: "/p" }, { label: "Dev", path: "/d" }] });
    const m = mk({ cwd: "/d/tool" });
    for (const l of [m.startT(1, ITERM), m.prompt(2)]) e.ingestSpool(l);
    const s = e.snapshot().sessions.find((x) => x.id === m.sid)!;
    expect(s.color).toBe("#151a60");
    expect(s.runnable).toBe(true);
  });

  it("createRoots path is realpath", () => {
    const files = { "/p/app/.git": "dir" as const, "/d/tool/.git": "dir" as const };
    const s = setup({ files });
    fs.writeFileSync(s.helperJson, JSON.stringify({ root: "/p", token: "a".repeat(64),
      createRoots: [{ label: "projects", path: "/p" }, { label: "Dev", path: "/link/d" }] }));
    const base = memFs(files);
    const real: Record<string, string> = { "/p": "/real/p", "/link/d": "/d" };
    s.e.setProjectsRoot("/p", { ...base, exists: (p) => p in real || base.exists(p), isDir: (p) => p in real || base.isDir(p),
      readdir: (p) => base.readdir(real[p] === "/d" ? "/d" : p), realpath: (p) => real[p] ?? base.realpath(p) });
    expect(s.e.projectsMsg()!.createRoots!.map((r) => r.path)).toEqual(["/real/p", "/d"]);
  });

  it("createRoots paths are posix on a Windows root (native realpath)", () => {
    const files = { "C:/Users/dev/src/app/.git": "dir" as const, "D:/Dev/tool/.git": "dir" as const };
    const s = setup({ files });
    const SRC = "C:\\Users\\dev\\src", DEV = "D:\\Dev";
    fs.writeFileSync(s.helperJson, JSON.stringify({ root: SRC, token: "a".repeat(64),
      createRoots: [{ label: "projects", path: SRC }, { label: "Dev", path: DEV }] }));
    const base = memFs(files);
    const native = (p: string) => p.replace(/\//g, "\\");
    const real: Record<string, string> = { [SRC]: "C:/Users/dev/src", [DEV]: "D:/Dev" };
    s.e.setProjectsRoot(SRC, { ...base, exists: (p) => p in real || base.exists(p), isDir: (p) => p in real || base.isDir(p),
      readdir: (p) => base.readdir(real[p] ?? p), realpath: (p) => (real[p] ? native(real[p]) : base.realpath(p)) });
    const m = s.e.projectsMsg()!;
    // createRootsOf keeps an extra root only if path.isAbsolute (native) accepts it: D:\Dev only on Windows.
    const win = process.platform === "win32";
    expect(m.createRoots!.map((r) => r.path)).toEqual(win ? ["C:/Users/dev/src", "D:/Dev"] : ["C:/Users/dev/src"]);
    expect(m.token).toBe("a".repeat(64));
    expect(m.projects.map((p) => p.key).sort()).toEqual(win ? ["Dev:tool", "app"] : ["app"]);
  });

  it("helper.json without createRoots keeps the old message shape", () => {
    const e = engineWith({ "/p/app/.git": "dir" }, { root: "/p", token: "a".repeat(64) });
    const m = e.projectsMsg()!;
    expect(m.createRoots).toEqual([{ label: "projects", path: "/p", exists: true }]);
    expect(m.projects.map((p) => p.key)).toEqual(["app"]);
  });
});

describe("Engine v2 plain folders", () => {
  it("projects message marks plain folders", () => {
    const files = { "/r/app/.git": "dir" as const, "/r/notes/readme.txt": "hi" };
    const { e } = setup({ files });
    const projects = e.projectsMsg()!.projects as Array<{ key: string; plain?: boolean }>;
    expect(projects.map((p) => p.key).sort()).toEqual(["app", "notes"]);
    expect(projects.find((p) => p.key === "notes")!.plain).toBe(true);
    expect(projects.find((p) => p.key === "app")!.plain ?? false).toBe(false);
  });
});
