import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/** 2026-10-03 10:00 in Asia/Bangkok (tests run with TZ=Asia/Bangkok). */
export const T0 = Date.parse("2026-10-03T03:00:00.000Z");
export const at = (sec: number) => T0 + sec * 1000;

type P = Record<string, unknown>;

export function mk(a: string | { sid?: string; cwd?: string } = "s1", b = "/Users/p/projects/app") {
  const sid = typeof a === "string" ? a : a.sid ?? "s1";
  const cwd = typeof a === "string" ? b : a.cwd ?? b;
  const line = (event: string, sec: number, payload: P = {}, src = "hook") =>
    JSON.stringify({ v: 1, ts: new Date(at(sec)).toISOString(), src, sid, cwd, event,
      payload: { session_id: sid, cwd, hook_event_name: event, ...payload } });
  const agent = (id?: string) => (id ? { agent_id: id } : {});
  return {
    sid, cwd,
    line,
    startT: (sec: number, term: P) =>
      JSON.stringify({ ...JSON.parse(line("SessionStart", sec, { source: "startup" })), term }),
    endR: (sec: number, reason: string) => line("SessionEnd", sec, { reason }),
    bash: (sec: number, command: string, ok: boolean, tests?: P) =>
      line(ok ? "PostToolUse" : "PostToolUseFailure", sec,
        { tool_name: "Bash", tool_input: { command }, tool_response: {}, ...(tests ? { fo: { tests } } : {}) }),
    helper: (sec: number, action: string, ok: boolean, hsid = "") =>
      JSON.stringify({ v: 1, ts: new Date(at(sec)).toISOString(), src: "helper", sid: hsid, cwd: "", event: "helper",
        payload: { action, ok } }),
    start: (sec: number) => line("SessionStart", sec, { source: "startup" }),
    end: (sec: number) => line("SessionEnd", sec, { reason: "clear" }),
    prompt: (sec: number) => line("UserPromptSubmit", sec, { prompt: "go" }),
    pre: (sec: number, tool: string, input: P = {}, agentId?: string) =>
      line("PreToolUse", sec, { tool_name: tool, tool_input: input, ...agent(agentId) }),
    post: (sec: number, tool: string, input: P = {}, fo?: P, agentId?: string) =>
      line("PostToolUse", sec, { tool_name: tool, tool_input: input, tool_response: {}, ...(fo ? { fo } : {}), ...agent(agentId) }),
    subStart: (sec: number, id: string, type = "executor") => line("SubagentStart", sec, { agent_id: id, agent_type: type }),
    subStop: (sec: number, id: string, result: "pass" | "fail" | "unknown" = "pass") =>
      line("SubagentStop", sec, { agent_id: id, agent_type: "executor", fo: { result } }),
    stop: (sec: number, say = "") => line("Stop", sec, say ? { fo: { say } } : {}),
    notify: (sec: number, message: string, type = "permission_prompt") =>
      line("Notification", sec, { message, notification_type: type }),
    usage: (sec: number, pct5 = 40, pct7 = 20, cost: number | null = 1, model = "claude-opus-5-5") =>
      line("usage", sec, {
        rate_limits: {
          five_hour: { used_percentage: pct5, resets_at: Math.floor(at(sec) / 1000) + 3600 },
          seven_day: { used_percentage: pct7, resets_at: Math.floor(at(sec) / 1000) + 86400 },
        },
        cost: { total_cost_usd: cost }, model: { id: model },
      }, "statusline"),
  };
}

/** A Jev log line as jevlog.py writes it (local time with a +0700 offset). */
export function jev(sec: number, fields: P): string {
  const ts = new Date(at(sec) + 7 * 3600_000).toISOString().slice(0, 19) + "+0700";
  return JSON.stringify({ ...fields, ts });
}

/** One assistant transcript record (numbers only), dated at(sec) unless sec is null. */
export function tline(id: string, sec: number | null = 1, read = 50_000, model = "claude-opus-5-5", output = 100): string {
  return JSON.stringify({
    type: "assistant", ...(sec === null ? {} : { timestamp: new Date(at(sec)).toISOString() }),
    message: { id, model, usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: read, output_tokens: output } },
  });
}

/** Python for tests that shell out: FO_TEST_PYTHON, else `py -3` on Windows, else /usr/bin/python3. */
export function testPython(): { cmd: string; pre: string[] } {
  if (process.env.FO_TEST_PYTHON) return { cmd: process.env.FO_TEST_PYTHON, pre: [] };
  return process.platform === "win32" ? { cmd: "py", pre: ["-3"] } : { cmd: "/usr/bin/python3", pre: [] };
}

/**
 * Jev's Python source, for parity tests: FO_JEV_SRC, else the Dryas plugin root recorded in
 * <CLAUDE_CONFIG_DIR or ~/.claude>/.dryas-plugin.json + /jev, else a legacy copy install in ~/.claude/jev. Null if none.
 */
export function jevSrc(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string | null {
  if (env.FO_JEV_SRC) return env.FO_JEV_SRC;
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), ".dryas-plugin.json"), "utf8")) as { plugin_root?: unknown };
    if (typeof rec.plugin_root === "string" && fs.existsSync(path.join(rec.plugin_root, "jev"))) return path.join(rec.plugin_root, "jev");
  } catch { /* no plugin record */ }
  const legacy = path.join(home, ".claude", "jev");
  return fs.existsSync(legacy) ? legacy : null;
}
