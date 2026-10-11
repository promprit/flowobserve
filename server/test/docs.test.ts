import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { readDoc } from "../src/docs";
import { createServer } from "../src/http";
import { Store } from "../src/store";
import { toPosix } from "@fo/shared";
import { at, mk } from "./helpers";

/** Windows without Developer Mode refuses symlinks (EPERM); those cases are skipped there. */
const canSymlink = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fo-ln-"));
  try { fs.symlinkSync(__filename, path.join(d, "x")); return true; } catch { return false; }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
})();

let root: string, app: string;
let close: (() => void) | null = null;
afterEach(() => { close?.(); close = null; });

const w = (rel: string, body: string) => {
  const f = path.join(app, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
};

let plan: string, spec: string, orch: string, notes: string, big: string, evil: string, txt: string;
beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-docs-")));
  app = path.join(root, "app");
  plan = w("docs/superpowers/plans/p.md", "# plan\n");
  spec = w("docs/superpowers/specs/s-design.md", "# spec\n");
  orch = w(".orchestrate/PLAN.md", "# orchestrate plan\n");
  notes = w("notes/x.md", "# notes\n");
  big = w("docs/superpowers/plans/big.md", "x".repeat(600 * 1024));
  txt = w("docs/superpowers/plans/a.txt", "text");
  evil = path.join(app, "docs/superpowers/plans/evil.md");
  if (canSymlink) fs.symlinkSync("/etc/hosts", evil);
});

const sess = (o: { specPath?: string | null; planPath?: string | null } = {}) => ({ cwd: app, folderAbs: app, specPath: spec, planPath: plan, ...o });

describe("readDoc", () => {
  it("serves the session plan and nothing else", () => {
    expect(readDoc(sess(), "plan")).toEqual({ status: 200, body: { path: "docs/superpowers/plans/p.md", markdown: "# plan\n", mtime: fs.statSync(plan).mtimeMs } });
    expect(readDoc(sess(), "spec")).toMatchObject({ status: 200, body: { path: "docs/superpowers/specs/s-design.md", markdown: "# spec\n" } });
    expect(readDoc(sess(), "evil")).toEqual({ status: 404 });
  });

  it("falls back to .orchestrate/PLAN.md when planPath is null", () => {
    expect(readDoc(sess({ planPath: null }), "plan")).toMatchObject({ status: 200, body: { path: ".orchestrate/PLAN.md", markdown: "# orchestrate plan\n" } });
  });

  it.skipIf(!canSymlink)("refuses a symlink out of the project, files outside the doc dirs, non-markdown", () => {
    expect(readDoc(sess({ planPath: evil }), "plan")).toEqual({ status: 404 });
    expect(readDoc(sess({ planPath: notes }), "plan")).toEqual({ status: 404 });
    expect(readDoc(sess({ planPath: txt }), "plan")).toEqual({ status: 404 });
    expect(readDoc(sess({ planPath: path.join(app, "docs/superpowers/plans/missing.md") }), "plan")).toEqual({ status: 404 });
  });

  it("a fifo named .md is refused without blocking", () => {
    const fifo = path.join(app, "docs/superpowers/pipe.md");
    try { execFileSync("mkfifo", [fifo]); } catch { return; } // mkfifo unavailable: skip
    // Run in a child with a hard timeout: a blocking open() would otherwise freeze this worker.
    const out = path.join(root, "docs.cjs");
    buildSync({ entryPoints: [path.resolve(__dirname, "../src/docs.ts")], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
    const script = `const {readDoc}=require(${JSON.stringify(out)});process.stdout.write(JSON.stringify(readDoc({cwd:${JSON.stringify(app)},specPath:${JSON.stringify(fifo)}},"spec")))`;
    const res = execFileSync(process.execPath, ["-e", script], { timeout: 3000, killSignal: "SIGKILL" }).toString();
    expect(JSON.parse(res)).toEqual({ status: 404 });
  }, 10000);

  it("answers 413 for a file over 512 KB", () => {
    expect(readDoc(sess({ planPath: big }), "plan")).toEqual({ status: 413 });
  });

  it("serves a spec written in a sibling git worktree of the session's repo, not an unregistered folder", () => {
    const wt = path.join(root, "app-feature");
    const wtSpec = path.join(wt, "docs/superpowers/specs/f-design.md");
    fs.mkdirSync(path.dirname(wtSpec), { recursive: true });
    fs.writeFileSync(wtSpec, "# feature spec\n");
    fs.mkdirSync(path.join(app, ".git/worktrees/app-feature"), { recursive: true });
    fs.writeFileSync(path.join(app, ".git/worktrees/app-feature/gitdir"), path.join(wt, ".git") + "\n");
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(app, ".git/worktrees/app-feature")}\n`);
    expect(readDoc(sess({ specPath: wtSpec }), "spec")).toMatchObject({ status: 200, body: { path: "docs/superpowers/specs/f-design.md", markdown: "# feature spec\n" } });

    const stray = path.join(root, "other/docs/superpowers/specs/x-design.md");
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, "# not ours\n");
    expect(readDoc(sess({ specPath: stray }), "spec")).toEqual({ status: 404 });
  });
});

describe("/api/doc", () => {
  async function start() {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "fo-docs-web-"));
    fs.writeFileSync(path.join(dist, "index.html"), "x");
    const engine = new Engine(new Store(":memory:"), () => at(10));
    engine.ingestSpool(mk({ sid: "s1", cwd: app }).pre(1, "Skill", { skill: "writing-plans" }));
    const s = engine.sessions.get("s1")!;
    s.planPath = plan;
    s.specPath = spec;
    s.folderAbs = app;
    const { server } = createServer(engine, dist, {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    close = () => server.close();
    return { engine, port };
  }
  const get = (port: number, p: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      }).on("error", reject);
    });

  it("serves a plan with no-store, rejects a foreign origin, 404s unknown input", async () => {
    const { port } = await start();
    const r = await get(port, "/api/doc?session=s1&kind=plan");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(r.body)).toMatchObject({ path: "docs/superpowers/plans/p.md", markdown: "# plan\n" });
    expect((await get(port, "/api/doc?session=s1&kind=plan", { origin: "http://evil.com" })).status).toBe(403);
    expect((await get(port, "/api/doc?session=nope&kind=plan")).status).toBe(404);
    expect((await get(port, "/api/doc?session=s1&kind=evil")).status).toBe(404);
  });
});

it.runIf(process.platform === "win32")("serves the plan for a forward-slash Windows cwd", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-docwin-"));
  try {
    fs.mkdirSync(path.join(dir, ".orchestrate"));
    fs.writeFileSync(path.join(dir, ".orchestrate", "PLAN.md"), "# plan\n");
    const r = readDoc({ cwd: toPosix(dir) }, "plan");
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body.path).toBe(".orchestrate/PLAN.md");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
