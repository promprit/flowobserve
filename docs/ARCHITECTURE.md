# Architecture

flowobserve is a hook, a local server and a web app. The hook records what Claude Code does, the server turns that into a per-session state, and the web app (a PWA, progressive web app) draws it.

```
Claude Code hooks + statusline ──> fo-hook (Python) ──> ~/.flowobserve/spool/*.jsonl
                                                              │
Jev logs, PLAN.md, transcripts (numbers), usage cache, host ──┤
                                                              v
                     fo-server (Node/TypeScript): pure reducer ──> SQLite snapshots
                                                              │  WebSocket /ws · SSE /events
                                                              v
                                               PWA (Three.js loop view + cards)
```

Jev is the Dryas Workflow's decision layer. It is optional: without it the Jev inputs are simply absent.

## Modules
- `hook/`: `fo-hook` (Python standard library only, under 30 ms on macOS, about 50-80 ms on Windows), redaction, install helper.
- `server/`: tailer, reducer (stage inference as a pure function), pricing (including Haiku 5.5, `claude-haiku-5-5`, in two tiers by prompt size, up to 100K tokens or above), host and usage polling, HTTP/WebSocket server.
- `shared/`: the wire contract (zod schemas) between server and PWA.
- `pwa/`: dashboard UI and the built-in simulator.

## The hook
`fo-hook` receives Claude Code hook events and the statusline `rate_limits`, redacts them, and appends one JSON line to `~/.flowobserve/spool/YYYY-MM-DD.jsonl`. It makes no network calls, fails silent and always exits 0, so it can never slow or break Claude Code. Every line carries `acct`, the Claude config dir it came from with the home prefix written as `~` (`FO_ACCT` set by the installer, else `CLAUDE_CONFIG_DIR`, else `~/.claude`).

On macOS the installer wraps a config dir's statusline so the hook can read `rate_limits`. A dir with no statusline gets the minimal `hook/fo_status.py` (model and 5-hour percentage), because flowobserve learns an account's limits only from its statusline; it is wrapped like any other, removed on uninstall, and an existing statusline is never replaced.

## Redaction
Secrets are redacted before anything touches disk. The spool never holds the raw event.

## The reducer
The server tails the spool and other inputs and feeds them to a reducer. Stage inference is a pure function: no clock, no I/O, same input gives the same output. It is tested by replaying recorded, scrubbed days in `fixtures/golden/` and comparing against stored expected sessions. Any change to stage inference must keep those replays passing, or update them deliberately.

## Network
The server binds to `127.0.0.1` only (port 4317 by default). It serves the static PWA, a WebSocket at `/ws` and Server-Sent Events at `/events`. It launches nothing. `GET /api/usage` returns each account's 5-hour and weekly use (`{accounts: [{label, dir, fiveHour, sevenDay, at}], switchAt}`, `null` before a reading) and, with `?session=<id>`, the account a session was recorded under. The `cl` launcher (`~/.flowobserve/bin/cl`) reads it to choose the config dir before it starts `claude`; it never writes anything.

## What it reads and writes
It writes only its own spool and SQLite store under `~/.flowobserve`. It reads, and never writes:
- the spool;
- Jev logs under `~/.dryas/jev/logs`, `~/.dryas/jev/thresholds.json` and the mtimes of Jev handoff files in `~/.dryas/jev/handoff` (`$DRYAS_DATA_ROOT` moves them). A legacy `~/.claude/jev` copy install is read alongside until `jev/.migrated.json` lists `~/.claude`; each Jev line is counted once whichever dir it comes from. `~/.dryas/accounts.json` lists the Claude config dirs (accounts) to show on the board;
- `.orchestrate/PLAN.md` in each project;
- `~/.flowobserve/accounts.json`, FlowObserve's own account list (Claude config dirs and labels; written only by the installer);
- Claude Code transcripts under `<dir>/projects` for every watched dir (the board accounts, which are FlowObserve's list then Dryas's list, plus `~/.claude` and `CLAUDE_CONFIG_DIR`, which are board accounts only when both lists are empty), numbers only (message id, model, token usage, and the Remote Control takeover time), never text;
- `subagents/agent-<id>.meta.json` files, for the tool-use id only, to pair a sub-agent with its dispatch;
- `<dir>/sessions/*.json` for every watched dir, for pid, session id and kind only, to drop sessions whose process has gone;
- `<dir>/.dryas-plugin.json` and `<dir>/jev/chain.json`, only to set an account's Dryas flag (also set when Dryas lists the dir; re-checked every 30 s);
- `~/.claude/usage-cache.json` (default account only), an undocumented Claude Code file that supplies plan usage when the statusline does not run;
- project folders under `FO_PROJECTS_ROOT` (git folders, `.git/worktrees`, Peacock colour, `package.json`, `.flowobserve/run`);
- `~/.flowobserve/helper.json`, the helper's token;
- a session's spec or plan under `docs/superpowers/` or `.orchestrate/`, served to the in-app reader and never stored.

## The iTerm2 helper (macOS, optional)
`scripts/install.sh --edition iterm|both` installs a helper that handles `flowobserve://` links to open, restore, run and jump between sessions in iTerm2. Only the helper launches anything, and only for links that carry its token. It may create a project folder on a tokened New-project action and run `git init` in a plain folder on a tokened Open. It never deletes, overwrites or moves anything. When `~/.flowobserve/bin/cl` exists, Open starts `cl` and Restore starts `cl --resume <id>`, so a restored session stays on its own account.

## Wire contract
The server sends JSON messages over `/ws` (or `/events`). Sessions are cards; the other messages are small deltas.

| Message | Shape |
|---|---|
| `snapshot` | `{type, sessions: Session[], usage: Usage, metrics: Metrics, kpis: Kpi[], host?: Host}` first, then on reconnect |
| `session` | `{type, session: Session}` one session changed |
| `usage` | `{type, usage: Usage}` |
| `metrics` | `{type, metrics: Metrics, kpis: Kpi[]}` |
| `host`, `projects`, `agents` | host readings, the project list for the Open sheet, a session's sub-agent list |

- **Session**: `id`, `name`, `worktree` (null for the main folder), `title`, `stage` (0-6), `status` (`active|waiting|escalated|handoff|deny|shipped|idle`), task counts, builder states, a headline `msg` and `action` when you are needed, the latest agent line and recent log, `ctx` (context fill, `ok|warn|crit`), `nodes` for the loop view, `stageAt` (when each stage began), `openUrl` / `jumpUrl`, and `account` (`{label, dryas}`) when there are several accounts; a session's account is the one on its first `acct`-tagged spool line, and untagged lines count as `~/.claude` until then.
- **Usage**: 5-hour and weekly plan use (`used` 0-1 with reset times) of the primary account (the first account in `accounts.json` with a reading), optional Fable meter, `jev` (`{usedUsd, budgetUsd, monthStart}`, `null` when Jev is not installed), and with several accounts `accounts` (one `{label, session, weekly, at, primary?, near?}` per account) and `switch` (`{from, to, used}` or `null`; `near` and `switch` count 5-hour and weekly use alike). The server keeps one reading per account and stores them as one map.
- **Metrics**: per stage (plan, build, judge, escalate, review) model, call count, p50, p95 and a warning flag.
- **Kpi**: workflow measures (id, tile, value, unit, window, whether healthy, and a next action). Also at `GET /api/kpis`.

The full field list lives in `shared/src/wire.ts`.
