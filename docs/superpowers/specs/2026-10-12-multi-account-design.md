# Several Claude accounts on one board

Date: 2026-10-12. Status: approved in conversation, pending written-spec review.

## Goal

One person runs two Claude accounts on one Mac, each in its own config dir, from iTerm:

- `claude` → `~/.claude` (Team seat, with the Dryas workflow)
- `claude-pro` → `CLAUDE_CONFIG_DIR=~/.claude-personal claude` (personal Pro, plain Claude Code)

flowobserve should show both accounts' sessions, keep each account's plan limits apart, and say when to move work from one account to the other. Success: with both running, every card names its account, the usage tile shows one 5h/7d pair per account that never mixes, and the board says "Team near limit: /handoff, continue in Pro" before Team is blocked.

## Problem (current code)

- Sessions are found only through the hook wired into one config dir. `scripts/install.sh` honors `CLAUDE_DIR`, but `fo_install.py` fails when `<dir>/jev/chain.json` is missing (`main`, :332-337), and a plain config dir has none. So a non-Dryas account cannot be wired.
- Nothing reads `CLAUDE_CONFIG_DIR`. Spool lines carry no account.
- One usage meter: every statusline `Usage` event calls `Engine.setUsage` (engine.ts:192, :302). With two accounts, the meter jumps between them.
- One transcripts root (`FO_TRANSCRIPTS`, transcript.ts:96, :103 rejects paths outside it) and one sessions dir (`FO_SESSIONS_DIR`, registry.ts:17). The second account's transcripts are rejected (`transcriptRejected`) and its sessions are not in the registry, so cost per project and "gone" detection miss it.

## Design

### 1. Accounts file

`$FO_HOME/accounts.json`, written by the installer, read by the server at start and on change (mtime check on the existing 30 s tick):

```json
{"accounts": [
  {"dir": "~/.claude", "label": "Team"},
  {"dir": "~/.claude-personal", "label": "Pro"}
]}
```

- `dir` is stored with the home prefix as `~` so the file and spool lines do not carry the user name. The server expands it.
- `label` defaults to the dir basename without the leading dot (`claude`, `claude-personal`); the installer takes `--label`.
- The account whose dir is `~/.claude` is the **default account**. When the file is missing, there is exactly one account: `~/.claude`, label `claude`. Current single-account behavior is then unchanged.
- Order in the file is display order.

### 2. Hook: tag every line with the account

`fo_hook.py` adds `acct` to every spool line (hook and statusline):

- `acct` = `CLAUDE_CONFIG_DIR` from the hook's env (Claude Code passes its env to hooks and the statusline), resolved and shown with `~` for the home prefix; `~/.claude` when unset.
- It is added in `run_hook`, the truncated path and `record_usage`, and goes through `fit()` like the other fields. The `usage-last.json` dedup key becomes `acct + sid`.
- The hook stays fast and never fails Claude Code: a bad value falls back to `~/.claude`.

### 3. Server: account per session

- `parseSpoolLine` reads `acct` (optional; missing = default account). `SessionState` gets `acct: string`, set on the first event of a session and never changed.
- `SessionZ` gets `account: z.object({ label: z.string(), dryas: z.boolean() }).strict().optional()`. It is sent only when the accounts file lists more than one account, so the single-account board looks exactly as today.
- `dryas` = `<dir>/jev/chain.json` exists, checked when accounts load. A Dryas-less card shows a small "no Dryas" tag next to the account label; stage inference is unchanged (it already copes with sessions that never send Dryas events).
- An `acct` that is not in the file is shown with its basename as label and counted in a `unknownAccount` counter next to `transcriptRejected`.

### 4. Usage per account

- `Engine.usage` becomes a map `acct → usage`. A statusline `Usage` event updates only its own account. `setUsage`'s older-reading rule applies per account. The persisted `kvSet("usage")` value becomes the map; an old single value loads as the default account's.
- The usage cache (`FO_USAGE_CACHE`, written by the VS Code extension) is attributed to the default account. `fable` stays on the default account only.
- Wire: `UsageZ` gains `accounts: z.array(AccountUsageZ).max(8).optional()`, where `AccountUsageZ = { label, session, weekly, at }` (same `session` and `weekly` shapes as today). The existing top-level `session`/`weekly`/`at` keep carrying the default account, so an older PWA still works. `accounts` is sent only with more than one account.
- PWA `renderUsage`: with `accounts`, one row per account (label, 5h meter with pace marker, 7d meter, "AS OF" staleness per row). Without it, today's rendering. `slim.ts` shows the default account plus a one-letter marker per other account whose 5h use is above the switch threshold.

### 5. Switch hint

