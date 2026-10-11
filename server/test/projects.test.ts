import { describe, expect, it } from "vitest";
import { type FsLike, nameColor, peacock, runSpec, scanProjects, withPicks } from "../src/projects";

/** In-memory FsLike. Value "dir" = explicit directory; any parent of a key is a directory too. */
function memFs(m: Record<string, string | "dir">, opts: { throwOn?: string } = {}): FsLike {
  const isDir = (p: string) => m[p] === "dir" || Object.keys(m).some((k) => k.startsWith(p + "/"));
  return {
    readdir(p) {
      if (p === opts.throwOn) throw new Error("EACCES");
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

describe("scanProjects", () => {
  it("scans projects, groups and worktrees", () => {
    const fs = memFs({
      "/r/meadow/.git": "dir",
      "/r/meadow/.vscode/settings.json": '{"peacock.color": "#D7DCC5", // c\n}',
      "/r/dryas/.vscode/settings.json": '{"peacock.color": "#0ccd8d"}',
      "/r/dryas/site/.git": "dir",
      "/r/dryas/quarry/.git": "dir",
      "/r/.hidden/.git": "dir",
      "/r/_caches/.git": "dir",
    });
    const scan = scanProjects("/r", fs);
    expect(scan.rootMissing).toBe(false);
    expect(scan.projects.map((p) => p.key)).toEqual(["dryas", "dryas/quarry", "dryas/site", "meadow"]);
    const [, side, site, brew] = scan.projects;
    expect(brew.name).toBe("meadow");
    expect(brew.group).toBeNull();
    expect(brew.color).toBe("#D7DCC5");
    expect(side.group).toBe("dryas");
    expect(site.group).toBe("dryas");
    expect(side.color).toBe("#0ccd8d");
    expect(site.color).toBe("#0ccd8d");
  });

  it("returns the group folder itself as a project", () => {
    const fs = memFs({
      "/r/dryas/.vscode/settings.json": '{"peacock.color": "#0ccd8d"}',
      "/r/dryas/site/.git": "dir",
      "/r/dryas/quarry/.git": "dir",
    });
    const g = scanProjects("/r", fs).projects.find((p) => p.key === "dryas");
    expect(g).toBeDefined();
    expect(g).toMatchObject({ name: "dryas", group: "dryas", color: "#0ccd8d", abs: "/r/dryas" });
    expect(g?.folders).toEqual([{ abs: "/r/dryas", rel: "dryas", worktree: null }]);
  });

  it("a non-git directory without child repos is a plain project", () => {
    const fs = memFs({ "/r/notes/readme.md": "hi", "/r/notes/sub/file.txt": "x" });
    const ps = scanProjects("/r", fs).projects;
    expect(ps.map((p) => p.key)).toEqual(["notes"]);
    expect(ps[0].plain).toBe(true);
  });

  it("lists linked worktrees inside the root, drops ones outside", () => {
    const fs = memFs({
      "/r/meadow/.git/worktrees/fix-s2/gitdir": "/r/meadow/.claude/worktrees/fix-s2/.git\n",
      "/r/meadow/.git/worktrees/away/gitdir": "/elsewhere/away/.git\n",
      "/r/meadow/.claude/worktrees/fix-s2": "dir",
    });
    const [p] = scanProjects("/r", fs).projects;
    expect(p.folders[0]).toMatchObject({ abs: "/r/meadow", rel: "meadow", worktree: null });
    expect(p.folders).toHaveLength(2);
    expect(p.folders[1]).toEqual({
      abs: "/r/meadow/.claude/worktrees/fix-s2",
      rel: "meadow/.claude/worktrees/fix-s2",
      worktree: "fix-s2",
    });
  });

  it("reports a missing root", () => {
    expect(scanProjects("/nope", memFs({}))).toEqual({ rootMissing: true, projects: [] });
  });

  it("skips a project whose readdir throws and returns the others", () => {
    const fs = memFs(
      { "/r/bad/.git": "dir", "/r/good/.git": "dir", "/r/also/.git": "dir" },
      { throwOn: "/r/bad" },
    );
    expect(scanProjects("/r", fs).projects.map((p) => p.key)).toEqual(["also", "good"]);
  });
});

describe("peacock and nameColor", () => {
  it("peacock returns null for invalid input and bad colours", () => {
    expect(peacock("not json")).toBeNull();
    expect(peacock(null)).toBeNull();
    expect(peacock('{"peacock.color":"red"}')).toBeNull();
  });
  it("peacock strips comments and trailing commas", () => {
    expect(peacock('{\n // a\n "peacock.color": "#AbCdEf", /* b */\n}')).toBe("#AbCdEf");
  });
  it("nameColor is stable lower-case hex, pinned literal", () => {
    expect(nameColor("ember")).toMatch(/^#[0-9a-f]{6}$/);
    expect(nameColor("ember")).toBe(nameColor("ember"));
    expect(nameColor("ember")).toBe("#698cd3");
  });
});

describe("runSpec", () => {
  const P = "/r/app";
  it("uses .flowobserve/run", () => {
    const fs = memFs({ [`${P}/.flowobserve/run`]: '{"cmd":["xcodebuild","build"],"url":"http://localhost:8080"}' });
    expect(runSpec(P, fs)).toEqual({ cmd: ["xcodebuild", "build"], url: "http://localhost:8080" });
  });
  it("empty cmd gives null", () => {
    expect(runSpec(P, memFs({ [`${P}/.flowobserve/run`]: '{"cmd":[]}' }))).toBeNull();
  });
  it("non-local url is dropped, cmd kept", () => {
    const fs = memFs({ [`${P}/.flowobserve/run`]: '{"cmd":["go","run"],"url":"http://evil.com"}' });
    expect(runSpec(P, fs)).toEqual({ cmd: ["go", "run"], url: null });
  });
  const pkg = '{"scripts":{"dev":"vite"}}';
  it("package.json dev script follows the lockfile", () => {
    expect(runSpec(P, memFs({ [`${P}/package.json`]: pkg, [`${P}/pnpm-lock.yaml`]: "" }))?.cmd).toEqual(["pnpm", "dev"]);
    expect(runSpec(P, memFs({ [`${P}/package.json`]: pkg, [`${P}/package-lock.json`]: "{}" }))?.cmd).toEqual(["npm", "run", "dev"]);
  });
  it("no lockfile or invalid package.json gives null", () => {
    expect(runSpec(P, memFs({ [`${P}/package.json`]: pkg }))).toBeNull();
    expect(runSpec(P, memFs({ [`${P}/package.json`]: "{nope", [`${P}/pnpm-lock.yaml`]: "" }))).toBeNull();
  });
});

describe("scanProjects hardening", () => {
  it("drops a worktree whose directory no longer exists", () => {
    const fs = memFs({
      "/r/app/.git/worktrees/gone/gitdir": "/r/app/.claude/worktrees/gone/.git\n",
      "/r/app/.git/worktrees/here/gitdir": "/r/app/.claude/worktrees/here/.git\n",
      "/r/app/.claude/worktrees/here": "dir",
    });
    const [p] = scanProjects("/r", fs).projects;
    expect(p.folders.map((f) => f.worktree)).toEqual([null, "here"]);
  });

  it("builds every abs from the realpath of a symlinked root", () => {
    const base = memFs({
      "/real/app/.git": "dir",
      "/real/app/.git/worktrees/w/gitdir": "/real/app/.claude/worktrees/w/.git\n",
      "/real/app/.claude/worktrees/w": "dir",
    });
    const fs: FsLike = {
      ...base,
      isDir: (p) => base.isDir(p.replace(/^\/link/, "/real")),
      exists: (p) => base.exists(p.replace(/^\/link/, "/real")),
      readdir: (p) => base.readdir(p.replace(/^\/link/, "/real")),
      read: (p) => base.read(p.replace(/^\/link/, "/real")),
      realpath: (p) => p.replace(/^\/link/, "/real"),
    };
    const [p] = scanProjects("/link", fs).projects;
    expect(p.abs).toBe("/real/app");
    expect(p.folders.map((f) => f.abs)).toEqual(["/real/app", "/real/app/.claude/worktrees/w"]);
    expect(p.folders[1].rel).toBe("app/.claude/worktrees/w");
  });
});

describe("peacock JSONC", () => {
  it("a /* inside a string does not swallow the rest", () => {
    expect(peacock('{"search.exclude": {"**/*.map": true}, "peacock.color": "#ff0000", "files.watcherExclude": {"**/.git/objects/**": true}}')).toBe("#ff0000");
  });
  it("still strips real comments", () => {
    expect(peacock('{/* c */ "peacock.color": "#ff0000", // x\n "a": "http://x" }')).toBe("#ff0000");
  });
});

describe("scanProjects direct mode", () => {
  // root /Dev contains projects/ (no .git, but its children are repos) and app/ (a repo)
  const fs = memFs({
    "/Dev/app/.git": "dir",
    "/Dev/projects/alpha/.git": "dir",
    "/Dev/projects/beta/.git": "dir",
  });

  it("lists only direct repos and forms no group", () => {
    const scan = scanProjects("/Dev", fs, { direct: true });
    expect(scan.projects.map((p) => p.key)).toEqual(["app"]);
    expect(scan.projects.every((p) => p.group === null)).toBe(true);
  });

  it("default mode still forms a group from projects/", () => {
    const scan = scanProjects("/Dev", fs);
    expect(scan.projects.some((p) => p.group === "projects")).toBe(true);
  });

  it("missing root is reported, not thrown", () => {
    const scan = scanProjects("/nope", fs, { direct: true });
    expect(scan.rootMissing).toBe(true);
  });
});

describe("scanProjects direct mode plain folders", () => {
  const fs = memFs({
    "/Dev/app/.git": "dir",
    "/Dev/notes/readme.md": "hi",
    "/Dev/.hidden/x.txt": "x",
    "/Dev/_archive/x.txt": "x",
  });

  it("direct mode lists plain folders with plain true", () => {
    const scan = scanProjects("/Dev", fs, { direct: true });
    const byKey = new Map(scan.projects.map((p) => [p.key, p]));
    expect([...byKey.keys()].sort()).toEqual(["app", "notes"]);
    expect((byKey.get("notes") as { plain?: boolean }).plain).toBe(true);
    expect((byKey.get("app") as { plain?: boolean }).plain).toBeFalsy();
  });

  it("hidden and underscore folders are not listed", () => {
    const keys = scanProjects("/Dev", fs, { direct: true }).projects.map((p) => p.key);
    expect(keys).not.toContain(".hidden");
    expect(keys).not.toContain("_archive");
  });

  it("plain folders form no group", () => {
    const scan = scanProjects("/Dev", fs, { direct: true });
    expect(scan.projects.every((p) => p.group === null)).toBe(true);
  });
});

describe("scanProjects containers holding a repo below", () => {
  const nested = { "/Dev/Clients/Acme/site/.git": "dir", "/Dev/Clients/Acme/notes.md": "x", "/Dev/app/.git": "dir" };

  it("default mode: a folder with a repo two levels down is not listed", () => {
    const keys = scanProjects("/Dev", memFs(nested)).projects.map((p) => p.key);
    expect(keys).toEqual(["app"]);
  });

  it("direct mode: a folder with a repo two levels down is not listed", () => {
    const keys = scanProjects("/Dev", memFs(nested), { direct: true }).projects.map((p) => p.key);
    expect(keys).toEqual(["app"]);
  });

  it("a plain folder with no repos below still lists as plain", () => {
    const fs = memFs({ "/Dev/notes/a/b/c.txt": "x" });
    for (const direct of [false, true]) {
      const ps = scanProjects("/Dev", fs, { direct }).projects;
      expect(ps.map((p) => p.key)).toEqual(["notes"]);
      expect(ps[0].plain).toBe(true);
    }
  });
});

describe("scanProjects default mode plain folders", () => {
  const fs = memFs({
    "/Dev/app/.git": "dir",
    "/Dev/notes/readme.md": "hi",
    "/Dev/dryas/site/.git": "dir",
    "/Dev/dryas/side/.git": "dir",
  });

  it("lists a folder without git children as plain, keeps groups", () => {
    const scan = scanProjects("/Dev", fs);
    const byKey = new Map(scan.projects.map((p) => [p.key, p]));
    expect((byKey.get("app") as { plain?: boolean }).plain).toBeFalsy();
    expect((byKey.get("notes") as { plain?: boolean }).plain).toBe(true);
    expect(byKey.get("dryas")?.group).toBe("dryas");
    expect(byKey.has("dryas/site")).toBe(true);
    expect(byKey.has("dryas/side")).toBe(true);
    expect((byKey.get("dryas") as { plain?: boolean }).plain).toBeFalsy();
  });
});

describe("withPicks", () => {
  const fs = memFs({
    "/r/meadow/.git": "dir",
    "/r/meadow/.vscode/settings.json": '{"peacock.color": "#D7DCC5"}',
    "/r/plain/.git": "dir",
    "/r/dryas/site/.git": "dir",
    "/r/dryas/quarry/.git": "dir",
    "/r/dryas/quarry/.vscode/settings.json": '{"peacock.color": "#0ccd8d"}',
  });
  const scan = () => scanProjects("/r", fs).projects;
  const col = (ps: ReturnType<typeof scan>, k: string) => ps.find((p) => p.key === k)!.color;

  it("no picks leaves colours unchanged", () => {
    expect(withPicks(scan(), {}).map((p) => p.color)).toEqual(scan().map((p) => p.color));
  });
  it("a pick beats Peacock and the name hash", () => {
    const ps = withPicks(scan(), { meadow: "#e06c75", plain: "#61afef" });
    expect(col(ps, "meadow")).toBe("#e06c75");
    expect(col(ps, "plain")).toBe("#61afef");
  });
  it("a group pick colours the group row and members without own pick or Peacock", () => {
    const ps = withPicks(scan(), { dryas: "#98c379" });
    expect(col(ps, "dryas")).toBe("#98c379");
    expect(col(ps, "dryas/site")).toBe("#98c379");
    expect(col(ps, "dryas/quarry")).toBe("#0ccd8d");
  });
  it("a member pick beats the group pick", () => {
    expect(col(withPicks(scan(), { dryas: "#98c379", "dryas/site": "#c678dd" }), "dryas/site")).toBe("#c678dd");
  });
  it("worktree folders share their project's colour (one colour per project)", () => {
    const ps = withPicks(scan(), { meadow: "#e06c75" });
    expect(ps.find((p) => p.key === "meadow")!.folders.length).toBeGreaterThan(0);
    expect(col(ps, "meadow")).toBe("#e06c75");
  });
  it("a picked project carries base: Peacock, group pick/Peacock, or name hash; unpicked has none", () => {
    const ps = withPicks(scan(), { meadow: "#e06c75", "dryas/site": "#c678dd", "dryas/quarry": "#61afef", plain: "#98c379", dryas: "#e5c07b" });
    const base = (k: string) => ps.find((p) => p.key === k)!.base;
    expect(base("meadow")).toBe("#D7DCC5");
    expect(base("dryas/site")).toBe("#e5c07b");
    expect(base("dryas/quarry")).toBe("#0ccd8d");
    expect(base("plain")).toBe(nameColor("plain"));
    expect("base" in withPicks(scan(), {}).find((p) => p.key === "meadow")!).toBe(false);
    expect("base" in withPicks(scan(), { plain: nameColor("plain") }).find((p) => p.key === "plain")!).toBe(false);
  });
});
