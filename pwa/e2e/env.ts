import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PORT = 4399;
// Playwright loads the config in the runner and again in each worker: keep one HOME for all loads.
process.env.FO_E2E_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), "fo-e2e-"));
export const HOME: string = process.env.FO_E2E_HOME;
const spoolDir = path.join(HOME, "spool");
fs.mkdirSync(spoolDir, { recursive: true });
fs.mkdirSync(path.join(HOME, "jev"), { recursive: true });

const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
export const SPOOL = path.join(spoolDir, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.jsonl`);

export const PROJECTS = path.join(HOME, "projects");
const TR = path.join(PROJECTS, "-tmp-fo-e2e-app", "s-app.jsonl");
fs.mkdirSync(path.dirname(TR), { recursive: true });
if (!fs.existsSync(TR)) fs.writeFileSync(TR,
  '{"type":"assistant","message":{"id":"e1","model":"claude-opus-5-5","usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":84000,"output_tokens":10}}}\n');

export function line(sid: string, cwd: string, event: string, payload: Record<string, unknown> = {}, term?: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, ts: new Date().toISOString(), src: "hook", sid, cwd, event, ...(term ? { term } : {}),
    payload: { session_id: sid, cwd, hook_event_name: event, ...payload } }) + "\n";
}

export const APP = "/tmp/fo-e2e/app";
const WEB = "/tmp/fo-e2e/web";
if (!fs.existsSync(SPOOL)) fs.writeFileSync(SPOOL, [
  line("s-app-0001", APP, "SessionStart", { source: "startup", transcript_path: TR }),
  line("s-app-0001", APP, "PreToolUse", { tool_name: "Skill", tool_input: { skill: "superpowers:writing-plans" } }),
  line("s-app-0001", APP, "PostToolUse", { tool_name: "Write", tool_input: { file_path: `${APP}/docs/superpowers/plans/p.md` }, tool_response: {}, fo: { planTasks: 3 } }),
  line("s-app-0001", APP, "Stop", { fo: { say: "Plan ready · 3 tasks" } }),
  line("s-web", WEB, "SessionStart", { source: "startup" }),
  line("s-web", WEB, "PreToolUse", { tool_name: "Skill", tool_input: { skill: "superpowers:brainstorming" } }),
].join(""));

// v2 fixtures live on a second server (own home, own spool) so the iTerm2 sessions and the projects root
// leave the v1 board, its page order and its visual snapshots untouched.
export const V2_PORT = 4398;
export const V2_HOME = path.join(HOME, "v2");
const V2_PROJECTS = path.join(V2_HOME, "projects");
export const V2_TRANSCRIPTS = path.join(V2_HOME, "transcripts");
const mk = (rel: string, body?: string) => {
  const f = path.join(V2_PROJECTS, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (body !== undefined) fs.writeFileSync(f, body);
};
fs.mkdirSync(path.join(V2_HOME, "spool"), { recursive: true });
fs.mkdirSync(path.join(V2_HOME, "jev"), { recursive: true });
fs.mkdirSync(V2_TRANSCRIPTS, { recursive: true });
for (const r of ["app", "plan", "ship", "jump", "dryas/quarry", "dryas/site"]) mk(`${r}/.git/HEAD`, "ref: refs/heads/main\n");
mk("app/.vscode/settings.json", '{"peacock.color":"#151a60"}');
mk("plan/docs/superpowers/plans/p.md", "## Task 1: Seed\n\nSeeded plan body.\n");
mk("ship/package.json", '{"scripts":{"dev":"vite"}}');
mk("ship/pnpm-lock.yaml", "lockfileVersion: 9\n");
export const V2_ROOT = V2_PROJECTS;
// cwds use the real path: the server scans the root through realpath (macOS tmpdir is a symlink).
const RP = fs.realpathSync(V2_PROJECTS);
export const V2 = { app: `${RP}/app`, plan: `${RP}/plan`, ship: `${RP}/ship`, jump: `${RP}/jump` };
export const ITERM_ID = "w0t0p0:1B2C3D4E-0000-4000-8000-00000000ABCD";
export const CLOSED_SID = "0c105ed0-0000-4000-8000-000000000001";
const TERM = { entry: "cli", program: "iTerm.app", iterm: ITERM_ID };
export const TOKEN = "ab".repeat(32);
fs.writeFileSync(path.join(V2_HOME, "helper.json"), JSON.stringify({ token: TOKEN, root: RP }), { mode: 0o600 });
export const V2_VSCODE = `${RP}/code`;
mk("code/.git/HEAD", "ref: refs/heads/main\n");
const V2_SPOOL = path.join(V2_HOME, "spool", path.basename(SPOOL));
if (!fs.existsSync(V2_SPOOL)) fs.writeFileSync(V2_SPOOL, [
  line(CLOSED_SID, V2.app, "SessionStart", { source: "startup" }),
  line(CLOSED_SID, V2.app, "UserPromptSubmit", { prompt: "hello" }),
  line(CLOSED_SID, V2.app, "SessionEnd", { reason: "other" }),
  line("s-plan", V2.plan, "SessionStart", { source: "startup" }, TERM),
  line("s-plan", V2.plan, "PreToolUse", { tool_name: "Skill", tool_input: { skill: "superpowers:writing-plans" } }),
  line("s-plan", V2.plan, "PostToolUse", { tool_name: "Write", tool_input: { file_path: `${V2.plan}/docs/superpowers/plans/p.md` }, tool_response: {}, fo: { planTasks: 1 } }),
  line("s-plan", V2.plan, "Stop", { fo: { say: "Plan ready · 1 task" } }),
  line("s-ship", V2.ship, "SessionStart", { source: "startup" }),
  line("s-ship", V2.ship, "PreToolUse", { tool_name: "Skill", tool_input: { skill: "wreview" } }),
  line("s-ship", V2.ship, "Stop", {}),
  line("s-ship", V2.ship, "PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
  line("s-jump", V2.jump, "SessionStart", { source: "startup" }, { entry: "cli", program: "iTerm.app", iterm: "w0t1p0:2B2C3D4E-0000-4000-8000-00000000ABCD" }),
  line("s-jump", V2.jump, "PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
  line("s-code", V2_VSCODE, "SessionStart", { source: "startup" }),
  line("s-code", V2_VSCODE, "PreToolUse", { tool_name: "Skill", tool_input: { skill: "superpowers:brainstorming" } }),
].join(""));

// agents board (Phase 2): its own server, home and spool, so a waiting agent never reaches the v1 footer counts or snapshots.
export const AG_PORT = 4397;
export const AG_HOME = path.join(HOME, "agents");
export const AG_TRANSCRIPTS = path.join(AG_HOME, "transcripts");
for (const d of ["spool", "jev", "transcripts"]) fs.mkdirSync(path.join(AG_HOME, d), { recursive: true });
export const AG_SPOOL = path.join(AG_HOME, "spool", path.basename(SPOOL));
export const AG = "/tmp/fo-e2e/agents";
if (!fs.existsSync(AG_SPOOL)) fs.writeFileSync(AG_SPOOL, [
  line("s-ag", AG, "SessionStart", { source: "startup" }),
  line("s-ag", AG, "UserPromptSubmit", { prompt: "go" }),
  line("s-ag", AG, "PreToolUse", { tool_name: "Skill", tool_input: { skill: "orchestrate" } }),
].join(""));

// VS Code edition board: same projects root as v2, but FO_EDITION=vscode, so no iTerm2 actions render.
export const VS_PORT = 4396;
export const VS_HOME = path.join(HOME, "vscode");
for (const d of ["spool", "jev", "transcripts"]) fs.mkdirSync(path.join(VS_HOME, d), { recursive: true });
fs.writeFileSync(path.join(VS_HOME, "helper.json"), JSON.stringify({ token: TOKEN, root: RP }), { mode: 0o600 });