- The server computes `UsageZ.switch: { from: string, to: string, used: number }.nullable().optional()`:
  - `from` = an account whose 5h `used` ≥ `FO_SWITCH_AT` (default `0.9`) and whose reading is under 10 minutes old.
  - `to` = the account with the lowest 5h `used` that is under `FO_SWITCH_AT` (a reading 6 hours old or more, or none at all, counts as unknown and is offered last).
  - Several `from` accounts: the one with the highest `used`. No `to`: `switch` is null (nothing to switch to).
- The PWA shows the hint in the usage tile, in the warn color: "Team 92% of 5h: /handoff, continue in Pro". It is a board-level hint, not a session state: it does not set any card to waiting and does not count in the "needs you" totals, so the rule "one highlight on screen, for what needs you" holds.
- `FO_SWITCH_AT` is read from the env like the other `FO_*` settings and documented in the README table. `1` turns the hint off.

### 6. Transcripts and registry for every account

- `FO_TRANSCRIPTS` stays as an override (single root, as today). Without it, the roots are `<dir>/projects` for every account. `TranscriptTailer` takes a list of roots, realpaths each, and `watch()` accepts a path under any of them.
- `FO_SESSIONS_DIR` likewise: without it, `readRegistry` reads `<dir>/sessions` for every account and merges the results. A missing dir is skipped, as today.
- Cost per project is computed from transcripts as today, so Pro work is now included. It is not split per account in this change.

### 7. Installer

- `fo_install.py`:
  - `wire`, `unwire` and `status` work when `<dir>/jev/chain.json` is missing: they handle `settings.json` (hooks and statusline) only, and `status` prints `info chain: none (no Dryas in this dir)`, not a `warn`. A chain file that exists but cannot be parsed is still an error.
  - New subcommand `account add --claude-dir D [--label L]` / `account remove --claude-dir D` edits `accounts.json` (atomic write, keeps order, no duplicate dirs).
- `install.sh`: after wiring, runs `account add` for `CLAUDE_DIR` with `FO_ACCOUNT_LABEL` when set. Running it once per dir is the documented flow:
  ```sh
  scripts/install.sh                                                   # ~/.claude
  CLAUDE_DIR=~/.claude-personal FO_ACCOUNT_LABEL=Pro scripts/install.sh
  ```
  The launchd agent, hook copy and helper are shared and stay as today; re-running for a second dir rewrites them unchanged.
- `uninstall.sh`: with `CLAUDE_DIR` set to a dir other than `~/.claude`, it only unwires that dir and removes its account (the server and agent stay for the other accounts). Without it, behavior is unchanged.
- Windows (`setup.ps1`/`uninstall.ps1`): out of scope; their behavior is unchanged and a missing `accounts.json` keeps them single-account.

### 7b. Statusline needed for limits

flowobserve learns an account's limits only from its statusline. The installer wraps an existing simple `statusLine` (fo_install.py:112-114) and does nothing when there is none, so a fresh `~/.claude-personal` would never report Pro's limits. Decision (user, 2026-10-12): when a dir has no `statusLine`, the installer adds a minimal one (`fo_status.py`: model and 5h %), wrapped like any other, and removes it again on uninstall. An existing statusline is never replaced. macOS only, like the wrap.

### 8. Spend drawer readable in portrait (user feedback)

Feedback: on a vertical screen the cost view (the spend drawer opened from the usage tiles or the slim row) cannot be seen.

- Cause (found while planning): `placeDrawer()` (pwa/src/ui/drawer.ts:61-64) sets an inline `style.bottom` from `#usage.offsetTop` so the drawer ends above the usage tiles. In portrait `#usage` is hidden (styles.css:224), its `offsetTop` is 0, and the drawer collapses. A CSS-only rule would lose to the inline style.
- First plan step: reproduce with a Playwright screenshot at portrait sizes. The user's setup is a rotated monitor, so the main targets are 1080×1920 and 1440×2560 (rotated 1080p and 1440p); 820×1180 (tablet) is kept as a smaller check with spend rows served by a stub `/spend`, and confirm the cause before changing CSS.
- Fix: in portrait `placeDrawer()` anchors on `#slim` instead of `#usage`, and a `body.portrait #drawer` rule sets side insets matching the portrait dock padding (styles.css:39), so the BY PROJECT and BY MODEL tables are visible and scroll inside the drawer. Long project names keep the existing ellipsis; the money columns never wrap or clip.
- With several accounts the drawer is unchanged (cost is not split per account in this change).

### 9. Pick the account when a session starts (`cl` launcher)

