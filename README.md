# flowobserve

Ambient monitor for live Claude Code sessions. Keep it open on a second screen beside VS Code: it shows where every session sits in the workflow loop and tells you, within seconds, when one needs you and what to do next. Otherwise it stays quiet.

![flowobserve showing four simulated sessions](docs/screenshot.png)

## What it does
- **Sees every session.** One card per Claude Code chat, grouped by project, with each git worktree labelled. Sessions appear on their first hook event and retire on `SessionEnd` or after 24 h idle.
- **Knows the stage.** Infers where each session is in the loop (Brainstorm, Plan, Build, Review, Ship) from Claude Code hooks and `.orchestrate/PLAN.md`.
- **Tells you when you are needed.** A session waiting for an answer, blocked by a denied tool, or due a handoff gets the only highlight on screen, with its question shown large and a one-click jump to the project in VS Code. Everything else is calm.
- **Watches context.** Each card shows `N% LEFT` of the context window. It turns amber and then red as the chat fills, and the card then shows **Handoff**, **Clear** and **Resume** buttons: each focuses the chat in VS Code and copies the next thing to type.
- **Shows the loop live.** A 3D view of the loop: sub-agent builders, packets moving between stages, a ring wave on ship. Motion follows real activity and goes still when nothing runs. Hover a node to inspect it; free camera; `prefers-reduced-motion` is respected.
- **Tracks limits and cost.** 5-hour and weekly plan usage (and the Fable meter, when your Claude usage cache reports one) with a pace marker, and API-equivalent cost per project and model (click the usage tiles).
- **Watches the machine.** CPU, GPU (macOS), memory pressure and disk space. Shown only when something needs attention.
- **Pages itself.** With many sessions, cards page automatically and the loop view follows whichever session needs you. A manual pick holds for 2 minutes.
- **Installs as an app.** A PWA (progressive web app) served from `http://127.0.0.1:4317`: add it to the Dock or home screen, use it full screen, portrait or landscape.

With the Dryas Workflow (see below):
- Judge and Escalate stages, and escalations (Sonnet to Opus to Fable) shown without counting as needing you.
- Build lanes, one per plan task.
- Jev's monthly spend against budget.
- Per-stage call counts and p50/p95 times, drift warnings, and total time blocked on you.

## Requirements
- macOS 14+ or Windows 10/11.
- Node 24+ and pnpm 10.
- Python 3.9+ (macOS uses the system `/usr/bin/python3`).
- VS Code with the Claude Code extension.
- Optional: iTerm2 (macOS), to open, restore and jump between sessions from the board.
- Optional: the *Claude Code Usage Status* VS Code extension (by mhelbich), for live plan limits.

## Install
macOS:
```sh
git clone https://github.com/promprit/flowobserve && cd flowobserve
pnpm install && pnpm build
scripts/install.sh --edition vscode   # or iterm, or both
```
`install.sh` copies the hook to `~/.flowobserve/bin`, writes a launchd agent, starts the server and wires `~/.claude`. It is safe to re-run.

Windows (PowerShell):
```powershell
git clone https://github.com/promprit/flowobserve; cd flowobserve
pnpm install; pnpm build
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```
There is no auto-start on purpose: antivirus tools often flag hidden launchers and logon tasks as malware persistence, so you start the board yourself in a visible window.

`start.ps1` sets `FO_PORT=4317` and `FO_EDITION=vscode` itself, so setting those variables beforehand has no effect (Windows is always the VS Code edition). It does respect `FO_HOME` and every other variable below.

Then open `http://127.0.0.1:4317` and use Add to Dock / Install if you want the app form.

## Uninstall
- macOS: `scripts/uninstall.sh`
- Windows: `powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1`

Both remove the flowobserve hooks and statusline wrapper from `~/.claude` and keep your `~/.flowobserve` data and `.bak` files. On macOS, `uninstall.sh` also stops and removes the launchd agent, the `flowobserve-open.app` helper and `helper.json`. On Windows, `uninstall.ps1` also removes the temporary pnpm shim if setup made one, and tells you to close the server window.

## Configuration
Read by the server at start. On macOS, launchd does not see shell exports: put overrides in the plist's `EnvironmentVariables` (`~/Library/LaunchAgents/com.promprit.flowobserve.plist`), then restart. Re-running `install.sh` rewrites the plist.

| Variable | Default |
|---|---|
| `FO_HOME` | `~/.flowobserve` (spool, SQLite, log) |
| `FO_PORT` | `4317` (always bound to 127.0.0.1) |
| `FO_PROJECTS_ROOT` | none (the Open sheet is empty without it) |
| `FO_STATIC` | `pwa/dist` in this repo |
| `FO_JEV_LOGS` | `~/.claude/jev/logs` |
| `FO_USAGE_CACHE` | `~/.claude/usage-cache.json` |
| `FO_DISKS` | `/:System` (`path:label`, comma-separated, max 4; on Windows for example `C:\:System`) |
| `FO_SESSIONS_DIR` | `~/.claude/sessions` |
| `FO_EDITION` | `both` (`vscode`, `iterm` or `both`; macOS only, Windows is always `vscode`) |
| `FO_TRANSCRIPTS` | `~/.claude/projects` |
| `FO_THRESHOLDS` | `~/.claude/jev/thresholds.json` |
| `JEV_HANDOFF_DIR` | `~/.claude/jev/handoff` |
| `JEV_CONTEXT_WINDOW` | per model; set it in the plist if you run a custom window |

## What it never does
- Slow or change Claude Code. The hook is Python stdlib, runs under 30 ms on macOS (about 50 to 80 ms on Windows), makes no network calls, and always exits 0.
- Type into a session. It only links to the project or chat and copies text; you paste and press Enter.
- Leave this machine. The server binds to 127.0.0.1 only. Secrets are redacted before anything is written to disk. Transcripts are read for numbers only (message id, model, token usage), never their text.
- Write files it reads. It writes only its own spool and SQLite store.

## Works best with the Dryas Workflow
[The Dryas Workflow](https://github.com/promprit/dryas-workflow) is a plan, build, judge and review loop for Claude Code, with Jev as its decision layer. flowobserve works without it. With it installed, the board also shows the Judge and Escalate stages, build lanes with one lane per plan task, Jev's monthly spend, per-stage timings, and handoff state. Install Jev later? Restart the server to see the JEV tile.

## How it works
Hooks write redacted events to a local spool; a small local server turns them into the board. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License
Source-available under FSL-1.1-MIT: use, modify and self-host for any purpose except a competing commercial product; each release becomes MIT two years after it ships. See [LICENSE](LICENSE).