Choosing the account is a fixed rule over numbers flowobserve already has, so no model call (Jev runs inside a session's hooks, after the account is chosen, and is not installed on a non-Dryas account).

**Server: `GET /api/usage`** (read-only, same origin/host checks as `/spend`, no token):

```json
{"accounts": [
  {"label": "Team", "dir": "~/.claude", "fiveHour": 0.41, "sevenDay": 0.22, "at": 1760270000000},
  {"label": "Pro", "dir": "~/.claude-personal", "fiveHour": null, "sevenDay": null, "at": null}
], "switchAt": 0.9}
```

`null` = no reading yet. Order = accounts file order.

**Rules** in `accounts.json`, optional:

```json
{"accounts": [...], "rules": [{"path": "~/clients", "label": "Team"}]}
```

A rule matches when the current folder is the rule's `path` or inside it (longest path wins).

**`cl`** (`scripts/cl.py`, Python 3.9+ standard library; `install.sh` copies it to `$FO_HOME/bin/cl` and prints the line to add `$FO_HOME/bin` to `PATH`):

```
cl [--team | --pro | --account LABEL] [--dry-run] [claude args...]
```

1. `--account LABEL` (or `--team` / `--pro`, shorthands for those labels when they exist) wins.
2. Else the first matching rule.
3. Else `GET http://127.0.0.1:$FO_PORT/api/usage` (timeout 1 s):
   - the default account if its 5h use is under `switchAt` or unknown;
   - else the account with the lowest known 5h use under `switchAt`;
   - else the default account (all are near the limit; the line says so).
4. flowobserve not reachable or no accounts file: the default account.

It prints one line to stderr, e.g. `cl → Team (5h 41% · Pro 12%)` or `cl → Pro (Team 5h 93%)`, then `exec`s `claude` with the remaining arguments and `CLAUDE_CONFIG_DIR` set to the chosen dir (unset for `~/.claude`). `--dry-run` prints the line and the command without starting it.

**Resume stays on its account.** Transcripts live in the account's own config dir, so `cl --resume <id>` (and the board's Restore) uses the account the session was recorded under (looked up from the session's `acct`, via `GET /api/usage?session=<id>` returning `{"label": ..., "dir": ...}`), not the rule. An id the server does not know falls through to the normal pick.

**Board Open/Restore in iTerm.** `helper/fo_open.py` builds the command line for new and restored sessions (:300-302). It uses `cl` for new sessions and `cl --resume <id>` for restores (`cl` looks up the account itself; `plan()` stays pure) when `$FO_HOME/bin/cl` exists, else plain `claude` as today.

### 10. ⌘1–⌘9 select a tab (user request)

On the board, ⌘1 … ⌘9 select tab 1 … 9 of the tab strip (`pwa/src/ui/tabs.ts`), exactly as clicking it does: in portrait the tab's session gets focus (`pagerGo`), in landscape the tab's project page is shown (`selectProject`). Nothing opens outside the board; `j` / Enter still jump to the terminal.

- ⌘9 selects the last tab when there are more than 9 (browser convention). A number with no tab does nothing.
- Only ⌘ (metaKey) without Ctrl/Alt/Shift; the key handler calls `preventDefault()` only when a tab was selected. Ignored while typing in an input, the Open sheet, or with the spend drawer open (same guards as the other keys in `pwa/src/input.ts`).
- Hint: each of the first 9 tabs gets `aria-keyshortcuts="Meta+N"` and `⌘N` in its title; a small `⌘N` badge shows on those tabs only while ⌘ is held (`body.cmd` class set on Meta keydown, cleared on keyup and on window blur), so the board stays calm otherwise.
- Works in the installed app window. In a normal browser tab, the browser keeps ⌘1–9 for its own tabs; the README says so.

### 11. Usage area with several accounts: rings at today's size (user design, supersedes §4 rendering, §5 hint display and the per-account slim cells)

Approved by the user on 2026-10-12 after mockups (artifact "FlowObserve Account Layouts", Option I + "Every field"). Goal: the board takes exactly the space it takes today, in landscape and portrait, at any account count; no empty gaps; everything aligned.

**One account (no `accounts` on the wire): unchanged.** Today's tiles and slim row, byte-identical.

**Two or more accounts:**
- **Claude block = rings.** Each account is a column: its label (the account you are on first, marked with a small green dot), then three 30 px rings: `5H`, `WK`, `FAB`. Each ring shows **what is left** (`100 − used`, integer %, inside the ring) and fills with what is left. A ring is amber when ≤ 10 % is left or when that limit is ahead of pace (same rule as today's `claudeLevel`/pace warning). A limit an account has not reported shows `—` and a dim empty ring (Fable is reported only for the default account today).
- **Up to 4 accounts shown at once**, columns sharing the block's width equally (`repeat(min(N,4), 1fr)`, no trailing space). With 5 or more: the first three stay; the 4th column cycles through the rest every 8 s (0.35 s fade, none under `prefers-reduced-motion`) with one small dot per cycled account.
- **Jev: one tile, unchanged content** ($ used, of $budget, share of spend, $/task). **Machine: unchanged values.**
- **No switch hint on the board** (landscape or portrait). The server still computes `switch`/`switchAt`; `cl` uses `switchAt`. The PWA stops rendering the hint.

**Landscape (`#usage` + `#host`):** one row: Claude rings block (3 fr) + Jev tile (1 fr), same outer height as today's tile row. Host row below as today but storage changes: CPU, GPU, MEM keep their rings; all disks become **hairlines stacked vertically** (label · hairline · "N GB free") in a block exactly one ring tall that fills the remaining width. This applies to one-account boards too (it is a host change, not an accounts change) so the host row height is the same at any disk count up to 4.

**Portrait (`#slim`):** row 1 = Claude rings block spanning 3 of the 4 grid columns + Jev cell in the 4th; row 2 = CPU (GPU note) · MEM · each disk, on the same 4-column grid so column edges line up with row 1. Row heights stay as today's slim rows.

**Fit rules (checked by screenshot at 1920×1080, 1080×1920, 1440×2560 with 1, 2, 4 and 8 accounts, 2 disks):** no element overlaps or clips; no column or cell left empty inside the usage area; left and right edges of row 1 and row 2 align; the usage area's height equals today's single-account height ±1 px in both orientations; labels longer than the column truncate with an ellipsis and the full name shows on hover (`title`).

## Error handling

- Missing or unreadable `accounts.json`: single default account, one log line on unreadable.
- Unknown `acct` in a spool line: basename label, counted, never dropped.
- The hook never blocks: any problem resolving `acct` falls back to `~/.claude`.
- A Usage event for an account with no prior reading creates its entry.

## Testing

- **hook/tests**: `acct` present on hook, truncated and statusline lines; default without `CLAUDE_CONFIG_DIR`; `~` substitution; dedup key per account; latency test still passes.
- **scripts/tests**: wire/unwire/status on a dir without `jev/chain.json`; `account add/remove` (idempotent, order kept, atomic); `install.sh` with `CLAUDE_DIR` + `FO_ACCOUNT_LABEL`; `uninstall.sh` for a second dir leaves the agent.
- **server/test**: per-account usage never mixes (two accounts interleaved); old persisted single usage loads as default; `switch` rules (threshold, freshness, lowest target, none available, hint off at `1`); multi-root transcript watch accepts both roots and still rejects others; registry merge; `account` absent on the wire with one account; goldens unchanged.
- **shared/test**: `UsageZ` and `SessionZ` accept old and new shapes.
- **pwa**: unit test for multi-row `renderUsage` and the hint; existing e2e unchanged with one account; new e2e: open the spend drawer in portrait at 1080×1920, 1440×2560 and 820×1180 and assert the drawer and its last table row are inside the viewport (scrolling the drawer if needed).
- **leakcheck**: fixtures use `~/...` dirs only.
- **cl** (scripts/tests): each rule step in order (flag, rule, longest-path rule, usage pick, all near limit, server down, no accounts file), the printed line, env passed to `exec` (`CLAUDE_CONFIG_DIR` set or unset), `--dry-run`, resume looks up the session's account. A stub HTTP server on 127.0.0.1 serves `/api/usage`.
- **server/test**: `/api/usage` shape, nulls before a reading, `?session=` lookup, origin check.
- **helper/tests**: Open/Restore use `cl` when present, plain `claude` when not.
- **pwa (⌘N)**: ⌘1 selects tab 1 in portrait (focus) and landscape (project); ⌘9 with 12 tabs selects the last; ⌘5 with 3 tabs does nothing and does not `preventDefault`; Ctrl+1 / ⌘⇧1 / typing in an input do nothing; `aria-keyshortcuts` and title on the first 9 tabs only; `body.cmd` set on Meta down, cleared on up and blur.

## Docs

- README: "Several accounts" section (the two-command install above, labels, `FO_SWITCH_AT`), README table rows for `FO_SWITCH_AT` and the multi-root defaults of `FO_TRANSCRIPTS` / `FO_SESSIONS_DIR`.
- docs/ARCHITECTURE.md: `acct` on spool lines, accounts file, usage map.

## Out of scope

- Switching accounts or restarting sessions (flowobserve stays observe-only).
- Predicting remaining quota beyond what the statusline reports.
- Cost split per account.
- Windows installer changes.
- Dryas changes (Dryas stays installed in `~/.claude` only).
