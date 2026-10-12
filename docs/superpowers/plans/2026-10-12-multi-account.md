# Several Claude Accounts on One Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** flowobserve shows the sessions of several Claude config dirs (accounts) on one board, keeps each account's 5h/7d limits apart, hints when to move work to another account, picks the account when a session starts (`cl` launcher), and makes the spend drawer readable in portrait.

**Architecture:** The hook tags every spool line with `acct` (`~`-form config dir). The installer wires any config dir (with or without Dryas) and records it in `$FO_HOME/accounts.json`. The server loads that file (new `server/src/accounts.ts`), keeps one account per session and one usage reading per account, computes a switch hint (new `server/src/switch.ts`), and reads transcripts and registries from every account dir. The PWA renders one usage row per account, the hint, a slim-row marker and an account label on each card. `GET /api/usage` feeds `scripts/cl.py`, which picks the config dir before exec'ing `claude`; the iTerm2 helper starts sessions through `cl` when it is installed. With zero or one account the wire output is byte-for-byte what it is today.

**Tech Stack:** Python 3.9+ stdlib (hook, installer), POSIX sh, Node 24 + TypeScript + zod + vitest (server, shared, PWA), Playwright (e2e), pnpm 10 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-12-multi-account-design.md`

**Deviation from the spec (deliberate):** the hook reads `FO_ACCT` first, then `CLAUDE_CONFIG_DIR`, then defaults to `~/.claude`; the installer writes `FO_ACCT="<~dir>"` into every hook and statusline command it wires in a non-default dir. So account tagging never depends on Claude Code passing `CLAUDE_CONFIG_DIR` to child processes (Task 1 only records whether it does). Paths are normalized with `abspath` (not `realpath`) in both hook and installer so they always agree.

**Plan-level decisions the spec left open (all small, listed so a reviewer can object):**
- `AccountUsageZ` also carries `primary?: true` (the row the top-level `session`/`weekly`/`at` describe) and `near?: boolean` (5h use ≥ `FO_SWITCH_AT`). The PWA needs both for the slim marker; it does not know `FO_SWITCH_AT`.
- Switch `to`: a reading 6 h old or older counts as "unknown" (offered last), like an account that never reported. Otherwise an account idle overnight could never be offered.
- Labels are at most 32 characters (server truncates; installer refuses longer).
- `account add` for a non-default dir, when `accounts.json` does not exist yet and `~/.claude` exists, first adds `~/.claude` (label `claude`) so an upgrade that only installs the second dir does not orphan the first.

## Global Constraints

- Node 24+, pnpm 10, Python 3.9+; the hook is stdlib only and runs as `python3 -S`.
- The hook must never slow or break Claude Code: 200 ms budget, always exit 0, any problem resolving `acct` falls back to `~/.claude`; `hook/tests/test_latency.py` must still pass.
- Stage inference stays a pure function; `fixtures/golden/*.expected.json` must pass unchanged (never run `golden:update` in this plan).
- Redact before anything touches disk. `accounts.json` and spool lines store the home prefix as `~`, never the user name.
- Server binds 127.0.0.1 only and never writes project folders or account dirs.
- Single account (no `accounts.json`, or one entry): no `account` on sessions, no `accounts`/`switch` in usage, no new counters. Current behavior unchanged.
- `accounts.json` format exactly: `{"accounts": [{"dir": "~/.claude", "label": "Team"}, {"dir": "~/.claude-personal", "label": "Pro"}]}`; order = display order; default account = dir `~/.claude`; default label = dir basename without the leading dot.
- `UsageZ.accounts` at most 8 entries; `AccountUsageZ = { label, session, weekly, at }` (+ `primary`, `near`, see above).
- `FO_SWITCH_AT` default `0.9`; `1` turns the hint off. `from` reading < 10 min old; `to` reading < 6 h old.
- Copy, verbatim: hint `Team 92% of 5h: /handoff, continue in Pro`; status line `info chain: none (no Dryas in this dir)`.
- The hint is board-level: it never sets a card to waiting and never counts in "needs you" totals.
- The usage cache (`FO_USAGE_CACHE`) and `fable` belong to the default account only.
- Windows installer (`setup.ps1`, `uninstall.ps1`) unchanged.
- `cl` (spec §9): Python 3.9+ stdlib, no model call, 1 s timeout to `127.0.0.1:$FO_PORT`, falls back to the default account; `CLAUDE_CONFIG_DIR` unset for `~/.claude`.
- Fixtures and tests use `~/...` dirs or `/Users/p`, `/Users/dev` paths only; `node scripts/leakcheck.mjs fixtures` passes.
- Package test scripts set `TZ=Asia/Bangkok`; run targeted tests through them: `pnpm --filter @fo/server test <file>`, `pnpm --filter @fo/shared test <file>`, `pnpm --filter @fo/pwa test <file>`, `python3 -m pytest <file> -q`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `pwa/src/ui/drawer.ts` | modify | anchor the drawer above the slim row in portrait |
| `pwa/src/styles.css` | modify | `body.portrait #drawer` side insets; card account tag |
| `pwa/e2e/drawer-portrait.spec.ts` | create | portrait drawer at 1080×1920, 1440×2560, 820×1180 |
| `scripts/fo_install.py` | modify | chain optional; `account add/remove`; `FO_ACCT` in wired commands |
| `scripts/install.sh`, `scripts/uninstall.sh` | modify | record the account; partial uninstall of a second dir |
| `hook/fo_hook.py` | modify | `acct` on every spool line, dedup key per account |
| `server/src/accounts.ts` | create | `accounts.json` parsing/reloading, `~` handling, labels, per-account roots |
| `server/src/accountusage.ts` | create | persisted usage map (with migration), limits → wire |
| `server/src/switch.ts` | create | pure switch-hint rule |
| `server/src/config.ts` | modify | `accountsPath`, `switchAt`, nullable `transcriptsRoot`/`sessionsDir` |
| `server/src/ingest.ts`, `server/src/scrub.ts` | modify | read / keep `acct` |
| `server/src/engine.ts` | modify | account per session, usage map, switch on the wire |
| `server/src/transcript.ts`, `server/src/registry.ts`, `server/src/main.ts` | modify | several roots; wiring at start and on the 30 s tick |
| `shared/src/types.ts`, `shared/src/wire.ts`, `shared/src/towire.ts` | modify | `SessionState.acct`, `SessionZ.account`, `UsageZ.accounts/switch` |
| `pwa/src/ui/cards.ts` | modify | account label + "NO DRYAS" tag |
| `pwa/src/ui/usage.ts`, `pwa/src/ui/slim.ts`, `pwa/src/ui/tiles.css` | modify | one row per account, hint, slim marker |
| `server/src/http.ts` | modify | `GET /api/usage` (+ `?session=`) |
| `scripts/cl.py` | create | account launcher (`$FO_HOME/bin/cl`) |
| `helper/fo_open.py` | modify | Open/Restore through `cl` when present |
| `README.md`, `docs/ARCHITECTURE.md` | modify | docs |

---

### Task 1: Manual check — does Claude Code pass `CLAUDE_CONFIG_DIR` to hooks? (user, on the Mac)

Not testable in CI. The plan does not depend on the answer (the installer always writes `FO_ACCT` for non-default dirs); this records the fact and checks that the second dir has a statusline (without one, no usage ever arrives for that account).

**Files:** none in the repo (temporary files under `/tmp` and a backed-up `~/.claude-personal/settings.json`).

**Interfaces:** none.

- [ ] **Step 1: Add a temporary probe hook to the personal dir**

```sh
mkdir -p ~/.claude-personal
cat > /tmp/fo-env-probe.sh <<'EOF'
#!/bin/sh
{ date; echo "CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR-<unset>}"; } >> /tmp/fo-env-probe.log
cat >/dev/null
exit 0
EOF
chmod +x /tmp/fo-env-probe.sh
if [ -f ~/.claude-personal/settings.json ]; then cp ~/.claude-personal/settings.json /tmp/fo-probe-settings.bak; else echo '{}' > ~/.claude-personal/settings.json; touch /tmp/fo-probe-created; fi
/usr/bin/python3 - <<'EOF'
import json, os
p = os.path.expanduser("~/.claude-personal/settings.json")
d = json.load(open(p))
d.setdefault("hooks", {}).setdefault("SessionStart", []).append({"hooks": [{"type": "command", "command": "/tmp/fo-env-probe.sh"}]})
print("statusLine in this dir:", json.dumps(d.get("statusLine")))
json.dump(d, open(p, "w"), indent=2)
EOF
```

- [ ] **Step 2: Start one session in that dir and read the log**

```sh
CLAUDE_CONFIG_DIR=~/.claude-personal claude    # wait for the prompt, then type /exit
cat /tmp/fo-env-probe.log
```

Expected: a line `CLAUDE_CONFIG_DIR=/Users/<you>/.claude-personal`. If it says `<unset>`, nothing changes in this plan (FO_ACCT covers it), but the README line "Wire a dir only through install.sh" (Task 18) becomes a hard rule.

- [ ] **Step 3: Restore the settings file**

```sh
if [ -f /tmp/fo-probe-created ]; then rm ~/.claude-personal/settings.json /tmp/fo-probe-created; else mv /tmp/fo-probe-settings.bak ~/.claude-personal/settings.json; fi
rm -f /tmp/fo-env-probe.sh /tmp/fo-env-probe.log
```

- [ ] **Step 4: Note the statusline**

If Step 1 printed `statusLine in this dir: null`, the Pro account has no statusline and will never report usage. Copy the `statusLine` block from `~/.claude/settings.json` into `~/.claude-personal/settings.json` before running Task 6's install for that dir (the installer only wraps an existing simple statusline command). Write both answers (env passed yes/no, statusline yes/no) in the PR description. No commit.

---

### Task 2: Spend drawer readable in portrait

The real cause is in code, not only CSS: `placeDrawer()` (`pwa/src/ui/drawer.ts:60-64`) sets an inline `style.bottom = dock.clientHeight - #usage.offsetTop + 12`. In portrait `#usage` is `display:none` (`pwa/src/styles.css:224`), so `offsetTop` is 0 and the bottom inset equals the whole dock height: the drawer collapses to its padding. A CSS-only `body.portrait #drawer { bottom: … }` would lose to the inline style. Fix: anchor on `#slim` in portrait, plus a portrait CSS rule for the side insets.

**Files:**
- Create: `pwa/e2e/drawer-portrait.spec.ts`
- Modify: `pwa/src/ui/drawer.ts:1-4,59-64`
- Modify: `pwa/src/styles.css` (after line 159, `#drawer[hidden]{display:none}`)
- Test: `pwa/test/drawer.test.ts` (append)

**Interfaces:**
- Consumes: none.
- Produces: `export function drawerBottom(dockH: number, anchorTop: number): number` in `pwa/src/ui/drawer.ts`.

- [ ] **Step 1: Write the failing e2e test**

Create `pwa/e2e/drawer-portrait.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Rotated 1080p and 1440p monitors (the user's setup), plus a tablet. /spend is stubbed: the e2e spool has no spend.
const SIZES = [[1080, 1920], [1440, 2560], [820, 1180]] as const;
const ROWS = Array.from({ length: 24 }, (_, i) => ({
  project: `a-rather-long-project-name-number-${String(i).padStart(2, "0")}`,
  model: i % 2 ? "claude-sonnet-5-5" : "claude-opus-5-5", source: "claude", usd: 1234.5 - i * 37.25,
}));

for (const [w, h] of SIZES) {
  test(`portrait ${w}x${h}: spend drawer and the last row of each table are on screen`, async ({ page }) => {
    await page.route((url) => url.pathname === "/spend", (r) => r.fulfill({ json: { rows: ROWS, totalUsd: 1 } }));
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    const slim = page.locator("#slim");
    await expect(slim).toBeVisible();
    await slim.click();
    const drawer = page.locator("#drawer");
    await expect(drawer.locator(".dr-t")).toHaveCount(2);
    const diag = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>("#drawer")!, u = document.querySelector<HTMLElement>("#usage")!;
      return { inlineBottom: d.style.bottom, usageDisplay: getComputedStyle(u).display, usageTop: u.offsetTop, dockH: document.querySelector<HTMLElement>("#dock")!.clientHeight };
    });
    const box = (await drawer.boundingBox())!;
    expect(box.height, JSON.stringify(diag)).toBeGreaterThan(h * 0.25);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(h);
    for (const t of await drawer.locator(".dr-t").all()) {
      const last = t.locator("span").last();
      await last.scrollIntoViewIfNeeded();
      const lb = (await last.boundingBox())!;
      expect(lb.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(lb.y + lb.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#drawer .dr-t")].flatMap((t) => {
      const cols = t.classList.contains("two") ? 2 : 3;
      return [...t.children].filter((c, i) => i % cols !== 0 && c.scrollWidth > c.clientWidth).map((c) => c.textContent);
    }));
    expect(clipped).toEqual([]);
  });
}
```

- [ ] **Step 2: Run it to confirm it fails, and confirm the cause**

Run: `pnpm build && pnpm --filter @fo/pwa e2e e2e/drawer-portrait.spec.ts`
Expected: FAIL in all three sizes at `expect(box.height, …).toBeGreaterThan`. The failure message JSON must show `usageDisplay: "none"`, `usageTop: 0` and `inlineBottom` equal to `dockH + 12` px. If it shows anything else, stop and re-diagnose before changing code.

- [ ] **Step 3: Write the failing unit test**

Append to `pwa/test/drawer.test.ts` (add `ui` to the existing `../src/state` import: `import { store, ui } from "../src/state";`, and `drawerBottom` to the `../src/ui/drawer` import):

```ts
describe("placeDrawer", () => {
  const top = (sel: string, v: number) => Object.defineProperty(document.querySelector(sel)!, "offsetTop", { configurable: true, value: v });
  it("ends above the usage tiles in landscape and above the slim row in portrait", async () => {
    Object.defineProperty(document.querySelector("#dock")!, "clientHeight", { configurable: true, value: 1000 });
    top("#usage", 700); top("#slim", 900);
    await openDrawer("today");
    expect(drawer().style.bottom).toBe("312px");
    closeDrawer();
    ui.portrait = true;
    await openDrawer("today");
    expect(drawer().style.bottom).toBe("112px");
  });
  it("never goes negative", () => expect(drawerBottom(100, 400)).toBe(12));
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `pnpm --filter @fo/pwa test test/drawer.test.ts`
Expected: FAIL — `drawerBottom` is not exported, and the portrait case gives `312px`.

- [ ] **Step 5: Implement**

In `pwa/src/ui/drawer.ts` change the state import (line 3) to:

```ts
import { store, ui } from "../state";
```

Replace lines 59-64 (`/** The drawer ends just above the tile block …` through the end of `placeDrawer`) with:

```ts
/** Bottom inset that ends the drawer 12 px above the block that opened it. */
export function drawerBottom(dockH: number, anchorTop: number): number {
  return Math.max(0, dockH - anchorTop) + 12;
}

/** The drawer ends just above the block that opened it: the usage tiles in landscape, the slim row in portrait
 * (#usage is display:none there, so its offsetTop is 0). It never covers that block. */
function placeDrawer(): void {
  const d = $("#drawer")!, dock = $("#dock")!, anchor = $(ui.portrait ? "#slim" : "#usage")!;
  d.style.bottom = `${drawerBottom(dock.clientHeight, anchor.offsetTop)}px`;
}
```

In `pwa/src/styles.css`, after line 159 (`#drawer[hidden]{display:none}`), add:

```css
body.portrait #drawer{left:calc(var(--u)*72);right:calc(var(--u)*72)}
```

- [ ] **Step 6: Run unit and e2e tests**

Run: `pnpm --filter @fo/pwa test test/drawer.test.ts`
Expected: PASS.
Run: `pnpm build && pnpm --filter @fo/pwa e2e`
Expected: all specs PASS (the new spec in all three sizes, existing portrait/landscape specs unchanged).

- [ ] **Step 7: Commit**

```bash
git add pwa/src/ui/drawer.ts pwa/src/styles.css pwa/test/drawer.test.ts pwa/e2e/drawer-portrait.spec.ts
git commit -m "fix(pwa): spend drawer readable in portrait (anchor above the slim row)"
```

---

### Task 3: Installer wires a config dir without Dryas

**Files:**
- Modify: `scripts/fo_install.py:133-156` (`status`), `scripts/fo_install.py:322-361` (`main`, from `sp = …` to the final `return 0`)
- Test: `scripts/tests/test_fo_install.py` (append)

**Interfaces:**
- Consumes: none.
- Produces: `status(settings: dict, chain: dict | None, windows: bool = IS_WIN) -> list[str]` (chain `None` = no Dryas in this dir).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/test_fo_install.py`:

```python
def plain_dir(tmp_path, settings_text=None):
    (tmp_path / "settings.json").write_text(settings_text if settings_text is not None else json.dumps(base_settings()))
    return str(tmp_path)


def test_status_without_chain_says_info_not_warn():
    out = fi.status(fi.wire_settings(base_settings(), HOOK, windows=False), None, windows=False)
    assert "info chain: none (no Dryas in this dir)" in out
    assert not [l for l in out if l.startswith("warn")]
    assert not [l for l in out if l.startswith("ok chain")]


def test_cli_wire_status_unwire_without_chain(tmp_path):
    d = plain_dir(tmp_path)
    assert run_cli("wire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert fi.MARKER in (tmp_path / "settings.json").read_text()
    assert not (tmp_path / "jev").exists()
    st = run_cli("status", "--claude-dir", d, "--hook", HOOK)
    assert st.returncode == 0
    assert "info chain: none (no Dryas in this dir)" in st.stdout.splitlines()
    assert not [l for l in st.stdout.splitlines() if l.startswith("warn")]
    assert run_cli("unwire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert json.loads((tmp_path / "settings.json").read_text()) == base_settings()


def test_dry_run_without_chain_diffs_settings_only(tmp_path):
    d = plain_dir(tmp_path, json.dumps(base_settings(), indent=2) + "\n")
    before = snapshot(tmp_path)
    r = run_cli("wire", "--dry-run", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 0
    assert "+++ b/%s" % (tmp_path / "settings.json") in r.stdout
    assert "chain.json" not in r.stdout
    assert snapshot(tmp_path) == before


def test_unparsable_chain_is_still_an_error(tmp_path):
    d = plain_dir(tmp_path)
    (tmp_path / "jev").mkdir()
    (tmp_path / "jev" / "chain.json").write_text("{ nope")
    before = snapshot(tmp_path)
    for cmd in ("wire", "status"):
        r = run_cli(cmd, "--claude-dir", d, "--hook", HOOK)
        assert r.returncode == 1 and "chain.json" in r.stderr, cmd
    assert snapshot(tmp_path) == before
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `python3 -m pytest scripts/tests/test_fo_install.py -q -k "without_chain or unparsable_chain"`
Expected: FAIL — `status` iterates `None`, and the CLI exits 1 with `cannot read …/jev/chain.json`.

- [ ] **Step 3: Implement**

In `scripts/fo_install.py` replace the chain loop in `status` (lines 139-144) with:

```python
    if chain is None:
        out.append("info chain: none (no Dryas in this dir)")
    else:
        for kind in CHAIN_KINDS:
            stages = chain.get(kind, [])
            last = stages[-1].get("name") if stages else None
            out.append("ok chain %s" % kind if last == STAGE else "warn chain %s: flowobserve not last" % kind)
            if any(s.get("name") == "claude-office" for s in stages):
                out.append("warn chain %s: claude-office stage still present" % kind)
```

Replace `main` from line 322 (`sp = os.path.join(a.claude_dir, "settings.json")`) to the end of the function with:

```python
    sp = os.path.join(a.claude_dir, "settings.json")
    cp = os.path.join(a.claude_dir, "jev", "chain.json")
    try:
        s = read_json(sp)
    except (OSError, ValueError) as e:
        sys.stderr.write("fo_install: cannot read %s: %s\n" % (sp, e))
        return 1
    c = None
    if os.path.lexists(cp):  # no chain file = a plain config dir without Dryas: settings.json only
        try:
            c = read_json(cp)
        except (OSError, ValueError) as e:
            sys.stderr.write("fo_install: cannot read %s: %s\n" % (cp, e))
            return 1
    if a.cmd == "status":
        sys.stdout.write("\n".join(status(s, c)) + "\n")
        return 0
    wiring = a.cmd == "wire"
    try:
        new_s = wire_settings(s, a.hook, a.python) if wiring else unwire_settings(s)
    except (AttributeError, TypeError, ValueError) as e:
        sys.stderr.write("fo_install: cannot %s %s: %s\n" % (a.cmd, sp, e))
        return 1
    new_c = None
    if c is not None:
        try:
            new_c = wire_chain(c, a.hook, a.python) if wiring else unwire_chain(c)
        except (AttributeError, TypeError, ValueError) as e:
            sys.stderr.write("fo_install: cannot %s %s: %s\n" % (a.cmd, cp, e))
            return 1
    files = [(sp, s, new_s, render)] + ([(cp, c, new_c, render_chain)] if c is not None else [])
    if a.dry_run:
        out = []
        for path, old, new, rend in files:
            if old != new:
                with open(path, encoding="utf-8") as f:
                    before = f.read()
                out.extend(difflib.unified_diff(before.splitlines(True), rend(new).splitlines(True),
                                                "a/" + path, "b/" + path))
        sys.stdout.write("".join(out) if out else "no changes\n")
        return 0
    now = time.time()
    for path, _old, new, rend in files:
        write_json(path, new, now, rend)
    return 0
```

Also update the module docstring's first line to: `"""Wire flowobserve into a Claude config dir on macOS and Windows (settings.json hooks + statusline, jev/chain.json when Dryas is there) and render the launchd plist.`

- [ ] **Step 4: Run the whole installer suite**

Run: `python3 -m pytest scripts/tests/test_fo_install.py -q`
Expected: PASS (new and existing tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/fo_install.py scripts/tests/test_fo_install.py
git commit -m "feat(installer): wire, unwire and status work in a config dir without Dryas"
```

---

### Task 4: Installer `account add` / `account remove`

**Files:**
- Modify: `scripts/fo_install.py` (new functions after `helper_root`, line ~228; argparse and dispatch in `main`, lines 274-288)
- Test: `scripts/tests/test_fo_install.py` (append)

**Interfaces:**
- Consumes: `read_json`, `render` (existing).
- Produces (in `scripts/fo_install.py`):
  - `DEFAULT_ACCT = "~/.claude"`, `ACCOUNTS = "accounts.json"`
  - `acct_of_dir(d: str) -> str` — `abspath(expanduser(d))`, home prefix written as `~` (`"~/.claude-personal"`), no trailing slash
  - `default_label(acct: str) -> str`
  - `add_account(d: dict, acct: str, label: str | None, seed_default: bool = False) -> dict` (pure)
  - `remove_account(d: dict, acct: str) -> dict` (pure)
  - `read_accounts(path: str) -> dict`, `write_accounts(path: str, d: dict) -> None`
  - CLI: `fo_install.py account add|remove --claude-dir D [--label L] [--home FO_HOME]`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/test_fo_install.py`:

```python
def test_acct_of_dir_uses_tilde_for_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    assert fi.acct_of_dir(str(tmp_path / ".claude")) == "~/.claude"
    assert fi.acct_of_dir("~/.claude-personal/") == "~/.claude-personal"
    assert fi.acct_of_dir(str(tmp_path / "a" / ".." / ".claude-x")) == "~/.claude-x"
    assert fi.acct_of_dir("/opt/claude") == "/opt/claude"


def test_default_label_is_basename_without_dot():
    assert fi.default_label("~/.claude") == "claude"
    assert fi.default_label("~/.claude-personal") == "claude-personal"
    assert fi.default_label("/opt/work") == "work"


def test_add_account_keeps_order_no_duplicates_and_label_rules():
    d = fi.add_account({"accounts": []}, "~/.claude", None)
    d = fi.add_account(d, "~/.claude-personal", "Pro")
    again = fi.add_account(d, "~/.claude-personal", None)
    assert again == d == {"accounts": [{"dir": "~/.claude", "label": "claude"}, {"dir": "~/.claude-personal", "label": "Pro"}]}
    d2 = fi.add_account(d, "~/.claude", "Team")
    assert d2["accounts"][0] == {"dir": "~/.claude", "label": "Team"}
    assert d["accounts"][0]["label"] == "claude"  # input not mutated
    for bad in ("", "   ", "x" * 33, "a\nb"):
        with pytest.raises(ValueError):
            fi.add_account(d, "~/.claude-lab", bad)


def test_add_account_seeds_the_default_first_when_asked():
    d = fi.add_account({"accounts": []}, "~/.claude-personal", "Pro", seed_default=True)
    assert [a["dir"] for a in d["accounts"]] == ["~/.claude", "~/.claude-personal"]
    d = fi.add_account({"accounts": []}, "~/.claude", "Team", seed_default=True)
    assert d == {"accounts": [{"dir": "~/.claude", "label": "Team"}]}


def test_remove_account_keeps_order():
    d = {"accounts": [{"dir": "~/.claude", "label": "Team"}, {"dir": "~/.claude-lab", "label": "Lab"}, {"dir": "~/.claude-personal", "label": "Pro"}]}
    assert fi.remove_account(d, "~/.claude-lab") == {"accounts": [{"dir": "~/.claude", "label": "Team"}, {"dir": "~/.claude-personal", "label": "Pro"}]}
    assert fi.remove_account(d, "~/.nope") == d


def run_cli_env(env, *args):
    return subprocess.run([sys.executable, os.path.join(HERE, "fo_install.py"), *args], capture_output=True, text=True, env=env)


def test_cli_account_add_remove_is_atomic_and_idempotent(tmp_path):
    env = dict(os.environ, HOME=str(tmp_path))
    (tmp_path / ".claude").mkdir()
    home = tmp_path / ".flowobserve"
    path = home / "accounts.json"
    add = ("account", "add", "--home", str(home), "--claude-dir", str(tmp_path / ".claude-personal"), "--label", "Pro")
    r = run_cli_env(env, *add)
    assert r.returncode == 0, r.stderr
    want = {"accounts": [{"dir": "~/.claude", "label": "claude"}, {"dir": "~/.claude-personal", "label": "Pro"}]}
    assert json.loads(path.read_text()) == want
    assert run_cli_env(env, *add).returncode == 0
    assert json.loads(path.read_text()) == want
    assert not list(home.glob("*.fo-tmp"))
    if sys.platform != "win32":
        assert mode(path) == 0o600
    r = run_cli_env(env, "account", "remove", "--home", str(home), "--claude-dir", str(tmp_path / ".claude-personal"))
    assert r.returncode == 0, r.stderr
    assert json.loads(path.read_text()) == {"accounts": [{"dir": "~/.claude", "label": "claude"}]}


def test_cli_account_corrupt_file_aborts_without_write(tmp_path):
    env = dict(os.environ, HOME=str(tmp_path))
    home = tmp_path / ".flowobserve"
    home.mkdir()
    (home / "accounts.json").write_text("{ nope")
    r = run_cli_env(env, "account", "add", "--home", str(home), "--claude-dir", str(tmp_path / ".claude-x"))
    assert r.returncode == 1 and "accounts.json" in r.stderr and "Traceback" not in r.stderr
    assert (home / "accounts.json").read_text() == "{ nope"


def test_cli_account_rejects_bad_label(tmp_path):
    env = dict(os.environ, HOME=str(tmp_path))
    r = run_cli_env(env, "account", "add", "--home", str(tmp_path / ".flowobserve"), "--claude-dir", str(tmp_path / ".c"), "--label", "x" * 40)
    assert r.returncode == 1 and "label" in r.stderr
    assert not (tmp_path / ".flowobserve" / "accounts.json").exists()
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `python3 -m pytest scripts/tests/test_fo_install.py -q -k "acct_of_dir or default_label or account"`
Expected: FAIL with `AttributeError: module 'fo_install' has no attribute 'acct_of_dir'` and argparse rejecting `account`.

- [ ] **Step 3: Implement the functions**

In `scripts/fo_install.py` add after `helper_root` (before `def read_json`):

```python
DEFAULT_ACCT = "~/.claude"
ACCOUNTS = "accounts.json"
MAX_LABEL = 32


def acct_of_dir(d):
    """Account key of a config dir, as the hook writes it: absolute, normalized, home prefix as ~ (no user name)."""
    p = os.path.abspath(os.path.expanduser(d))
    home = os.path.abspath(os.path.expanduser("~"))
    if p == home or p.startswith(home + os.sep):
        p = "~" + p[len(home):].replace(os.sep, "/")
    return p


def default_label(acct):
    base = acct.rstrip("/").rsplit("/", 1)[-1]
    base = base[1:] if base.startswith(".") else base
    return (base if base and base != "~" else "claude")[:MAX_LABEL]


def _check_label(label):
    s = label.strip()
    if not 1 <= len(s) <= MAX_LABEL or any(ord(ch) < 32 for ch in s):
        raise ValueError("label must be 1-%d printable characters: %r" % (MAX_LABEL, label))
    return s


def add_account(d, acct, label, seed_default=False):
    """accounts.json with acct added at the end (or its label updated in place). Re-adding without a label keeps the label."""
    label = None if label is None else _check_label(label)
    rows = [dict(r) for r in d.get("accounts", [])]
    if seed_default and not rows and acct != DEFAULT_ACCT:
        rows.append({"dir": DEFAULT_ACCT, "label": default_label(DEFAULT_ACCT)})
    for r in rows:
        if r.get("dir") == acct:
            if label is not None:
                r["label"] = label
            return dict(d, accounts=rows)
    rows.append({"dir": acct, "label": label if label is not None else default_label(acct)})
    return dict(d, accounts=rows)


def remove_account(d, acct):
    return dict(d, accounts=[dict(r) for r in d.get("accounts", []) if r.get("dir") != acct])


def read_accounts(path):
    """Parsed accounts.json; a missing file is an empty list. A file that is not {"accounts": [{dir, ...}]} is an error."""
    if not os.path.exists(path):
        return {"accounts": []}
    d = read_json(path)
    rows = d.get("accounts")
    if not isinstance(rows, list) or not all(isinstance(r, dict) and isinstance(r.get("dir"), str) for r in rows):
        raise ValueError("%s: accounts must be a list of {dir, label}" % path)
    return d


def write_accounts(path, d):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".fo-tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(render(d))
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
```

- [ ] **Step 4: Wire the CLI**

In `main`, replace the `cmd` argument line (line 275) with these two lines:

```python
    ap.add_argument("cmd", choices=["wire", "unwire", "status", "plist", "helper-json", "helper-root", "plist-edition", "plist-disks", "account"])
    ap.add_argument("sub", nargs="?", choices=["add", "remove"])
```

After `ap.add_argument("--disks")` add:

```python
    ap.add_argument("--label")
```

Directly after `a = ap.parse_args(argv)` add:

```python
    if a.cmd == "account":
        if a.sub is None:
            ap.error("account needs add or remove")
        home = a.home or os.environ.get("FO_HOME") or os.path.expanduser("~/.flowobserve")
        path = os.path.join(home, ACCOUNTS)
        acct = acct_of_dir(a.claude_dir)
        try:
            existed = os.path.exists(path)
            d = read_accounts(path)
            if a.sub == "add":
                seed = not existed and os.path.isdir(os.path.expanduser(DEFAULT_ACCT))
                d = add_account(d, acct, a.label, seed)
            else:
                d = remove_account(d, acct)
            write_accounts(path, d)
        except (OSError, ValueError) as e:
            sys.stderr.write("fo_install: account %s (%s): %s\n" % (a.sub, ACCOUNTS, e))
            return 1
        sys.stdout.write("account %s: %s\n" % (a.sub, acct))
        return 0
```

- [ ] **Step 5: Run the installer suite**

Run: `python3 -m pytest scripts/tests/test_fo_install.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/fo_install.py scripts/tests/test_fo_install.py
git commit -m "feat(installer): account add/remove keeps \$FO_HOME/accounts.json"
```

---

### Task 5: Installer tags commands in a non-default dir with `FO_ACCT`

**Files:**
- Modify: `scripts/fo_install.py:37-47` (`hook_command`, `wrap_prefix`), `scripts/fo_install.py:104-115` (`wire_settings`), the `wire_settings(...)` call in `main`
- Test: `scripts/tests/test_fo_install.py` (append)

**Interfaces:**
- Consumes: `acct_of_dir`, `DEFAULT_ACCT` (Task 4).
- Produces:
  - `hook_command(hook, python=DEFAULT_PY, windows=IS_WIN, acct=None) -> str`
  - `wrap_prefix(hook, acct=None) -> str`
  - `wire_settings(d, hook, python=DEFAULT_PY, windows=IS_WIN, acct=None) -> dict`
  - `acct_tag(claude_dir: str) -> str | None` (None for `~/.claude`)
  - Wired POSIX hook command for a non-default dir, exactly: `/bin/sh -c 'FO_ACCT="~/.claude-personal" /usr/bin/python3 -S "<hook>" >/dev/null 2>&1; exit 0'`; statusline runs `exec /usr/bin/env FO_ACCT="~/.claude-personal" /usr/bin/python3 -S "<hook>" --usage -- "$0" "$@"`. Task 7's hook reads `FO_ACCT`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/test_fo_install.py`:

```python
PERSONAL = "~/.claude-personal"


def test_wire_tags_a_non_default_dir_with_fo_acct():
    d = fi.wire_settings(base_settings(), HOOK, windows=False, acct=PERSONAL)
    want = "/bin/sh -c 'FO_ACCT=\"~/.claude-personal\" /usr/bin/python3 -S \"%s\" >/dev/null 2>&1; exit 0'" % HOOK
    for ev in fi.SETTINGS_EVENTS:
        assert fo_cmds(d, ev) == [want], ev
    sl = d["statusLine"]["command"]
    assert sl == fi.wrap_prefix(HOOK, PERSONAL) + HUD
    assert 'exec /usr/bin/env FO_ACCT="~/.claude-personal" /usr/bin/python3 -S "%s" --usage -- "$0" "$@"' % HOOK in sl
    assert all(l.startswith("ok ") for l in fi.status(d, fi.wire_chain(base_chain(), HOOK), windows=False))
    assert fi.unwire_settings(d) == base_settings()
    assert fi.wire_settings(d, HOOK, windows=False, acct=PERSONAL) == d  # idempotent


def test_default_dir_commands_are_unchanged():
    assert fi.hook_command(HOOK, windows=False, acct=None) == fi.hook_command(HOOK, windows=False)
    assert "FO_ACCT" not in json.dumps(fi.wire_settings(base_settings(), HOOK, windows=False))


def test_acct_with_shell_metacharacters_is_refused():
    for bad in ('/a"b', "/a'b", "/a$b", "/a`b", "/a\\b"):
        with pytest.raises(ValueError):
            fi.hook_command(HOOK, windows=False, acct=bad)


def test_acct_tag(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    assert fi.acct_tag(str(tmp_path / ".claude")) is None
    assert fi.acct_tag(str(tmp_path / ".claude-personal")) == "~/.claude-personal"


def test_cli_wire_second_dir_writes_fo_acct(tmp_path):
    env = dict(os.environ, HOME=str(tmp_path))
    d = tmp_path / ".claude-personal"
    d.mkdir()
    (d / "settings.json").write_text(json.dumps(base_settings()))
    assert run_cli_env(env, "wire", "--claude-dir", str(d), "--hook", HOOK).returncode == 0
    s = json.loads((d / "settings.json").read_text())
    assert all('FO_ACCT="~/.claude-personal"' in c for c in fo_cmds(s, "Stop"))
    assert run_cli_env(env, "unwire", "--claude-dir", str(d), "--hook", HOOK).returncode == 0
    assert json.loads((d / "settings.json").read_text()) == base_settings()
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `python3 -m pytest scripts/tests/test_fo_install.py -q -k "fo_acct or default_dir_commands or metacharacters or acct_tag"`
Expected: FAIL with `TypeError: wire_settings() got an unexpected keyword argument 'acct'`.

- [ ] **Step 3: Implement**

Replace `hook_command` and `wrap_prefix` (lines 37-47) with:

```python
UNSAFE_ACCT = re.compile(r"[\"'$`\\\x00-\x1f]")


def _acct_env(acct):
    """FO_ACCT="<acct>" for a POSIX command line; the value sits in double quotes inside the single-quoted sh -c script."""
    if UNSAFE_ACCT.search(acct):
        raise ValueError("unsupported characters in claude dir: %r" % acct)
    return 'FO_ACCT="%s"' % acct


def hook_command(hook, python=DEFAULT_PY, windows=IS_WIN, acct=None):
    if windows:
        # No /bin/sh on Windows; the hook never prints and always exits 0 (windows spec §3.4). Windows keeps the default account.
        return '"%s" -X utf8 -S "%s"' % (_fwd(python), _fwd(hook))
    env = "" if acct is None else _acct_env(acct) + " "
    return "/bin/sh -c '" + env + python + " -S \"" + hook + "\" >/dev/null 2>&1; exit 0'"


def wrap_prefix(hook, acct=None):
    # The original statusline command follows verbatim; the outer shell splits it into "$0" "$@".
    run = "exec /usr/bin/python3" if acct is None else "exec /usr/bin/env " + _acct_env(acct) + " /usr/bin/python3"
    return (WRAP_HEAD + hook + "\" ]; then " + run + " -S \"" + hook + "\" --usage -- \"$0\" \"$@\"; "
            "else exec \"$0\" \"$@\"; " + WRAP_TAIL)


def acct_tag(claude_dir):
    """FO_ACCT for a dir's wired commands; None for the default ~/.claude (the hook defaults to it)."""
    acct = acct_of_dir(claude_dir)
    return None if acct == DEFAULT_ACCT else acct
```

`acct_tag` calls `acct_of_dir`, defined later in the module by Task 4; that is fine at call time.

Replace `wire_settings` (lines 104-115) with:

```python
def wire_settings(d, hook, python=DEFAULT_PY, windows=IS_WIN, acct=None):
    d = unwire_settings(d)
    hooks = d.setdefault("hooks", {})
    for ev in SETTINGS_EVENTS:
        group = {"hooks": [{"type": "command", "command": hook_command(hook, python, windows, acct), "timeout": 2}]}
        if ev in TOOL_EVENTS:
            group = {"matcher": "*", **group}
        hooks.setdefault(ev, []).append(group)
    sl = d.get("statusLine")
    if not windows and isinstance(sl, dict) and isinstance(sl.get("command"), str) and sl["command"] and _simple(sl["command"]):
        sl["command"] = wrap_prefix(hook, acct) + sl["command"]
    return d
```

In `main`, change the wire call to:

```python
        new_s = wire_settings(s, a.hook, a.python, acct=acct_tag(a.claude_dir)) if wiring else unwire_settings(s)
```

- [ ] **Step 4: Run the installer suites**

Run: `python3 -m pytest scripts/tests/test_fo_install.py scripts/tests/test_install_ps1.py -q`
Expected: PASS (existing `wrap_prefix(HOOK) + HUD` assertions still hold: the default string is unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/fo_install.py scripts/tests/test_fo_install.py
git commit -m "feat(installer): tag hook and statusline commands in a non-default dir with FO_ACCT"
```

---

### Task 6: `install.sh` records the account; `uninstall.sh` for a second dir keeps the server

**Files:**
- Modify: `scripts/install.sh:101-104`, `scripts/uninstall.sh`
- Modify: `scripts/tests/test_install_sh.py:21-27` (`sandbox` uses `$HOME/.claude`), append tests

**Interfaces:**
- Consumes: `fo_install.py account add|remove` (Task 4), `FO_ACCT` wiring (Task 5), chain-optional wiring (Task 3).
- Produces: documented flow `CLAUDE_DIR=~/.claude-personal FO_ACCOUNT_LABEL=Pro scripts/install.sh`; `CLAUDE_DIR=~/.claude-personal scripts/uninstall.sh` unwires only that dir.

- [ ] **Step 1: Point the sandbox at `$HOME/.claude` and write the failing test**

The existing `sandbox` uses `$HOME/claude`, which after this task is "a dir other than ~/.claude" and would make `uninstall.sh` partial. In `scripts/tests/test_install_sh.py` change line 22 from `claude = tmp_path / "claude"` to:

```python
    claude = tmp_path / ".claude"
```

Append:

```python
MARK = "/.flowobserve/bin/fo_hook.py"


def accounts(tmp_path):
    return json.loads((tmp_path / ".flowobserve" / "accounts.json").read_text())


def test_install_records_the_default_account(tmp_path):
    claude, env = sandbox(tmp_path)
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    assert accounts(tmp_path) == {"accounts": [{"dir": "~/.claude", "label": "claude"}]}
    assert "FO_ACCT" not in (claude / "settings.json").read_text()


def test_second_dir_install_and_uninstall_keep_the_server(tmp_path):
    claude, env = sandbox(tmp_path)
    assert run("install.sh", env).returncode == 0
    personal = tmp_path / ".claude-personal"
    personal.mkdir()
    (personal / "settings.json").write_text(json.dumps(SETTINGS))
    env2 = dict(env, CLAUDE_DIR=str(personal), FO_ACCOUNT_LABEL="Pro")
    r = run("install.sh", env2)
    assert r.returncode == 0, r.stderr
    assert "info chain: none (no Dryas in this dir)" in r.stdout
    assert accounts(tmp_path) == {"accounts": [{"dir": "~/.claude", "label": "claude"}, {"dir": "~/.claude-personal", "label": "Pro"}]}
    s = json.loads((personal / "settings.json").read_text())
    cmds = [h["command"] for g in s["hooks"]["Stop"] for h in g["hooks"]]
    assert any(MARK in c and 'FO_ACCT="~/.claude-personal"' in c for c in cmds)
    assert 'FO_ACCT="~/.claude-personal"' in s["statusLine"]["command"]
    u = run("uninstall.sh", env2)
    assert u.returncode == 0, u.stderr
    assert json.loads((personal / "settings.json").read_text()) == SETTINGS
    assert (tmp_path / "LA" / "com.promprit.flowobserve.plist").exists()
    assert accounts(tmp_path) == {"accounts": [{"dir": "~/.claude", "label": "claude"}]}
    assert MARK in (claude / "settings.json").read_text()
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `python3 -m pytest scripts/tests/test_install_sh.py -q`
Expected: the two new tests FAIL (`accounts.json` missing); existing tests PASS.

- [ ] **Step 3: Implement `install.sh`**

In `scripts/install.sh`, after line 104 (`if echo "$out" | grep -q '^warn'; then die "wiring incomplete (see warn lines)"; fi`) add:

```sh
"$PY" "$REPO/scripts/fo_install.py" account add --home "$FO_HOME" --claude-dir "$CLAUDE_DIR" ${FO_ACCOUNT_LABEL:+--label "$FO_ACCOUNT_LABEL"} \
  || die "account add failed"
```

Change line 2 to: `# Install flowobserve: build, copy the hook out of the repo, launchd agent, wire CLAUDE_DIR (default ~/.claude) and record it in accounts.json. Safe to re-run, once per config dir.`

- [ ] **Step 4: Implement `uninstall.sh`**

Replace `scripts/uninstall.sh` with:

```sh
#!/bin/sh
# Remove flowobserve wiring and the launchd agent. Keeps ~/.flowobserve (spool, fo.db, hook copy) and all .bak files.
# With CLAUDE_DIR set to a dir other than ~/.claude, only that dir is unwired and dropped from accounts.json;
# the server keeps running for the other accounts.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
FO_HOME=${FO_HOME:-$HOME/.flowobserve}
CLAUDE_DIR=${CLAUDE_DIR:-$HOME/.claude}
LA=${FO_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}
LABEL=com.promprit.flowobserve

/usr/bin/python3 "$REPO/scripts/fo_install.py" unwire --claude-dir "$CLAUDE_DIR" --hook "$FO_HOME/bin/fo_hook.py" \
  || { echo "uninstall: unwire failed; settings untouched" >&2; exit 1; }
if [ "${CLAUDE_DIR%/}" != "$HOME/.claude" ]; then
  /usr/bin/python3 "$REPO/scripts/fo_install.py" account remove --home "$FO_HOME" --claude-dir "$CLAUDE_DIR" \
    || { echo "uninstall: account remove failed" >&2; exit 1; }
  echo "flowobserve unwired from $CLAUDE_DIR. The server keeps running for your other accounts."
  exit 0
fi
if [ -z "${FO_SKIP_LAUNCHCTL-}" ] && [ -z "${FO_FAKE_LAUNCHCTL-}" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
fi
rm -f "$LA/$LABEL.plist"
rm -rf "$HOME/Applications/flowobserve-open.app"
rm -f "$FO_HOME/helper.json"
echo "flowobserve uninstalled. Data kept in $FO_HOME (delete by hand if wanted)."
```

- [ ] **Step 5: Run the shell-script suite**

Run: `python3 -m pytest scripts/tests/test_install_sh.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/install.sh scripts/uninstall.sh scripts/tests/test_install_sh.py
git commit -m "feat(installer): install.sh records the account; uninstall of a second dir keeps the server"
```

---

### Task 6b: Installer adds a minimal statusline when the dir has none

User decision (2026-10-12): flowobserve learns an account's limits only from its statusline, so when a config dir has no `statusLine` the installer adds a minimal one. Not on Windows (the statusline wrap is macOS-only today).

**Files:**
- Create: `hook/fo_status.py` (the minimal statusline)
- Modify: `scripts/fo_install.py` (`wire_settings`, `unwire_settings`, `status`)
- Modify: `scripts/install.sh` (copy `fo_status.py` next to `fo_hook.py` in `$FO_HOME/bin`)
- Test: `hook/tests/test_status.py` (new), `scripts/tests/test_fo_install.py` (append), `scripts/tests/test_install_sh.py` (append)

**Interfaces:**
- Consumes: `wrap_prefix(hook)` and `_wrapped(cmd)` (scripts/fo_install.py:44-52), the install.sh hook copy step.
- Produces:
  - `hook/fo_status.py`: reads the Claude Code statusline JSON on stdin, prints one line `<model.display_name> · 5h <N>%` (the ` · 5h <N>%` part only when `rate_limits.five_hour.used_percentage` is a number; `N` rounded to an integer). Any error (bad JSON, missing fields): prints `claude` and exits 0. Standard library only, Python 3.9, runs with `-S`.
  - `STATUS_MARKER = "fo_status.py"` in `scripts/fo_install.py`.
  - `wire_settings(d, hook, python, windows)`: when `windows` is false and `d` has no `statusLine` key, sets `d["statusLine"] = {"type": "command", "command": wrap_prefix(hook) + '/usr/bin/python3 -S "<dir of hook>/fo_status.py"'}`. An existing `statusLine` (any shape) is never replaced; the existing wrap rule still applies to it.
  - `unwire_settings(d)`: after unwrapping, if the remaining command contains `STATUS_MARKER`, deletes `d["statusLine"]` (the user had none before).
  - `status(...)`: prints `info statusline: added by flowobserve` when the statusline is ours, not a `warn`.

- [ ] **Step 1: Failing tests**
  - `hook/tests/test_status.py`: run `fo_status.py` as a subprocess with `-S` and stdin `{"model": {"display_name": "Opus"}, "rate_limits": {"five_hour": {"used_percentage": 41.4}}}` → stdout `Opus · 5h 41%\n`; without `rate_limits` → `Opus\n`; stdin `not json` → `claude\n`, exit code 0.
  - `scripts/tests/test_fo_install.py`: `wire_settings({}, "/h/.flowobserve/bin/fo_hook.py", windows=False)["statusLine"]["command"]` starts with `wrap_prefix(...)` and ends with `-S "/h/.flowobserve/bin/fo_status.py"`; with `windows=True` there is no `statusLine`; an existing `{"statusLine": {"type": "command", "command": "mystatus"}}` is wrapped, not replaced; `unwire_settings(wire_settings({}, ...))` has no `statusLine` key; unwire of a wrapped user statusline restores the user command exactly; `status` on an added statusline prints the `info` line and no `warn`.
  - `scripts/tests/test_install_sh.py`: after install into a sandbox whose `settings.json` has no `statusLine`, `$FO_HOME/bin/fo_status.py` exists and `settings.json` has the added statusline; uninstall removes it.

- [ ] **Step 2: Run them, expect failures** — `python3 -m pytest hook/tests/test_status.py scripts/tests/test_fo_install.py scripts/tests/test_install_sh.py -q`

- [ ] **Step 3: Implement** `hook/fo_status.py`, the three `fo_install.py` changes and the install.sh copy (same copy-and-check pattern the script uses for `fo_hook.py`, failing with `copy fo_status.py failed`).

- [ ] **Step 4: Run the tests again, expect PASS**, then the full `pnpm test` (pytest part) to check nothing else moved.

- [ ] **Step 5: Commit** — `git add hook/fo_status.py hook/tests/test_status.py scripts/fo_install.py scripts/install.sh scripts/tests && git commit -m "feat(install): add a minimal statusline when the config dir has none"`

---

### Task 7: Hook tags every spool line with `acct`

**Files:**
- Modify: `hook/fo_hook.py` (constants near line 18, new `acct_of` after `term_info` line 181, `fit` lines 141-145, `run_hook` lines 194-219, `record_usage` lines 259-278)
- Modify: `hook/tests/test_usage.py` (`run` helper; `test_stale_state_entries_pruned`)
- Create: `hook/tests/test_acct.py`

**Interfaces:**
- Consumes: the installer's `FO_ACCT="<acct>"` command prefix (Task 5).
- Produces:
  - `DEFAULT_ACCT = "~/.claude"`, `acct_of(env=os.environ) -> str` in `hook/fo_hook.py`
  - Every spool line from `run_hook` (normal and truncated) and `record_usage` has `"acct": "<~dir or absolute path>"`.
  - `usage-last.json` keys are `acct + "|" + sid`.

- [ ] **Step 1: Make the usage tests independent of the caller's env, and write the failing tests**

In `hook/tests/test_usage.py` replace `run` with:

```python
def run(stdin, home, *cmd, **env_extra):
    env = dict(os.environ, FO_HOME=str(home))
    for k in ("FO_ACCT", "CLAUDE_CONFIG_DIR"):
        env.pop(k, None)
    env.update(env_extra)
    args = [PY, "-S", HOOK, "--usage"] + (["--"] + list(cmd) if cmd else [])
    return subprocess.run(args, input=stdin, capture_output=True, env=env, timeout=5)
```

and in `test_stale_state_entries_pruned` change the last assertion to:

```python
    assert "old" not in state and "recent" in state and "~/.claude|1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" in state
```

Create `hook/tests/test_acct.py`:

```python
import json
import os
import subprocess
import sys
import time

import pytest

from conftest import HOOK, HOOK_DIR, PY

sys.path.insert(0, os.path.join(os.path.dirname(HOOK_DIR), "scripts"))
import fo_install  # noqa: E402
import fo_hook  # noqa: E402

SID = "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b"
STATUSLINE = os.path.join(os.path.dirname(HOOK_DIR), "fixtures", "statusline.json")


def env_for(fo_home, home, **extra):
    e = dict(os.environ, FO_HOME=str(fo_home), HOME=str(home))
    for k in ("FO_ACCT", "CLAUDE_CONFIG_DIR"):
        e.pop(k, None)
    e.update(extra)
    return e


def lines(fo_home):
    p = os.path.join(str(fo_home), "spool", time.strftime("%Y-%m-%d") + ".jsonl")
    return [json.loads(l) for l in open(p, "rb").read().splitlines()] if os.path.exists(p) else []


def pre():
    return json.dumps({"session_id": SID, "cwd": "/Users/p/app", "hook_event_name": "PreToolUse",
                       "tool_name": "Bash", "tool_input": {"command": "ls"}}).encode()


def hook(tmp_path, stdin, *args, **extra):
    return subprocess.run([PY, "-S", HOOK, *args], input=stdin, capture_output=True,
                          env=env_for(tmp_path / "fo", tmp_path, **extra), timeout=5)


def test_acct_of_rules(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    assert fo_hook.acct_of({}) == "~/.claude"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": str(tmp_path / ".claude-personal")}) == "~/.claude-personal"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": str(tmp_path / ".claude-personal") + "/"}) == "~/.claude-personal"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": "~/.claude-personal"}) == "~/.claude-personal"
    assert fo_hook.acct_of({"FO_ACCT": "~/.claude-work", "CLAUDE_CONFIG_DIR": "~/.claude-personal"}) == "~/.claude-work"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": "/opt/claude"}) == "/opt/claude"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": "/x" * 200}) == "~/.claude"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": ""}) == "~/.claude"


def test_hook_line_has_default_acct(tmp_path):
    assert hook(tmp_path, pre()).returncode == 0
    [l] = lines(tmp_path / "fo")
    assert l["acct"] == "~/.claude"


def test_hook_line_uses_config_dir_with_tilde(tmp_path):
    hook(tmp_path, pre(), CLAUDE_CONFIG_DIR=str(tmp_path / ".claude-personal"))
    [l] = lines(tmp_path / "fo")
    assert l["acct"] == "~/.claude-personal"
    assert str(tmp_path) not in json.dumps(l)


def test_truncated_line_has_acct(tmp_path):
    p = {"session_id": SID, "cwd": "/a", "hook_event_name": "PostToolUse", "tool_name": "Read",
         "tool_input": {"file_path": "/a/x"}, "tool_response": {"content": "q" * 1200000}}
    hook(tmp_path, json.dumps(p).encode(), FO_ACCT="~/.claude-personal")
    [l] = lines(tmp_path / "fo")
    assert l["truncated"] is True and l["acct"] == "~/.claude-personal"


def test_statusline_line_has_acct_and_dedups_per_account(tmp_path):
    data = open(STATUSLINE, "rb").read()
    hook(tmp_path, data, "--usage")
    hook(tmp_path, data, "--usage")
    hook(tmp_path, data, "--usage", FO_ACCT="~/.claude-personal")
    got = lines(tmp_path / "fo")
    assert [l["acct"] for l in got] == ["~/.claude", "~/.claude-personal"]
    state = json.load(open(os.path.join(str(tmp_path / "fo"), "usage-last.json")))
    sid = got[0]["sid"]
    assert sorted(state) == sorted(["~/.claude|" + sid, "~/.claude-personal|" + sid])


def test_fit_final_fallback_keeps_acct_bounded():
    line = {"v": 1, "ts": "t", "src": "hook", "sid": "s" * 10000, "cwd": "c" * 10000, "event": "PreToolUse",
            "acct": "~/.claude-personal", "payload": {"hook_event_name": "PreToolUse", "fo": {"say": "x"}}}
    out = json.loads(fo_hook.fit(line))
    assert out["acct"] == "~/.claude-personal"


@pytest.mark.skipif(sys.platform == "win32" or not os.path.exists("/usr/bin/python3"), reason="POSIX wiring only")
def test_installer_commands_reach_the_hook(tmp_path):
    acct = "~/.claude-personal"
    env = env_for(tmp_path / "fo", tmp_path)
    cmd = fo_install.hook_command(HOOK, python=PY, windows=False, acct=acct)
    subprocess.run(cmd, shell=True, input=pre(), env=env, timeout=5)
    sl = fo_install.wrap_prefix(HOOK, acct) + "/bin/cat"
    r = subprocess.run(sl, shell=True, input=open(STATUSLINE, "rb").read(), env=env, capture_output=True, timeout=5)
    assert r.returncode == 0 and r.stdout == open(STATUSLINE, "rb").read()
    assert [l["acct"] for l in lines(tmp_path / "fo")] == [acct, acct]
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `python3 -m pytest hook/tests/test_acct.py hook/tests/test_usage.py -q`
Expected: FAIL — `module 'fo_hook' has no attribute 'acct_of'`, `KeyError: 'acct'`, and the state key assertion.

- [ ] **Step 3: Implement**

In `hook/fo_hook.py`, after `USAGE_TTL_S = 86400` (line 17) add:

```python
DEFAULT_ACCT = "~/.claude"
MAX_ACCT = 256
```

After `term_info` (line 181) add:

```python
def acct_of(env=os.environ):
    """Claude account (config dir) of this process: FO_ACCT (the installer sets it for non-default dirs), else
    CLAUDE_CONFIG_DIR, else ~/.claude. The home prefix is written as ~ so no user name reaches the spool."""
    try:
        raw = env.get("FO_ACCT") or env.get("CLAUDE_CONFIG_DIR") or ""
        if not raw or len(raw) > MAX_ACCT:
            return DEFAULT_ACCT
        home = os.path.abspath(os.path.expanduser("~"))
        p = os.path.abspath(os.path.expanduser(raw))
        if p == home or p.startswith(home + os.sep):
            p = "~" + p[len(home):].replace(os.sep, "/")
        return p if len(p) <= MAX_ACCT else DEFAULT_ACCT
    except Exception:
        return DEFAULT_ACCT
```

In `fit`, replace the last three lines (from `for k in ("sid", "cwd", "event"):`) with:

```python
    for k in ("sid", "cwd", "event"):
        line[k] = _clip(str(line.get(k, "")), CLIP_FINAL)
    if "acct" in line:
        line["acct"] = _clip(str(line["acct"]), CLIP_FINAL)
    return encode(line)
```

In `run_hook`, in the truncated branch replace the `line = {…}` dict with:

```python
        line = {
            "v": 1, "ts": iso_utc(now), "src": "hook",
            "sid": payload.get("session_id", ""), "cwd": payload.get("cwd", ""), "acct": acct_of(),
            "event": payload.get("hook_event_name", ""), "payload": redact_obj(payload), "truncated": True,
        }
```

and the normal `line = {…}` dict with:

```python
    line = {
        "v": 1, "ts": iso_utc(now), "src": "hook",
        "sid": str(payload.get("session_id", "")), "cwd": str(payload.get("cwd", "")), "acct": acct_of(),
        "event": str(payload.get("hook_event_name", "")), "payload": redact_obj(payload),
    }
```

In `record_usage`, after `cwd = str(raw.get("cwd") or ws.get("current_dir") or "")` add:

```python
    acct = acct_of()
    skey = acct + "|" + sid
```

then replace `last = state.get(sid)` with `last = state.get(skey)`, replace the `line = {…}` with:

```python
    line = {"v": 1, "ts": iso_utc(now), "src": "statusline", "sid": sid, "cwd": cwd, "acct": acct, "event": "usage",
            "payload": redact_obj(payload)}
```

and replace `state[sid] = [key, now]` with `state[skey] = [key, now]`.

- [ ] **Step 4: Run the hook suite, latency included**

Run: `python3 -m pytest hook/tests -q`
Expected: PASS (on a quiet Mac `test_latency.py` runs; it is skipped when `CI` is set).

- [ ] **Step 5: Commit**

```bash
git add hook/fo_hook.py hook/tests/test_acct.py hook/tests/test_usage.py
git commit -m "feat(hook): tag every spool line with the Claude account (acct)"
```

---

### Task 8: Server accounts module

**Files:**
- Create: `server/src/accounts.ts`
- Modify: `server/src/config.ts:30` (Config interface), `server/src/config.ts:37-54` (`loadConfig` return)
- Test: `server/test/accounts.test.ts`

**Interfaces:**
- Consumes: none.
- Produces (in `server/src/accounts.ts`):
  - `DEFAULT_ACCT = "~/.claude"`, `MAX_ACCOUNTS = 8`, `MAX_LABEL = 32`
  - `interface Account { dir: string; label: string; dryas: boolean }`
  - `type Exists = (p: string) => boolean`
  - `canonAcct(x: unknown): string | null`
  - `expandHome(dir: string, home?: string): string`
  - `defaultLabel(dir: string): string`
  - `makeAccount(dir: string, label: string | null, home: string, exists: Exists): Account`
  - `parseAccounts(text: string | null, home: string, exists: Exists): { accounts: Account[]; error: string | null }`
  - `class AccountsFile { constructor(file: string, home?: string, exists?: Exists); check(): boolean; accounts(): Account[] }`
- `Config.accountsPath: string` (`$FO_HOME/accounts.json`).

- [ ] **Step 1: Write the failing tests**

Create `server/test/accounts.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountsFile, DEFAULT_ACCT, canonAcct, defaultLabel, expandHome, parseAccounts } from "../src/accounts";
import { loadConfig } from "../src/config";

const HOME = "/Users/dev";
const none = () => false;
const dryasIn = (...dirs: string[]) => (p: string) => dirs.some((d) => p === path.join(d, "jev", "chain.json"));

describe("canonAcct", () => {
  it("keeps ~ and absolute forms without trailing slashes; anything else is null", () => {
    expect(canonAcct("~/.claude-personal/")).toBe("~/.claude-personal");
    expect(canonAcct("/opt/claude")).toBe("/opt/claude");
    expect(canonAcct("~")).toBe("~");
    for (const bad of ["", "/", "relative/dir", "~x", 42, null, "/" + "a".repeat(300)]) expect(canonAcct(bad)).toBeNull();
  });
});

describe("defaultLabel / expandHome", () => {
  it("label = basename without its leading dot", () => {
    expect(defaultLabel("~/.claude")).toBe("claude");
    expect(defaultLabel("~/.claude-personal")).toBe("claude-personal");
    expect(defaultLabel("/opt/work")).toBe("work");
    expect(defaultLabel("~/." + "x".repeat(40))).toHaveLength(32);
  });
  it("expands only the home prefix", () => {
    expect(expandHome("~/.claude", HOME)).toBe(path.join(HOME, ".claude"));
    expect(expandHome("~", HOME)).toBe(HOME);
    expect(expandHome("/opt/x", HOME)).toBe("/opt/x");
  });
});

describe("parseAccounts", () => {
  it("missing file: the default account only, Dryas from its chain file", () => {
    expect(parseAccounts(null, HOME, dryasIn(path.join(HOME, ".claude"))))
      .toEqual({ accounts: [{ dir: DEFAULT_ACCT, label: "claude", dryas: true }], error: null });
  });
  it("file order and labels; duplicates and bad dirs dropped; at most 8", () => {
    const text = JSON.stringify({ accounts: [
      { dir: "~/.claude", label: "Team" }, { dir: "~/.claude-personal/", label: "  Pro  " }, { dir: "~/.claude-personal" },
      { dir: "relative" }, { dir: "~/.claude-lab" }, ...Array.from({ length: 10 }, (_, i) => ({ dir: `~/.c${i}` })),
    ] });
    const { accounts, error } = parseAccounts(text, HOME, dryasIn(path.join(HOME, ".claude")));
    expect(error).toBeNull();
    expect(accounts.slice(0, 3)).toEqual([
      { dir: "~/.claude", label: "Team", dryas: true },
      { dir: "~/.claude-personal", label: "Pro", dryas: false },
      { dir: "~/.claude-lab", label: "claude-lab", dryas: false },
    ]);
    expect(accounts).toHaveLength(8);
  });
  it("bad JSON or no accounts array: default only, with an error to log", () => {
    for (const t of ["{bad", "null", "[]", '{"accounts":{}}']) {
      const r = parseAccounts(t, HOME, none);
      expect(r.accounts.map((a) => a.dir)).toEqual([DEFAULT_ACCT]);
      expect(r.error).not.toBeNull();
    }
  });
  it("an empty list: default only, no error", () => {
    expect(parseAccounts('{"accounts":[]}', HOME, none)).toEqual({ accounts: [{ dir: DEFAULT_ACCT, label: "claude", dryas: false }], error: null });
  });
});

describe("AccountsFile", () => {
  it("re-reads only when the file appears, changes or goes; reports list changes", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fo-acc-")), "accounts.json");
    const f = new AccountsFile(file, HOME, none);
    expect(f.check()).toBe(false);
    expect(f.accounts().map((a) => a.label)).toEqual(["claude"]);
    fs.writeFileSync(file, JSON.stringify({ accounts: [{ dir: "~/.claude", label: "Team" }, { dir: "~/.claude-personal", label: "Pro" }] }));
    expect(f.check()).toBe(true);
    expect(f.accounts().map((a) => a.label)).toEqual(["Team", "Pro"]);
    expect(f.check()).toBe(false);
    fs.rmSync(file);
    expect(f.check()).toBe(true);
    expect(f.accounts().map((a) => a.label)).toEqual(["claude"]);
  });
});

describe("loadConfig accountsPath", () => {
  it("lives in FO_HOME", () => {
    expect(loadConfig({ ...process.env, FO_HOME: "/Users/dev/.flowobserve" }).accountsPath).toBe(path.join("/Users/dev/.flowobserve", "accounts.json"));
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter @fo/server test test/accounts.test.ts`
Expected: FAIL — `Failed to resolve import "../src/accounts"`.

- [ ] **Step 3: Implement `server/src/accounts.ts`**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The Claude config dir flowobserve always knew; lines without acct belong to it. */
export const DEFAULT_ACCT = "~/.claude";
export const MAX_ACCOUNTS = 8;
export const MAX_LABEL = 32;

export interface Account { dir: string; label: string; dryas: boolean }
export type Exists = (p: string) => boolean;

/** Account key as the hook and the installer write it: "~/x" or an absolute path, no trailing slash. null when unusable. */
export function canonAcct(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.trim().replace(/\/+$/, "");
  if (!s || s.length > 256) return null;
  return s === "~" || s.startsWith("~/") || s.startsWith("/") ? s : null;
}

export function expandHome(dir: string, home: string = os.homedir()): string {
  return dir === "~" ? home : dir.startsWith("~/") ? path.join(home, dir.slice(2)) : dir;
}

/** Basename without its leading dot: ~/.claude-personal → claude-personal. */
export function defaultLabel(dir: string): string {
  const base = dir.split("/").filter(Boolean).pop() ?? "";
  const b = base.startsWith(".") ? base.slice(1) : base;
  return (b && b !== "~" ? b : "claude").slice(0, MAX_LABEL);
}

/** dryas = <dir>/jev/chain.json exists, checked once when the accounts load. */
export function makeAccount(dir: string, label: string | null, home: string, exists: Exists): Account {
  return { dir, label: label ?? defaultLabel(dir), dryas: exists(path.join(expandHome(dir, home), "jev", "chain.json")) };
}

/** accounts.json text (null = missing) → accounts in file order. Unusable file or no usable entry → the default account only. */
export function parseAccounts(text: string | null, home: string, exists: Exists): { accounts: Account[]; error: string | null } {
  const fallback = [makeAccount(DEFAULT_ACCT, null, home, exists)];
  if (text === null) return { accounts: fallback, error: null };
  let list: unknown;
  try { list = (JSON.parse(text) as { accounts?: unknown }).accounts; } catch (err) { return { accounts: fallback, error: `bad JSON (${(err as Error).message})` }; }
  if (!Array.isArray(list)) return { accounts: fallback, error: "no accounts array" };
  const out: Account[] = [];
  for (const x of list) {
    const o = (x && typeof x === "object" ? x : {}) as { dir?: unknown; label?: unknown };
    const dir = canonAcct(o.dir);
    if (!dir || out.some((a) => a.dir === dir)) continue;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, MAX_LABEL) : null;
    out.push(makeAccount(dir, label, home, exists));
    if (out.length === MAX_ACCOUNTS) break;
  }
  return { accounts: out.length ? out : fallback, error: null };
}

/** $FO_HOME/accounts.json, re-read when its mtime changes (checked on the server's 30 s tick). */
export class AccountsFile {
  private mtime = -2; // -1 = missing, -2 = never checked
  private list: Account[];
  constructor(private file: string, private home: string = os.homedir(), private exists: Exists = fs.existsSync) {
    this.list = parseAccounts(null, home, exists).accounts;
  }

  /** True when the account list changed. Unreadable or malformed file: default account only, one log line. */
  check(): boolean {
    let mt = -1;
    try { mt = fs.statSync(this.file).mtimeMs; } catch { /* missing */ }
    if (mt === this.mtime) return false;
    this.mtime = mt;
    let text: string | null = null;
    if (mt !== -1) {
      try { text = fs.readFileSync(this.file, "utf8"); } catch (err) { console.error(`fo-server: cannot read ${this.file}: ${(err as Error).message}`); }
    }
    const r = parseAccounts(text, this.home, this.exists);
    if (r.error) console.error(`fo-server: ${this.file}: ${r.error}; using ~/.claude only`);
    const changed = JSON.stringify(r.accounts) !== JSON.stringify(this.list);
    this.list = r.accounts;
    return changed;
  }

  accounts(): Account[] { return this.list; }
}
```

- [ ] **Step 4: Add `accountsPath` to the config**

In `server/src/config.ts` line 30 add `accountsPath: string;` to the `Config` interface (after `helperJson: string;`), and in `loadConfig`'s returned object after `helperJson: path.join(home, "helper.json"),` add:

```ts
    accountsPath: path.join(home, "accounts.json"),
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @fo/server test test/accounts.test.ts`
Expected: PASS.
Run: `pnpm --filter @fo/server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/accounts.ts server/src/config.ts server/test/accounts.test.ts
git commit -m "feat(server): load accounts.json (labels, Dryas per dir, reload on change)"
```

---

### Task 9: Account per session on the wire

**Files:**
- Modify: `shared/src/types.ts:111-112` (add `acct?` next to `kind?`)
- Modify: `shared/src/wire.ts:66-67` (`SessionZ`, before `agents`)
- Modify: `shared/src/towire.ts:99-115` (`toWire`)
- Modify: `server/src/ingest.ts:4-7,41-52`
- Modify: `server/src/scrub.ts:113-115`
- Modify: `server/src/engine.ts` (imports; fields; `ingestSpool` line 119; `sessionFor` 167-173; new `setAccounts`/`accountOf`; `extraFor` 529-534)
- Modify: `server/src/main.ts:91-99` (load accounts) and the `TICK_MS` interval at lines 147-149
- Create: `shared/test/wire.accounts.test.ts`, `server/test/engine.accounts.test.ts`
- Modify: `server/test/scrub.test.ts` (append)

**Interfaces:**
- Consumes: `Account`, `AccountsFile`, `DEFAULT_ACCT`, `canonAcct`, `makeAccount` (Task 8); hook `acct` field (Task 7).
- Produces:
  - `SessionState.acct?: string` (set by the engine on the first event; absent in sessions saved before this change = default account)
  - `SessionZ.account: { label: string (1-32), dryas: boolean } | undefined`
  - `toWire(s, extra: { color?; runnable?; agentTokens?; now?; account?: { label: string; dryas: boolean } })`
  - `SpoolLine.acct?: string`
  - `Engine.setAccounts(list: Account[]): void`, `Engine.home: string`, `Engine.exists: (p: string) => boolean`, private `Engine.accounts: Account[]`, counter `unknownAccount`

- [ ] **Step 1: Write the failing shared tests**

Create `shared/test/wire.accounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toWire } from "../src/towire";
import type { SessionState } from "../src/types";
import { SessionZ, UsageZ } from "../src/wire";

const session = {
  id: "s1", name: "app", stage: 3, status: "active", tasksDone: 1, tasksTotal: 4,
  builders: ["working", "done", "idle"], deny: null, esc: false, msg: null, action: null,
  say: null, openUrl: "vscode://file/Users/p/app", startedAt: 1, since: 1, lastEventAt: 2,
  nodes: [], stageAt: [1, null, null, null, null, null, null], log: [],
};
const state: SessionState = {
  id: "s1", name: "app", cwd: "/Users/p/app", worktree: null, title: null, stage: 0, status: "active",
  tasksDone: 0, tasksTotal: 0, builders: ["idle", "idle", "idle"], slots: {}, overflow: [],
  pendingModels: [], subModel: {}, subStartedAt: {}, reviewersDue: 0, pendingReview: [], reviewSubs: {}, deny: null,
  waiting: null, esc: null, handoff: null, shippedAt: null,
  specThisCycle: false, planThisCycle: false, cycleStart: 100, stageAt: [100, null, null, null, null, null, null],
  cycleHadHandoff: false, cycleEscalations: 0, planSkillAt: null, reviewSkillAt: null, judgeAt: null, lastPre: null,
  lastCostUsd: null, say: null, log: [], startedAt: 100, since: 100, lastEventAt: 100, retired: false,
  open: {}, wrote: null, fromClear: false, ctx: null, handoffAt: null, acct: "~/.claude-personal",
};

describe("SessionZ account", () => {
  it("accepts a session without and with an account", () => {
    expect(SessionZ.parse(session)).toEqual(session);
    const s = { ...session, account: { label: "Pro", dryas: false } };
    expect(SessionZ.parse(s)).toEqual(s);
  });
  it("rejects extra keys and empty or long labels", () => {
    expect(SessionZ.safeParse({ ...session, account: { label: "Pro", dryas: false, dir: "~/.claude" } }).success).toBe(false);
    expect(SessionZ.safeParse({ ...session, account: { label: "", dryas: true } }).success).toBe(false);
    expect(SessionZ.safeParse({ ...session, account: { label: "x".repeat(33), dryas: true } }).success).toBe(false);
  });
});

describe("toWire account", () => {
  it("adds account only when the engine passes one; acct itself never goes on the wire", () => {
    expect("account" in toWire(state)).toBe(false);
    expect(JSON.stringify(toWire(state))).not.toContain("claude-personal");
    expect(toWire(state, { account: { label: "Pro", dryas: false } }).account).toEqual({ label: "Pro", dryas: false });
  });
});

// UsageZ cases are appended by later tasks.
void UsageZ;
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter @fo/shared test test/wire.accounts.test.ts`
Expected: FAIL — `SessionZ` rejects `account` (strict), and the `acct` property is a type error at typecheck time.

- [ ] **Step 3: Implement the shared changes**

`shared/src/types.ts`, after the `kind?: string;` line (line 112) add:

```ts
  /** Claude account (config dir, "~/.claude-personal"); set by the engine from the session's first spool line, never by the reducer. Absent = the default ~/.claude. */
  acct?: string;
```

`shared/src/wire.ts`, before `agents: z.array(AgentZ).max(16).optional(),` (line 66) add:

```ts
  account: z.object({ label: z.string().min(1).max(32), dryas: z.boolean() }).strict().optional(), // only with several accounts
```

`shared/src/towire.ts`, change the `toWire` signature (line 99) to:

```ts
export function toWire(s: SessionState, extra: { color?: string | null; runnable?: boolean; agentTokens?: Record<string, number>; now?: number; account?: { label: string; dryas: boolean } } = {}): Session {
```

and add as the last property of the returned object (after `agentTally: …,`):

```ts
    ...(extra.account ? { account: { label: extra.account.label, dryas: extra.account.dryas } } : {}),
```

- [ ] **Step 4: Run the shared tests**

Run: `pnpm --filter @fo/shared test`
Expected: PASS.

- [ ] **Step 5: Write the failing server tests**

Create `server/test/engine.accounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MsgZ, type Session } from "@fo/shared";
import type { Account } from "../src/accounts";
import { Engine } from "../src/engine";
import { parseSpoolLine } from "../src/ingest";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const TEAM: Account = { dir: "~/.claude", label: "Team", dryas: true };
const PRO: Account = { dir: "~/.claude-personal", label: "Pro", dryas: false };
const tag = (line: string, acct: string) => JSON.stringify({ ...JSON.parse(line), acct });

function setup(accounts: Account[] = [TEAM, PRO]) {
  const store = new Store(":memory:");
  const e = new Engine(store, () => at(60));
  e.exists = () => false;
  e.setAccounts(accounts);
  const sent: Session[] = [];
  e.out = { session: (s) => sent.push(s) };
  return { store, e, sent };
}
const last = (sent: Session[], id: string) => sent.filter((s) => s.id === id).at(-1)!;

describe("parseSpoolLine acct", () => {
  it("reads acct in canonical form; a bad or missing value is left out", () => {
    expect(parseSpoolLine(tag(mk().prompt(1), "~/.claude-personal/"))!.acct).toBe("~/.claude-personal");
    expect(parseSpoolLine(tag(mk().prompt(1), "relative"))!.acct).toBeUndefined();
    expect("acct" in parseSpoolLine(mk().prompt(1))!).toBe(false);
  });
});

describe("Engine accounts", () => {
  it("one account: no account on the wire, whatever the lines carry", () => {
    const { e, sent } = setup([TEAM]);
    e.ingestSpool(tag(mk("p1").prompt(1), PRO.dir));
    expect("account" in last(sent, "p1")).toBe(false);
  });

  it("two accounts: every card names its account; a line without acct is the default account", () => {
    const { e, sent } = setup();
    e.ingestSpool(mk("t1").prompt(1));
    e.ingestSpool(tag(mk("p1", "/Users/p/projects/web").prompt(2), PRO.dir));
    expect(last(sent, "t1").account).toEqual({ label: "Team", dryas: true });
    expect(last(sent, "p1").account).toEqual({ label: "Pro", dryas: false });
    expect(MsgZ.safeParse(e.snapshot()).success).toBe(true);
    expect(e.health().counts.unknownAccount).toBeUndefined();
  });

  it("the account is set by the first event and never changes", () => {
    const { e } = setup();
    e.ingestSpool(tag(mk("p1").prompt(1), PRO.dir));
    e.ingestSpool(tag(mk("p1").stop(2), TEAM.dir));
    expect(e.sessions.get("p1")!.acct).toBe(PRO.dir);
  });

  it("an unknown account shows its basename, is counted once per session and never dropped", () => {
    const { e, sent } = setup();
    e.ingestSpool(tag(mk("x1").prompt(1), "~/.claude-lab"));
    e.ingestSpool(tag(mk("x1").stop(2), "~/.claude-lab"));
    expect(last(sent, "x1").account).toEqual({ label: "claude-lab", dryas: false });
    expect(e.health().counts.unknownAccount).toBe(1);
  });

  it("setAccounts re-sends live cards with or without their account", () => {
    const { e, sent } = setup([TEAM]);
    e.ingestSpool(mk("t1").prompt(1));
    e.setAccounts([TEAM, PRO]);
    expect(last(sent, "t1").account).toEqual({ label: "Team", dryas: true });
    e.setAccounts([TEAM]);
    expect("account" in last(sent, "t1")).toBe(false);
  });

  it("the account survives a restart", () => {
    const { store, e } = setup();
    e.ingestSpool(tag(mk("p1").prompt(1), PRO.dir));
    const e2 = new Engine(store, () => at(70));
    e2.setAccounts([TEAM, PRO]);
    e2.load();
    expect(e2.snapshot().sessions.find((s) => s.id === "p1")!.account).toEqual({ label: "Pro", dryas: false });
  });
});
```

Append to `server/test/scrub.test.ts`:

```ts
describe("Scrubber acct", () => {
  it("keeps a ~ acct, maps an absolute one, adds none", () => {
    const s = mk();
    expect(parse(s.line(L("UserPromptSubmit", { session_id: "s-real-1" }, { acct: "~/.claude-personal" }))).acct).toBe("~/.claude-personal");
    expect(parse(s.line(L("UserPromptSubmit", { session_id: "s-real-1" }, { acct: "/Volumes/Disk/Dev/projects/cfg" }))).acct).toBe("/Users/dev/code/cfg");
    expect("acct" in parse(s.line(L("UserPromptSubmit", { session_id: "s-real-1" })))).toBe(false);
  });
});
```

- [ ] **Step 6: Run them to confirm they fail**

Run: `pnpm --filter @fo/server test test/engine.accounts.test.ts test/scrub.test.ts`
Expected: FAIL — `e.setAccounts is not a function`, `acct` undefined.

- [ ] **Step 7: Implement ingest and scrub**

`server/src/ingest.ts`: add the import `import { canonAcct } from "./accounts";` after line 2; in `SpoolLine` add `acct?: string;` after `term?: Term;`; replace the body of `parseSpoolLine` from `const term = termOf(o.term);` to the end with:

```ts
  const term = termOf(o.term);
  const acct = canonAcct(o.acct);
  return {
    v: 1, ts: o.ts, src: o.src === "statusline" || o.src === "helper" ? o.src : "hook", sid: o.sid, cwd: toPosix(str(o.cwd)),
    event: o.event, payload: o.payload, truncated: o.truncated === true, ...(term ? { term } : {}), ...(acct ? { acct } : {}),
  };
}
```

`server/src/scrub.ts`, after the `if (has(o, "term")) out.term = …;` line (line 114) add:

```ts
    if (typeof o.acct === "string") out.acct = o.acct.startsWith("~") ? o.acct : this.path(o.acct);
```

- [ ] **Step 8: Implement the engine**

`server/src/engine.ts`:

Add imports (after line 2 and among the local imports):

```ts
import os from "node:os";
import { DEFAULT_ACCT, makeAccount, type Account } from "./accounts";
```

Add fields after `machineBootAt = 0;` (line 73):

```ts
  /** Accounts from accounts.json, in display order; one = today's single-account board (no account on the wire). */
  private accounts: Account[] = [{ dir: DEFAULT_ACCT, label: "claude", dryas: true }];
  private unknownAccts = new Map<string, Account>();
  /** acct of the spool line being applied; a session takes it on its first event. */
  private lineAcct: string | null = null;
  home = os.homedir();
  exists: (p: string) => boolean = fs.existsSync;
```

In `ingestSpool` replace the last line `for (const e of events) this.apply(e);` with:

```ts
    this.lineAcct = l.acct ?? null;
    try { for (const e of events) this.apply(e); } finally { this.lineAcct = null; }
```

Replace `sessionFor` with:

```ts
  private sessionFor(e: Event): SessionState {
    const found = this.sessions.get(e.sid);
    if (found) return found;
    const s = initState(e.sid, e.cwd, e.ts, e);
    s.acct = this.lineAcct ?? DEFAULT_ACCT;
    if (!this.accounts.some((a) => a.dir === s.acct)) this.bump("unknownAccount");
    this.store.insert({ ...emptyEmit(), cycles: [openCycleRow(s)] });
    return s;
  }
```

Add after `liveIds()` (line 300):

```ts
  /** New account list (start and on accounts.json change): live cards are re-sent with or without their account. */
  setAccounts(list: Account[]): void {
    this.accounts = list.length ? list : [{ dir: DEFAULT_ACCT, label: "claude", dryas: true }];
    this.unknownAccts.clear();
    for (const s of this.live()) this.push(s);
    this.usageDirty = true;
    this.lastUsagePush = 0;
  }

  /** A listed account, or one built from the dir's basename for an acct the file does not list. */
  private accountOf(acct: string): Account {
    const known = this.accounts.find((a) => a.dir === acct);
    if (known) return known;
    let u = this.unknownAccts.get(acct);
    if (!u) { u = makeAccount(acct, null, this.home, this.exists); this.unknownAccts.set(acct, u); }
    return u;
  }
```

Replace `extraFor` with:

```ts
  private extraFor(s: SessionState): { color?: string | null; runnable?: boolean; agentTokens?: Record<string, number>; now?: number; account?: { label: string; dryas: boolean } } {
    const at = s.folderAbs ?? s.cwd;
    const p = [...this.scan.projects, ...this.extra.flatMap((x) => x.projects)].find((x) => x.folders.some((f) => f.abs === at || f.abs === s.cwd));
    const agentTokens = this.agentTok.get(s.id);
    const a = this.accounts.length > 1 ? this.accountOf(s.acct ?? DEFAULT_ACCT) : null;
    return { ...(p ? { color: p.color, runnable: !!p.run } : {}), ...(agentTokens ? { agentTokens } : {}), ...(a ? { account: { label: a.label, dryas: a.dryas } } : {}), now: this.now() };
  }
```

- [ ] **Step 9: Load the accounts in `main.ts`**

In `server/src/main.ts` add `import { AccountsFile } from "./accounts";` to the imports. After `engine.setProjectsRoot(cfg.projectsRoot);` (line 102) add:

```ts
const accountsFile = new AccountsFile(cfg.accountsPath);
accountsFile.check();
engine.setAccounts(accountsFile.accounts());
```

Replace the `TICK_MS` interval body (lines 147-149) with:

```ts
  setInterval(() => {
    try { if (accountsFile.check()) engine.setAccounts(accountsFile.accounts()); } catch (err) { console.error("fo-server: accounts failed:", err); }
    try { engine.tick(); } catch (err) { console.error("fo-server: tick failed:", err); }
  }, TICK_MS);
```

- [ ] **Step 10: Run server tests (goldens included) and typecheck**

Run: `pnpm --filter @fo/server test`
Expected: PASS, including `test/golden.test.ts` with no expected-file changes (`git status fixtures` shows nothing).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add shared/src/types.ts shared/src/wire.ts shared/src/towire.ts shared/test/wire.accounts.test.ts \
  server/src/ingest.ts server/src/scrub.ts server/src/engine.ts server/src/main.ts \
  server/test/engine.accounts.test.ts server/test/scrub.test.ts
git commit -m "feat(server): every session keeps its Claude account; cards name it when there are several"
```

---

### Task 10: Usage per account

**Files:**
- Create: `server/src/accountusage.ts`
- Modify: `shared/src/wire.ts:70-76` (`UsageZ`) and types at line ~139
- Modify: `server/src/engine.ts` (`usage` field line 50; `load` 88-94; `apply` 192-194; `setUsage` 302-309; `blocked` 374-382; `usageWire` 413-425)
- Create: `server/test/engine.usage.test.ts`
- Modify: `shared/test/wire.accounts.test.ts` (append)

**Interfaces:**
- Consumes: `DEFAULT_ACCT`, `canonAcct`, `Account` (Task 8); `Engine.accounts`, `SessionState.acct` (Task 9).
- Produces:
  - `AccountUsageZ` / `type AccountUsage = { label: string; session: {used, startedAt, windowMs}; weekly: {used, resetsAt}; at: number; primary?: true }` exported from `@fo/shared`
  - `UsageZ.accounts?: AccountUsage[]` (max 8, sent only with several accounts)
  - `usageFromStore(text: string | null): Map<string, ClaudeUsage>`, `usageToStore(m: Map<string, ClaudeUsage>): string`, `limitsWire(u: ClaudeUsage): Pick<Usage, "session" | "weekly">` in `server/src/accountusage.ts`
  - `Engine.setUsage(u: ClaudeUsage, acct: string = DEFAULT_ACCT): void`
  - private `Engine.usage: Map<string, ClaudeUsage>`, `Engine.primaryAcct(): string | null`, `Engine.accountRows(now: number): AccountUsage[]`

- [ ] **Step 1: Write the failing shared test**

Append to `shared/test/wire.accounts.test.ts`:

```ts
const usage = { session: { used: 0.4, startedAt: 0, windowMs: 18_000_000 }, weekly: { used: 0.2, resetsAt: 9 }, jev: null, at: 5 };
const row = { label: "Pro", session: usage.session, weekly: usage.weekly, at: 5 };

describe("UsageZ accounts", () => {
  it("accepts the old shape and the per-account shape", () => {
    expect(UsageZ.parse(usage)).toEqual(usage);
    expect(UsageZ.parse({ ...usage, accounts: [{ ...row, label: "Team", primary: true }, row] }).accounts).toHaveLength(2);
  });
  it("rejects more than 8 accounts and unknown row keys", () => {
    expect(UsageZ.safeParse({ ...usage, accounts: Array(9).fill(row) }).success).toBe(false);
    expect(UsageZ.safeParse({ ...usage, accounts: [{ ...row, dir: "~/.claude" }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @fo/shared test test/wire.accounts.test.ts`
Expected: FAIL — `accounts` is stripped by `UsageZ` (`toHaveLength(2)` on undefined) and the extra-key case parses.

- [ ] **Step 3: Implement the schema**

Replace `UsageZ` in `shared/src/wire.ts` (lines 70-76) with:

```ts
const SessionUseZ = z.object({ used: z.number().min(0).max(1), startedAt: z.number(), windowMs: z.number().positive() });
const WeeklyUseZ = z.object({ used: z.number().min(0).max(1), resetsAt: z.number() });
/** One account's plan limits (only with several accounts). primary = the account the top-level session/weekly/at describe. */
export const AccountUsageZ = z.object({
  label: z.string().min(1).max(32), session: SessionUseZ, weekly: WeeklyUseZ, at: z.number(),
  primary: z.literal(true).optional(),
}).strict();

export const UsageZ = z.object({
  session: SessionUseZ,
  weekly: WeeklyUseZ,
  jev: z.object({ usedUsd: z.number().min(0), budgetUsd: z.number().positive(), monthStart: z.number() }).nullable(),
  fable: z.object({ used: z.number().min(0).max(1), resetsAt: z.number() }).nullable().optional(),
  at: z.number(),
  accounts: z.array(AccountUsageZ).max(8).optional(),
});
```

After `export type Usage = z.infer<typeof UsageZ>;` add:

```ts
export type AccountUsage = z.infer<typeof AccountUsageZ>;
```

Run: `pnpm --filter @fo/shared test`
Expected: PASS.

- [ ] **Step 4: Write the failing server tests**

Create `server/test/engine.usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MsgZ } from "@fo/shared";
import type { Account } from "../src/accounts";
import { usageFromStore } from "../src/accountusage";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

const TEAM: Account = { dir: "~/.claude", label: "Team", dryas: true };
const PRO: Account = { dir: "~/.claude-personal", label: "Pro", dryas: false };
const tag = (line: string, acct: string) => JSON.stringify({ ...JSON.parse(line), acct });
const team = mk("t1"), pro = mk("p1", "/Users/p/projects/web");
const proUsage = (sec: number, pct5: number, pct7 = 10) => tag(pro.usage(sec, pct5, pct7, null), PRO.dir);
const reading = (pct5: number, sec: number) => ({ fiveHour: { pct: pct5, resetsAt: at(9000) }, sevenDay: { pct: 7, resetsAt: at(99000) }, fable: null, at: at(sec) });

function setup(accounts: Account[] = [TEAM, PRO], store = new Store(":memory:")) {
  const e = new Engine(store, () => at(60));
  e.setAccounts(accounts);
  return { store, e };
}

describe("usage per account", () => {
  it("interleaved readings never mix: one row per account, top level = default account", () => {
    const { e } = setup();
    e.ingestSpool(team.usage(30, 50, 25, null));
    e.ingestSpool(proUsage(31, 10, 5));
    e.ingestSpool(team.usage(32, 60, 26, null));
    e.ingestSpool(proUsage(33, 12, 6));
    const u = e.usageWire()!;
    expect(MsgZ.parse({ type: "usage", usage: u })).toBeTruthy();
    expect([u.session.used, u.weekly.used, u.at]).toEqual([0.6, 0.26, at(32)]);
    expect(u.accounts!.map((a) => [a.label, a.session.used, a.weekly.used, a.at, a.primary ?? false])).toEqual([
      ["Team", 0.6, 0.26, at(32), true], ["Pro", 0.12, 0.06, at(33), false]]);
  });

  it("the older-reading rule applies per account", () => {
    const { e } = setup();
    e.ingestSpool(proUsage(40, 30));
    e.ingestSpool(proUsage(35, 90));
    e.ingestSpool(team.usage(20, 70, 20, null));
    expect(e.usageWire()!.accounts!.map((a) => a.session.used)).toEqual([0.7, 0.3]);
  });

  it("the usage cache (setUsage without acct) feeds the default account only, fable included", () => {
    const { e } = setup();
    e.ingestSpool(proUsage(30, 10));
    e.setUsage({ ...reading(70, 40), fable: { pct: 31, resetsAt: at(50000) } });
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.7);
    expect(u.fable).toEqual({ used: 0.31, resetsAt: at(50000) });
    expect(u.accounts!.find((a) => a.label === "Pro")!.session.used).toBe(0.1);
  });

  it("an account without a reading has no row yet; only the default when Pro is first to report is not primary", () => {
    const { e } = setup();
    e.ingestSpool(proUsage(30, 10));
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.1);
    expect(u.accounts!.map((a) => [a.label, a.primary ?? false])).toEqual([["Pro", true]]);
  });

  it("one account: no accounts list on the wire", () => {
    const { e } = setup([TEAM]);
    e.ingestSpool(team.usage(30, 50, 25, null));
    expect("accounts" in e.usageWire()!).toBe(false);
  });

  it("persists the map and reloads it", () => {
    const { store, e } = setup();
    e.ingestSpool(team.usage(30, 50, 25, null));
    e.ingestSpool(proUsage(31, 10, 5));
    expect(Object.keys(JSON.parse(store.kvGet("usage")!))).toEqual(["~/.claude", "~/.claude-personal"]);
    const e2 = setup([TEAM, PRO], store).e;
    e2.load();
    expect(e2.usageWire()!.accounts!.map((a) => a.session.used)).toEqual([0.5, 0.1]);
  });

  it("an old single persisted value loads as the default account's", () => {
    const store = new Store(":memory:");
    store.kvSet("usage", JSON.stringify(reading(42, 1)));
    const { e } = setup([TEAM, PRO], store);
    e.load();
    const u = e.usageWire()!;
    expect(u.session.used).toBe(0.42);
    expect(u.accounts!.map((a) => a.label)).toEqual(["Team"]);
  });
});

describe("usageFromStore", () => {
  it("drops corrupt values and entries that are not readings", () => {
    expect(usageFromStore(null).size).toBe(0);
    expect(usageFromStore("{bad").size).toBe(0);
    const m = usageFromStore(JSON.stringify({ "~/.claude": reading(1, 1), "relative": reading(2, 2), "~/.x": { fiveHour: 1 } }));
    expect([...m.keys()]).toEqual(["~/.claude"]);
  });
});
```

- [ ] **Step 5: Run them to confirm they fail**

Run: `pnpm --filter @fo/server test test/engine.usage.test.ts`
Expected: FAIL — `Failed to resolve import "../src/accountusage"`.

- [ ] **Step 6: Implement `server/src/accountusage.ts`**

```ts
import type { Usage } from "@fo/shared";
import { DEFAULT_ACCT, canonAcct } from "./accounts";
import { FIVE_HOUR_MS } from "./config";
import type { ClaudeUsage } from "./usagecache";

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const isLimit = (x: unknown) => num(obj(x).pct) && num(obj(x).resetsAt);
const isUsage = (x: unknown): x is ClaudeUsage => isLimit(obj(x).fiveHour) && isLimit(obj(x).sevenDay) && num(obj(x).at);

/** kv "usage" → acct → reading. A value from before accounts (one reading) is the default account's. */
export function usageFromStore(text: string | null): Map<string, ClaudeUsage> {
  const out = new Map<string, ClaudeUsage>();
  if (!text) return out;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return out; }
  if (isUsage(v)) { out.set(DEFAULT_ACCT, v); return out; }
  for (const [k, x] of Object.entries(obj(v))) {
    const a = canonAcct(k);
    if (a && isUsage(x)) out.set(a, x);
  }
  return out;
}

export const usageToStore = (m: Map<string, ClaudeUsage>): string => JSON.stringify(Object.fromEntries(m));

const clamp = (x: number) => Math.min(1, Math.max(0, x / 100));

/** One reading's 5h and weekly meters, as the wire carries them. */
export function limitsWire(u: ClaudeUsage): Pick<Usage, "session" | "weekly"> {
  return {
    session: { used: clamp(u.fiveHour.pct), startedAt: u.fiveHour.resetsAt - FIVE_HOUR_MS, windowMs: FIVE_HOUR_MS },
    weekly: { used: clamp(u.sevenDay.pct), resetsAt: u.sevenDay.resetsAt },
  };
}
```

- [ ] **Step 7: Implement the engine changes**

`server/src/engine.ts`:

Add `type AccountUsage` to the `@fo/shared` type import list on line 3, and add:

```ts
import { limitsWire, usageFromStore, usageToStore } from "./accountusage";
```

Replace `private usage: ClaudeUsage | null = null;` (line 50) with:

```ts
  /** acct → latest plan-limit reading; a statusline line only ever updates its own account. */
  private usage = new Map<string, ClaudeUsage>();
```

Replace `load()` with:

```ts
  load(): void {
    for (const s of this.store.loadSessions()) this.sessions.set(s.id, s);
    this.usage = usageFromStore(this.store.kvGet("usage"));
  }
```

In `apply`, replace the Usage block (lines 192-194) with:

```ts
    if (e.k === "Usage" && e.fiveHour && e.sevenDay) {
      this.setUsage({ fiveHour: e.fiveHour, sevenDay: e.sevenDay, fable: null, at: e.ts }, this.sessions.get(e.sid)?.acct ?? DEFAULT_ACCT);
    }
```

Replace `setUsage` with:

```ts
  /** One account's reading (the usage cache has no acct: the default account). An older reading than the stored one is ignored. */
  setUsage(u: ClaudeUsage, acct: string = DEFAULT_ACCT): void {
    const prev = this.usage.get(acct);
    if (prev && u.at < prev.at) return;
    this.usage.set(acct, { ...u, fable: u.fable ?? prev?.fable ?? null });
    this.store.kvSet("usage", usageToStore(this.usage));
    this.usageDirty = true;
    this.lastUsagePush = 0;
  }

  /** The account the top-level usage describes: the default one, else the first listed account with a reading. */
  private primaryAcct(): string | null {
    if (this.usage.has(DEFAULT_ACCT)) return DEFAULT_ACCT;
    return this.accounts.find((a) => this.usage.has(a.dir))?.dir ?? null;
  }

  /** Listed accounts that have a reading, in file order. */
  private accountRows(now: number): AccountUsage[] {
    void now; // used by the switch hint (next task)
    const primary = this.primaryAcct();
    return this.accounts.flatMap((a) => {
      const x = this.usage.get(a.dir);
      return x ? [{ label: a.label, ...limitsWire(x), at: x.at, ...(a.dir === primary ? { primary: true as const } : {}) }] : [];
    });
  }
```

In `blocked()` replace the `const win = …` line with:

```ts
    const p = this.primaryAcct(), u = p ? this.usage.get(p)! : null;
    const win = u && u.fiveHour.resetsAt > now ? u.fiveHour.resetsAt - FIVE_HOUR_MS : now - FIVE_HOUR_MS;
```

Replace `usageWire()` with:

```ts
  usageWire(): Usage | null {
    const p = this.primaryAcct();
    if (!p) return null;
    const now = this.now();
    const clamp = (x: number) => Math.min(1, Math.max(0, x / 100));
    const u = this.usage.get(p)!;
    const base: Usage = {
      ...limitsWire(u),
      jev: this.jevPresent ? jevUsage(this.store.spendSince(monthStart(now)), now, JEV_BUDGET_USD) : null,
      fable: u.fable ? { used: clamp(u.fable.pct), resetsAt: u.fable.resetsAt } : null,
      at: u.at,
    };
    if (this.accounts.length < 2) return base;
    return { ...base, accounts: this.accountRows(now) };
  }
```

- [ ] **Step 8: Run server tests (goldens, old engine usage tests) and typecheck**

Run: `pnpm --filter @fo/server test`
Expected: PASS — including `test/engine.test.ts` usage tests and `test/golden.test.ts` unchanged.
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add shared/src/wire.ts shared/test/wire.accounts.test.ts server/src/accountusage.ts server/src/engine.ts server/test/engine.usage.test.ts
git commit -m "feat(server): plan limits per account; persisted usage becomes a map"
```

---

### Task 11: Switch hint

**Files:**
- Create: `server/src/switch.ts`
- Modify: `server/src/config.ts` (constant + `switchAtFrom` + `Config.switchAt`)
- Modify: `shared/src/wire.ts` (`AccountUsageZ.near`, `SwitchZ`, `UsageZ.switch`)
- Modify: `server/src/engine.ts` (`switchAt` field, `accountRows`, `usageWire`)
- Modify: `server/src/main.ts` (`engine.switchAt = cfg.switchAt;`)
- Create: `server/test/switch.test.ts`
- Modify: `shared/test/wire.accounts.test.ts` (append)

**Interfaces:**
- Consumes: `Engine.accounts`, `Engine.usage`, `accountRows`, `primaryAcct` (Tasks 9-10); `ClaudeUsage`.
- Produces:
  - `interface SwitchRow { label: string; used: number | null; at: number | null }`, `interface SwitchHint { from: string; to: string; used: number }`
  - `switchHint(rows: SwitchRow[], now: number, threshold: number): SwitchHint | null`, `usedNow(u: ClaudeUsage, now: number): number`, `FROM_FRESH_MS = 600_000`, `TO_FRESH_MS = 21_600_000`
  - `SWITCH_AT_DEFAULT = 0.9`, `switchAtFrom(v: string | undefined): number`, `Config.switchAt: number`
  - `UsageZ.switch?: { from: string; to: string; used: number } | null` (present, possibly null, only with several accounts); `AccountUsage.near?: boolean`
  - `Engine.switchAt: number`

- [ ] **Step 1: Write the failing shared test**

Append to `shared/test/wire.accounts.test.ts`:

```ts
describe("UsageZ switch", () => {
  it("accepts a hint, null or none; near on a row; used stays 0..1", () => {
    expect(UsageZ.parse({ ...usage, switch: { from: "Team", to: "Pro", used: 0.92 } }).switch).toEqual({ from: "Team", to: "Pro", used: 0.92 });
    expect(UsageZ.parse({ ...usage, switch: null }).switch).toBeNull();
    expect(UsageZ.parse({ ...usage, accounts: [{ ...row, near: true }] }).accounts![0].near).toBe(true);
    expect(UsageZ.safeParse({ ...usage, switch: { from: "Team", to: "Pro", used: 1.2 } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @fo/shared test test/wire.accounts.test.ts`
Expected: FAIL — `switch` stripped (undefined), `near` rejected by the strict row.

- [ ] **Step 3: Implement the schema**

In `shared/src/wire.ts` replace `AccountUsageZ` with:

```ts
/** One account's plan limits (only with several accounts). primary = the account the top-level session/weekly/at describe;
 * near = its 5h use is at or over FO_SWITCH_AT. */
export const AccountUsageZ = z.object({
  label: z.string().min(1).max(32), session: SessionUseZ, weekly: WeeklyUseZ, at: z.number(),
  primary: z.literal(true).optional(), near: z.boolean().optional(),
}).strict();
/** Board-level hint: move work from an account near its 5h limit to the calmest other one. Never a session state. */
export const SwitchZ = z.object({ from: z.string().min(1).max(32), to: z.string().min(1).max(32), used: z.number().min(0).max(1) }).strict();
```

and add to `UsageZ`, after `accounts: …,`:

```ts
  switch: SwitchZ.nullable().optional(),
```

Run: `pnpm --filter @fo/shared test`
Expected: PASS.

- [ ] **Step 4: Write the failing server tests**

Create `server/test/switch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Account } from "../src/accounts";
import { switchAtFrom } from "../src/config";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { switchHint, type SwitchRow } from "../src/switch";
import { at, mk } from "./helpers";

const NOW = at(10_000), MIN = 60_000, H = 3_600_000;
const r = (label: string, used: number | null, ago: number | null = 0): SwitchRow => ({ label, used, at: ago === null ? null : NOW - ago });

describe("switchHint", () => {
  it("nothing at the threshold: no hint", () => expect(switchHint([r("Team", 0.89), r("Pro", 0.1)], NOW, 0.9)).toBeNull());
  it("from = fresh reading at or over the threshold; to = lowest fresh account under it", () => {
    expect(switchHint([r("Team", 0.92), r("Pro", 0.4), r("Lab", 0.2)], NOW, 0.9)).toEqual({ from: "Team", to: "Lab", used: 0.92 });
    expect(switchHint([r("Team", 0.9), r("Pro", 0.4)], NOW, 0.9)).toEqual({ from: "Team", to: "Pro", used: 0.9 });
  });
  it("a from reading 10 minutes old or older does not count", () => {
    expect(switchHint([r("Team", 0.95, 10 * MIN), r("Pro", 0.1)], NOW, 0.9)).toBeNull();
    expect(switchHint([r("Team", 0.95, 10 * MIN - 1), r("Pro", 0.1)], NOW, 0.9)).not.toBeNull();
  });
  it("several accounts over: the highest is from", () => {
    expect(switchHint([r("Team", 0.91), r("Pro", 0.97), r("Lab", 0.3)], NOW, 0.9)).toEqual({ from: "Pro", to: "Lab", used: 0.97 });
  });
  it("no account to move to: null", () => expect(switchHint([r("Team", 0.95), r("Pro", 0.93)], NOW, 0.9)).toBeNull());
  it("never reported, or a reading 6 h old or older, is unknown and offered last", () => {
    expect(switchHint([r("Team", 0.95), r("Pro", null, null)], NOW, 0.9)).toEqual({ from: "Team", to: "Pro", used: 0.95 });
    expect(switchHint([r("Team", 0.95), r("Pro", null, null), r("Lab", 0.6)], NOW, 0.9)!.to).toBe("Lab");
    expect(switchHint([r("Team", 0.95), r("Pro", 0.2, 6 * H), r("Lab", 0.6, 6 * H - 1)], NOW, 0.9)!.to).toBe("Lab");
    expect(switchHint([r("Team", 0.95), r("Pro", 0.95, 6 * H)], NOW, 0.9)!.to).toBe("Pro");
  });
  it("threshold 1 turns the hint off", () => expect(switchHint([r("Team", 1), r("Pro", 0)], NOW, 1)).toBeNull());
});

describe("switchAtFrom", () => {
  it("FO_SWITCH_AT in (0, 1], else 0.9", () => {
    expect(switchAtFrom("0.8")).toBe(0.8);
    expect(switchAtFrom("1")).toBe(1);
    for (const v of [undefined, "", "0", "-1", "1.5", "90", "x"]) expect(switchAtFrom(v)).toBe(0.9);
  });
});

describe("Engine switch hint", () => {
  const TEAM: Account = { dir: "~/.claude", label: "Team", dryas: true };
  const PRO: Account = { dir: "~/.claude-personal", label: "Pro", dryas: false };
  const tag = (l: string, a: string) => JSON.stringify({ ...JSON.parse(l), acct: a });
  const setup = (accounts: Account[]) => { const e = new Engine(new Store(":memory:"), () => at(120)); e.setAccounts(accounts); return e; };

  it("Team at 92 % and Pro calm: Team → Pro; near only on Team; the hint sets no card to waiting", () => {
    const e = setup([TEAM, PRO]);
    e.ingestSpool(mk("t1").usage(100, 92, 40, null));
    e.ingestSpool(tag(mk("p1").usage(101, 10, 5, null), PRO.dir));
    const u = e.usageWire()!;
    expect(u.switch).toEqual({ from: "Team", to: "Pro", used: 0.92 });
    expect(u.accounts!.map((a) => [a.label, a.near, a.primary ?? false])).toEqual([["Team", true, true], ["Pro", false, false]]);
    expect(e.snapshot().sessions.every((s) => s.status !== "waiting")).toBe(true);
  });
  it("Pro never reported is still offered", () => {
    const e = setup([TEAM, PRO]);
    e.ingestSpool(mk("t1").usage(100, 95, 40, null));
    expect(e.usageWire()!.switch).toEqual({ from: "Team", to: "Pro", used: 0.95 });
  });
  it("FO_SWITCH_AT=1: switch null and nothing near", () => {
    const e = setup([TEAM, PRO]);
    e.switchAt = 1;
    e.ingestSpool(mk("t1").usage(100, 100, 40, null));
    const u = e.usageWire()!;
    expect(u.switch).toBeNull();
    expect(u.accounts![0].near).toBe(false);
  });
  it("one account: no switch key", () => {
    const e = setup([TEAM]);
    e.ingestSpool(mk("t1").usage(100, 99, 40, null));
    expect("switch" in e.usageWire()!).toBe(false);
  });
});
```

- [ ] **Step 5: Run them to confirm they fail**

Run: `pnpm --filter @fo/server test test/switch.test.ts`
Expected: FAIL — `Failed to resolve import "../src/switch"`.

- [ ] **Step 6: Implement `server/src/switch.ts`**

```ts
import type { ClaudeUsage } from "./usagecache";

/** from must be this fresh: a reading older than 10 min may already be stale. */
export const FROM_FRESH_MS = 600_000;
/** to must be this fresh to be "known"; older readings (and none) count as unknown and are offered last. */
export const TO_FRESH_MS = 21_600_000;

export interface SwitchRow { label: string; used: number | null; at: number | null }
export interface SwitchHint { from: string; to: string; used: number }

/** 5h use (0..1) right now: 0 once its window has reset. */
export function usedNow(u: ClaudeUsage, now: number): number {
  return u.fiveHour.resetsAt <= now ? 0 : Math.min(1, Math.max(0, u.fiveHour.pct / 100));
}

/** Spec §5. rows in display order; threshold = FO_SWITCH_AT (1 = off). Pure. */
export function switchHint(rows: SwitchRow[], now: number, threshold: number): SwitchHint | null {
  if (!(threshold < 1)) return null;
  const fresh = (r: SwitchRow, ms: number) => r.used !== null && r.at !== null && now - r.at < ms;
  const from = rows.filter((r) => fresh(r, FROM_FRESH_MS) && r.used! >= threshold).sort((a, b) => b.used! - a.used!)[0];
  if (!from) return null;
  const others = rows.filter((r) => r !== from);
  const known = others.filter((r) => fresh(r, TO_FRESH_MS) && r.used! < threshold).sort((a, b) => a.used! - b.used!)[0];
  const to = known ?? others.find((r) => !fresh(r, TO_FRESH_MS));
  return to ? { from: from.label, to: to.label, used: from.used! } : null;
}
```

- [ ] **Step 7: Config**

In `server/src/config.ts` after `export const SPOOL_RETENTION_DAYS = 14;` add:

```ts
/** FO_SWITCH_AT: 5h use at which the board says to move work to another account; 1 = never. */
export const SWITCH_AT_DEFAULT = 0.9;
export function switchAtFrom(v: string | undefined): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 1 ? n : SWITCH_AT_DEFAULT;
}
```

Add `switchAt: number;` to the `Config` interface and `switchAt: switchAtFrom(env.FO_SWITCH_AT),` to the object `loadConfig` returns.

- [ ] **Step 8: Engine and main**

`server/src/engine.ts`: add `SWITCH_AT_DEFAULT` to the `./config` import and `import { switchHint, usedNow } from "./switch";`. Add a field after `exists`:

```ts
  /** FO_SWITCH_AT (set by main). */
  switchAt = SWITCH_AT_DEFAULT;
```

Replace `accountRows` with:

```ts
  /** Listed accounts that have a reading, in file order; near = 5h use at or over FO_SWITCH_AT. */
  private accountRows(now: number): AccountUsage[] {
    const primary = this.primaryAcct();
    return this.accounts.flatMap((a) => {
      const x = this.usage.get(a.dir);
      return x ? [{ label: a.label, ...limitsWire(x), at: x.at, ...(a.dir === primary ? { primary: true as const } : {}),
        near: this.switchAt < 1 && usedNow(x, now) >= this.switchAt }] : [];
    });
  }
```

In `usageWire()` replace the last line `return { ...base, accounts: this.accountRows(now) };` with:

```ts
    const rows = this.accounts.map((a) => {
      const x = this.usage.get(a.dir);
      return { label: a.label, used: x ? usedNow(x, now) : null, at: x?.at ?? null };
    });
    return { ...base, accounts: this.accountRows(now), switch: switchHint(rows, now, this.switchAt) };
```

`server/src/main.ts`: after `engine.edition = cfg.edition;` add:

```ts
engine.switchAt = cfg.switchAt;
```

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm --filter @fo/server test`
Expected: PASS (goldens unchanged).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add server/src/switch.ts server/src/config.ts server/src/engine.ts server/src/main.ts server/test/switch.test.ts shared/src/wire.ts shared/test/wire.accounts.test.ts
git commit -m "feat(server): switch hint when an account nears its 5h limit (FO_SWITCH_AT)"
```

---

### Task 12: PWA card names its account

**Files:**
- Modify: `pwa/src/ui/cards.ts:72` (card template), after `setLabel` (line 147), call site after line 265
- Modify: `pwa/src/styles.css` (after the `.lbl .ti` rule, line 71)
- Create: `pwa/test/cards.account.test.ts`

**Interfaces:**
- Consumes: `Session.account?: { label: string; dryas: boolean }` (Task 9).
- Produces: `.card .acct` element (`TEAM`, or `PRO` + `<span class="nd">NO DRYAS</span>`), empty with one account.

- [ ] **Step 1: Write the failing test**

Create `pwa/test/cards.account.test.ts`:

```ts
import { beforeEach, expect, it, vi } from "vitest";
import { hooks, store } from "../src/state";
import { renderCards } from "../src/ui/cards";
import { T0, loadDom, reset, sess } from "./helpers";

beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: null });
  hooks.openReader = undefined;
});
const card = (id: string) => document.querySelector<HTMLElement>(`.card[data-id="${id}"]`)!;

it("names the account and tags a Dryas-less one", () => {
  store.sessions.set("a", sess("a", { name: "app", account: { label: "Team", dryas: true } }));
  store.sessions.set("b", sess("b", { name: "app", account: { label: "Pro", dryas: false } }, 1));
  renderCards();
  expect(card("a").querySelector(".acct")!.textContent).toBe("TEAM");
  expect(card("a").querySelector(".acct .nd")).toBeNull();
  expect(card("b").querySelector(".acct")!.firstChild!.textContent).toBe("PRO");
  expect(card("b").querySelector(".acct .nd")!.textContent).toBe("NO DRYAS");
});

it("one account: the account slot stays empty", () => {
  store.sessions.set("a", sess("a", { name: "app" }));
  renderCards();
  expect(card("a").querySelector(".acct")!.innerHTML).toBe("");
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @fo/pwa test test/cards.account.test.ts`
Expected: FAIL — `.acct` is null.

- [ ] **Step 3: Implement**

In `pwa/src/ui/cards.ts` line 72, change `<span class="bgc">BACKGROUND</span></div>` to:

```ts
<span class="bgc">BACKGROUND</span><span class="acct"></span></div>
```

(only that substring of the template string changes). After `setLabel` (line 147) add:

```ts
/** Account label, only with several accounts; a plain Claude Code account gets a NO DRYAS tag. */
function setAccount(el: HTMLElement, s: CSession): void {
  const ac = el.querySelector<HTMLElement>(".acct")!, a = s.account;
  const key = a ? `${a.label}|${a.dryas}` : "";
  if (ac.dataset.k === key) return;
  ac.dataset.k = key;
  ac.innerHTML = a ? esc(a.label.toUpperCase()) + (a.dryas ? "" : '<span class="nd">NO DRYAS</span>') : "";
}
```

After `setLabel(el, s, lay);` (line 265) add:

```ts
      setAccount(el, s);
```

In `pwa/src/styles.css` after line 71 (`.lbl .ti{…}`) add:

```css
.lbl .acct{flex:none;font-family:'IBM Plex Mono',monospace;font-size:calc(var(--u)*16);letter-spacing:.1em;color:var(--t3)}
.lbl .acct:empty{display:none}
.lbl .acct .nd{margin-left:calc(var(--u)*8);border:1px solid var(--line);padding:0 calc(var(--u)*6);border-radius:calc(var(--u)*4)}
```

- [ ] **Step 4: Run the PWA suite**

Run: `pnpm --filter @fo/pwa test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pwa/src/ui/cards.ts pwa/src/styles.css pwa/test/cards.account.test.ts
git commit -m "feat(pwa): cards name their Claude account, with a NO DRYAS tag"
```

---

### Task 13: PWA usage rows per account, switch hint, slim marker

**Files:**
- Modify: `pwa/src/ui/usage.ts:1-2` (imports), `pwa/src/ui/usage.ts:61-94` (`renderUsage`)
- Modify: `pwa/src/ui/slim.ts:117-130` (`usageCells`)
- Modify: `pwa/src/ui/tiles.css` (append before the `@media (max-width:600px)` block, line 47)
- Modify: `pwa/test/usage.test.ts`, `pwa/test/slim.test.ts` (append)

**Interfaces:**
- Consumes: `Usage.accounts?: AccountUsage[]` with `primary`/`near`, `Usage.switch?` (Tasks 10-11).
- Produces: `switchText(sw: { from: string; to: string; used: number }): string` in `pwa/src/ui/usage.ts`; `.tile.pair.acct` with `.cap.al` label; `#usage .sw` hint; slim marker cell `{ k: <first letter>, v: "<pct>%", n: "5H" }`.

- [ ] **Step 1: Write the failing tests**

Append to `pwa/test/usage.test.ts` (add `switchText` to the `../src/ui/usage` import):

```ts
const acct = (label: string, used: number, at = T0, extra: object = {}) => ({
  label, session: { used, startedAt: T0 - 3600e3, windowMs: 5 * 3600e3 }, weekly: { used: 0.3, resetsAt: T0 + 3 * 86400e3 }, at, ...extra,
});

it("with accounts: one labelled pair per account, each with its own staleness and pace marker", () => {
  const old = T0 - 6 * 3600e3;
  store.usage = { ...usage(1), accounts: [acct("Team", 0.92, T0, { primary: true, near: true }), acct("Pro", 0.1, old)] };
  renderUsage();
  const pairs = [...document.querySelectorAll<HTMLElement>("#usage .tile.pair")];
  expect(pairs.map((p) => p.querySelector(".al")!.textContent)).toEqual(["Team", "Pro"]);
  expect(pairs[0].className).not.toContain("stale");
  expect(pairs[1].className).toContain("stale");
  expect(pairs[1].querySelector(".r .s")!.textContent).toBe(`AS OF ${DAYS[new Date(old).getDay()]} ${clock(old)}`);
  expect(pairs[0].querySelectorAll(".r.limit .hl u")).toHaveLength(2);
});

it("the switch hint, in the warn colour class, and none without one", () => {
  const accounts = [acct("Team", 0.92, T0, { primary: true, near: true }), acct("Pro", 0.1)];
  expect(switchText({ from: "Team", to: "Pro", used: 0.92 })).toBe("Team 92% of 5h: /handoff, continue in Pro");
  store.usage = { ...usage(1), accounts, switch: { from: "Team", to: "Pro", used: 0.92 } };
  renderUsage();
  expect(document.querySelector("#usage .sw")!.textContent).toBe("Team 92% of 5h: /handoff, continue in Pro");
  store.usage = { ...usage(1), accounts, switch: null };
  renderUsage();
  expect(document.querySelector("#usage .sw")).toBeNull();
});

it("without accounts: one unlabelled pair, as before", () => {
  store.usage = usage(1);
  renderUsage();
  expect(document.querySelectorAll("#usage .tile.pair")).toHaveLength(1);
  expect(document.querySelector("#usage .al")).toBeNull();
  expect(document.querySelector("#usage")!.className).not.toContain("multi");
});
```

Append to `pwa/test/slim.test.ts` inside `describe("usageCells", …)` (before its closing `});`):

```ts
  it("one-letter marker per other account near its limit; none for the primary or a calm one; never amber", () => {
    const A = (label: string, used: number, o: object = {}) => ({ label, session: { ...U.session, used }, weekly: U.weekly, at: T0, ...o });
    const c = usageCells({ ...U, accounts: [A("Team", 0.95, { primary: true, near: true }), A("pro", 0.93, { near: true }), A("Lab", 0.2, { near: false })] }, [], T0);
    expect(c.map(view)).toEqual([["5H", "2%", "4:51"], ["WEEK", "30%", "SUN 17:00"], ["P", "93%", "5H"], ["FABLE", "2%", "SUN 16:59"], ["JEV", "$0.33", "OF $5"]]);
    expect(c.every((x) => !x.hot)).toBe(true);
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter @fo/pwa test test/usage.test.ts test/slim.test.ts`
Expected: FAIL — `switchText` is not exported; no `.al`; slim has no `P` cell.

- [ ] **Step 3: Implement `usage.ts`**

Change the shared import (line 2) to:

```ts
import { kpiDetail, kpiValue, type JevUsage, type Kpi, type Usage } from "@fo/shared";
```

Replace `renderUsage` (lines 61-94) with:

```ts
/** Board-level hint (never a session state): "Team 92% of 5h: /handoff, continue in Pro". */
export const switchText = (sw: { from: string; to: string; used: number }): string =>
  `${sw.from} ${Math.round(sw.used * 100)}% of 5h: /handoff, continue in ${sw.to}`;

/** The 5h/weekly pair for one reading; label = account caption (several accounts only). Staleness is per reading. */
function pairTile(S: Usage["session"], Wk: Usage["weekly"], at: number, t: number, label: string | null): string {
  const sPace = clamp((t - S.startedAt) / S.windowMs, 0, 1), sReset = S.startedAt + S.windowMs;
  const wPace = clamp(1 - (Wk.resetsAt - t) / (7 * 86400e3), 0, 1);
  const rd = new Date(Wk.resetsAt);
  const reset = sReset <= t, stale = reset || t - at > FIVE_HOUR_MS;
  const asOf = `AS OF ${DAYS[new Date(at).getDay()]} ${clock(at)}`;
  const hot = (lv: Level) => !stale && lv !== "";
  const sub = (used: number, pace: number, live: string) => stale ? asOf : used > pace + PACE_WARN ? ahead : live;
  return `<div class="tile pair${label === null ? "" : " acct"}${stale ? " stale" : ""}">` +
    (label === null ? "" : `<span class="cap al">${esc(label)}</span>`) +
    row("SESSION 5H", reset ? null : S.used, sPace, sub(S.used, sPace, `IN ${left(sReset - t)}`), hot(claudeLevel(S.used, sPace))) +
    row("WEEKLY", Wk.used, wPace, sub(Wk.used, wPace, `${DAYS[rd.getDay()]} ${clock(Wk.resetsAt)}`), hot(claudeLevel(Wk.used, wPace))) +
    `</div>`;
}

export function renderUsage(): void {
  const el = $("#usage")!, u = store.usage;
  if (!u) { el.classList.remove("dim"); el.title = "Click for spend by project and model"; el.classList.remove("four"); el.classList.remove("multi"); setHtml(el, '<span class="none">USAGE · NO DATA YET</span>'); return; }
  const t = now(), S = u.session;
  const sReset = S.startedAt + S.windowMs, j = u.jev ? jevMeter(u.jev, t) : null;
  const fPace = u.fable ? clamp(1 - (u.fable.resetsAt - t) / (7 * 86400e3), 0, 1) : 0, fd = new Date(u.fable?.resetsAt ?? 0);
  const multi = !!u.accounts?.length;
  el.classList.toggle("four", !!u.fable);
  el.classList.toggle("nojev", !u.jev);
  el.classList.toggle("multi", multi);
  // Claude limits arrive only via the CLI statusline or its usage cache; VS Code sessions feed neither.
  // Stale readings say when they were taken instead of posing as live. Jev is tailed live, never stale.
  const reset = sReset <= t, stale = reset || t - u.at > FIVE_HOUR_MS;
  const asOf = `AS OF ${DAYS[new Date(u.at).getDay()]} ${clock(u.at)}`;
  el.classList.remove("dim");
  el.title = stale ? `Claude limits last read ${asOf.slice(6)} · open claude in a terminal to refresh` : "Click for spend by project and model";
  const hot = (lv: Level) => !stale && lv !== "";
  const sub = (used: number, pace: number, live: string) => stale ? asOf : used > pace + PACE_WARN ? ahead : live;
  const st = stale ? " stale" : "";
  setHtml(el,
    (u.switch ? `<div class="sw" role="status">${esc(switchText(u.switch))}</div>` : "") +
    (multi ? u.accounts!.map((a) => pairTile(a.session, a.weekly, a.at, t, a.label)).join("") : pairTile(S, u.weekly, u.at, t, null)) +
    (u.fable
      ? tile("FABLE", "fable" + st, u.fable.used, fPace,
        sub(u.fable.used, fPace, `${DAYS[fd.getDay()]} ${clock(u.fable.resetsAt)}`), hot(claudeLevel(u.fable.used, fPace)), true)
      : "") +
    (u.jev && j
      ? `<div class="tile num${j.warn ? " hot" : ""}"${j.warn ? ' title="Jev ahead of pace · run /tune"' : ""}><span class="cap">JEV</span>` +
        `<span class="big">$${u.jev.usedUsd.toFixed(2)}</span>` +
        `<div class="s">${j.warn ? ahead : `OF $${u.jev.budgetUsd}`}</div>${kpiLine(store.kpis)}</div>`
      : ""));
}
```

- [ ] **Step 4: Implement `slim.ts`**

In `usageCells`, after the `const out = [ … ];` array (line 125) add:

```ts
  // Other accounts near their 5h limit: one letter each (the switch hint itself shows on the landscape usage tile).
  for (const a of u.accounts ?? []) if (!a.primary && a.near) out.push(cell(a.label.slice(0, 1).toUpperCase(), pct(a.session.used), "5H", a.session.used));
```

- [ ] **Step 5: CSS**

In `pwa/src/ui/tiles.css`, before the `@media (max-width:600px){` line add:

```css
#usage .sw{grid-column:1/-1;font-family:'IBM Plex Mono',monospace;font-size:calc(var(--u)*15);letter-spacing:.06em;color:var(--jev);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.pair.acct{gap:calc(var(--u)*8)}
.tile.pair .al{font-size:calc(var(--u)*13);color:var(--t2)}
```

- [ ] **Step 6: Run the PWA unit suite and e2e**

Run: `pnpm --filter @fo/pwa test`
Expected: PASS (existing single-account usage and slim tests unchanged).
Run: `pnpm build && pnpm --filter @fo/pwa e2e`
Expected: PASS (one account in every e2e server: nothing changes on screen).

- [ ] **Step 7: Commit**

```bash
git add pwa/src/ui/usage.ts pwa/src/ui/slim.ts pwa/src/ui/tiles.css pwa/test/usage.test.ts pwa/test/slim.test.ts
git commit -m "feat(pwa): one usage row per account, switch hint, slim marker"
```

---

### Task 14: Transcripts and registry for every account

**Files:**
- Modify: `server/src/accounts.ts` (append `accountRoots`)
- Modify: `server/src/transcript.ts:85-107` (`TranscriptTailer` roots)
- Modify: `server/src/registry.ts` (append `readRegistries`)
- Modify: `server/src/config.ts:30,46,51` (`transcriptsRoot`, `sessionsDir` become `string | null`)
- Modify: `server/src/main.ts` (transcripts constructor line 104, accounts tick, registry interval lines 159-161)
- Create: `server/test/roots.test.ts`

**Interfaces:**
- Consumes: `Account`, `AccountsFile`, `expandHome` (Task 8).
- Produces:
  - `accountRoots(accounts: Account[], sub: "projects" | "sessions", override: string | null, home?: string): string[]`
  - `new TranscriptTailer(root: string | string[], onBatch, opts)`, `TranscriptTailer.setRoots(roots: string[]): void`
  - `readRegistries(dirs: string[]): Map<string, RegEntry> | null` (null only when every dir is missing)
  - `Config.transcriptsRoot: string | null` (FO_TRANSCRIPTS or null), `Config.sessionsDir: string | null` (FO_SESSIONS_DIR or null)

- [ ] **Step 1: Write the failing tests**

Create `server/test/roots.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountRoots, type Account } from "../src/accounts";
import { loadConfig } from "../src/config";
import { readRegistries } from "../src/registry";
import { TranscriptTailer } from "../src/transcript";

const HOME = "/Users/dev";
const A: Account[] = [{ dir: "~/.claude", label: "Team", dryas: true }, { dir: "/opt/claude-pro", label: "Pro", dryas: false }];
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fo-roots-")));

describe("accountRoots", () => {
  it("<dir>/<sub> per account; an override replaces them all", () => {
    expect(accountRoots(A, "projects", null, HOME)).toEqual([path.join(HOME, ".claude", "projects"), path.join("/opt/claude-pro", "projects")]);
    expect(accountRoots(A, "sessions", null, HOME)).toEqual([path.join(HOME, ".claude", "sessions"), path.join("/opt/claude-pro", "sessions")]);
    expect(accountRoots(A, "projects", "/t", HOME)).toEqual(["/t"]);
  });
});

describe("TranscriptTailer with several roots", () => {
  it("accepts a transcript under any root, still rejects others, and follows setRoots", () => {
    const base = tmp();
    const file = (root: string) => { const p = path.join(base, root, "-p", "s.jsonl"); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); return p; };
    const [a, b, c] = [file("a"), file("b"), file("c")];
    const t = new TranscriptTailer([path.join(base, "a"), path.join(base, "b")], () => {});
    expect(t.watch("s1", a)).toBe("ok");
    expect(t.watch("s2", b)).toBe("ok");
    expect(t.watch("s3", c)).toBe("rejected");
    expect(t.watch("s4", path.join(base, "a", "..", "c", "-p", "s.jsonl"))).toBe("rejected");
    t.setRoots([path.join(base, "c")]);
    expect(t.watch("s5", c)).toBe("ok");
    expect(t.watch("s6", a)).toBe("rejected");
  });
});

describe("readRegistries", () => {
  it("merges every dir, skips missing ones, null only when all are missing", () => {
    const a = tmp(), b = tmp();
    fs.writeFileSync(path.join(a, "1.json"), JSON.stringify({ pid: 11, sessionId: "t1", kind: "" }));
    fs.writeFileSync(path.join(b, "2.json"), JSON.stringify({ pid: 22, sessionId: "p1", kind: "bg" }));
    const r = readRegistries([a, path.join(a, "missing"), b])!;
    expect([...r.keys()].sort()).toEqual(["p1", "t1"]);
    expect(r.get("p1")).toEqual({ pid: 22, sessionId: "p1", kind: "bg" });
    expect(readRegistries([path.join(a, "x"), path.join(b, "y")])).toBeNull();
  });
});

describe("loadConfig roots", () => {
  it("FO_TRANSCRIPTS / FO_SESSIONS_DIR are overrides; unset means per account (null)", () => {
    const { FO_TRANSCRIPTS: _t, FO_SESSIONS_DIR: _s, ...env } = process.env;
    expect(loadConfig(env).transcriptsRoot).toBeNull();
    expect(loadConfig(env).sessionsDir).toBeNull();
    expect(loadConfig({ ...env, FO_SESSIONS_DIR: "/s" }).sessionsDir).toBe("/s");
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter @fo/server test test/roots.test.ts`
Expected: FAIL — `accountRoots` / `readRegistries` not exported; `setRoots` missing.

- [ ] **Step 3: Implement**

Append to `server/src/accounts.ts`:

```ts
/** Where an account's transcripts ("projects") or session registry ("sessions") live. A FO_* override replaces all accounts' dirs. */
export function accountRoots(accounts: Account[], sub: "projects" | "sessions", override: string | null, home: string = os.homedir()): string[] {
  return override ? [override] : accounts.map((a) => path.join(expandHome(a.dir, home), sub));
}
```

In `server/src/transcript.ts` replace `private root: string;` with `private roots: string[] = [];`, replace the constructor's `try { this.root = fs.realpathSync(root); } catch { this.root = path.resolve(root); }` with `this.setRoots(Array.isArray(root) ? root : [root]);`, change the constructor parameter `root: string` to `root: string | string[]`, and replace `watch` with:

```ts
  /** Roots are realpathed now; a root that does not exist yet is kept as given. */
  setRoots(roots: string[]): void {
    this.roots = roots.map((r) => { try { return fs.realpathSync(r); } catch { return path.resolve(r); } });
  }

  /** Accept only a real .jsonl path under one of the roots (spec §9.1 path guard). */
  watch(sid: string, p: string): "ok" | "same" | "rejected" {
    let real: string;
    try { real = fs.realpathSync(p); } catch { return "rejected"; }
    if (!real.endsWith(".jsonl") || !this.roots.some((r) => real.startsWith(r + path.sep))) return "rejected";
    if (this.w.get(sid)?.path === real) return "same";
    this.w.set(sid, { path: real, files: new Map(), seen: new Set(), metas: new Set() });
    return "ok";
  }
```

Append to `server/src/registry.ts`:

```ts
/** Every account's registry merged; null only when no dir exists (feature off). */
export function readRegistries(dirs: string[]): Map<string, RegEntry> | null {
  let any = false;
  const out = new Map<string, RegEntry>();
  for (const d of dirs) {
    const r = readRegistry(d);
    if (!r) continue;
    any = true;
    for (const [k, v] of r) out.set(k, v);
  }
  return any ? out : null;
}
```

In `server/src/config.ts`: in the `Config` interface change `transcriptsRoot: string;` to `transcriptsRoot: string | null;` and `sessionsDir: string;` to `sessionsDir: string | null;`; in `loadConfig` change those two lines to:

```ts
    transcriptsRoot: env.FO_TRANSCRIPTS || null, // null = <dir>/projects of every account
    sessionsDir: env.FO_SESSIONS_DIR || null,    // null = <dir>/sessions of every account
```

In `server/src/main.ts`: change the imports to `import { AccountsFile, accountRoots } from "./accounts";` and `import { pidAlive, readRegistries } from "./registry";`. Move the three `accountsFile` lines from Task 9 to just before the `const transcripts = …` line, and replace that line with:

```ts
const transcripts = new TranscriptTailer(accountRoots(accountsFile.accounts(), "projects", cfg.transcriptsRoot), (items) => engine.onTranscripts(items), { onRc: (sid, r) => engine.onRc(sid, r), onMeta: (sid, m) => engine.onMeta(sid, m) });
```

Replace the accounts line in the `TICK_MS` interval with:

```ts
    try {
      if (accountsFile.check()) {
        engine.setAccounts(accountsFile.accounts());
        transcripts.setRoots(accountRoots(accountsFile.accounts(), "projects", cfg.transcriptsRoot));
      }
    } catch (err) { console.error("fo-server: accounts failed:", err); }
```

Replace the registry interval body with:

```ts
    try { engine.onRegistry(readRegistries(accountRoots(accountsFile.accounts(), "sessions", cfg.sessionsDir)), pidAlive); engine.flush(); } catch (err) { console.error("fo-server: registry failed:", err); }
```

- [ ] **Step 4: Run tests, typecheck and the e2e**

Run: `pnpm --filter @fo/server test`
Expected: PASS (`test/transcript.test.ts` with a single string root unchanged; `test/usagepoll.test.ts` "/t" override unchanged; goldens unchanged).
Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/accounts.ts server/src/transcript.ts server/src/registry.ts server/src/config.ts server/src/main.ts server/test/roots.test.ts
git commit -m "feat(server): read transcripts and the session registry of every account"
```

---

### Task 15: Server `GET /api/usage` (and `?session=` lookup)

**Files:**
- Modify: `server/src/engine.ts` (two public methods after `usageWire`)
- Modify: `server/src/http.ts` (`handle` switch, after `case "/api/kpis":` at ~:124)
- Test: `server/test/http.test.ts` (append)

**Interfaces:**
- Consumes: `Engine.accounts`, `Engine.usage`, `Engine.switchAt`, `accountOf` (Tasks 9-11); `usedNow` (Task 11).
- Produces:
  - `Engine.usageApi(): { accounts: { label: string; dir: string; fiveHour: number | null; sevenDay: number | null; at: number | null }[]; switchAt: number }` (file order; `fiveHour` is 0 once the window reset)
  - `Engine.sessionAccount(sid: string): { label: string; dir: string } | null`
  - `GET /api/usage` → `usageApi()`; `GET /api/usage?session=<id>` → `{label, dir}` or 404. Same host/origin check as every route (`allowed()`), no token. (The spec names only `label` for the lookup; `dir` is added so `cl` does not need to re-read the file.)

- [ ] **Step 1: Write the failing test**

Append to `server/test/http.test.ts`:

```ts
describe("GET /api/usage", () => {
  it("accounts in file order, nulls before a reading, switchAt, session lookup, origin check", async () => {
    const { engine, port } = await start();
    engine.setAccounts([{ dir: "~/.claude", label: "Team", dryas: true }, { dir: "~/.claude-personal", label: "Pro", dryas: false }]);
    engine.ingestSpool(mk().usage(5, 41, 22, null));
    const r = await get(port, "/api/usage");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ accounts: [
      { label: "Team", dir: "~/.claude", fiveHour: 0.41, sevenDay: 0.22, at: at(5) },
      { label: "Pro", dir: "~/.claude-personal", fiveHour: null, sevenDay: null, at: null },
    ], switchAt: 0.9 });
    expect(JSON.parse((await get(port, "/api/usage?session=s1")).body)).toEqual({ label: "Team", dir: "~/.claude" });
    expect((await get(port, "/api/usage?session=nope")).status).toBe(404);
    expect((await get(port, "/api/usage", { origin: "http://evil.com" })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @fo/server test test/http.test.ts`
Expected: FAIL — `/api/usage` falls through to the static handler (404, not JSON).

- [ ] **Step 3: Implement**

`server/src/engine.ts`, after `usageWire()`:

```ts
  /** GET /api/usage for the cl launcher: every listed account, null = no reading yet. */
  usageApi(): { accounts: { label: string; dir: string; fiveHour: number | null; sevenDay: number | null; at: number | null }[]; switchAt: number } {
    const now = this.now();
    return {
      accounts: this.accounts.map((a) => {
        const x = this.usage.get(a.dir);
        return { label: a.label, dir: a.dir, fiveHour: x ? usedNow(x, now) : null,
          sevenDay: x ? Math.min(1, Math.max(0, x.sevenDay.pct / 100)) : null, at: x?.at ?? null };
      }),
      switchAt: this.switchAt,
    };
  }

  /** The account a session was recorded under (cl --resume and the board's Restore stay on it). */
  sessionAccount(sid: string): { label: string; dir: string } | null {
    const s = this.sessions.get(sid);
    if (!s) return null;
    const a = this.accountOf(s.acct ?? DEFAULT_ACCT);
    return { label: a.label, dir: a.dir };
  }
```

`server/src/http.ts`, in `handle`'s switch after the `case "/api/kpis": return json(res, 200, engine.kpisReport());` lines add:

```ts
      case "/api/usage": {
        const sid = url.searchParams.get("session");
        if (sid === null) return json(res, 200, engine.usageApi());
        const a = sid.length <= 64 ? engine.sessionAccount(sid) : null;
        return a ? json(res, 200, a) : json(res, 404, { error: "unknown session" });
      }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @fo/server test`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/engine.ts server/src/http.ts server/test/http.test.ts
git commit -m "feat(server): GET /api/usage per account, with a session's account lookup"
```

---

### Task 16: `cl` launcher picks the account at session start

**Files:**
- Create: `scripts/cl.py`
- Modify: `scripts/install.sh` (after the hook copy loop, line 64; before the final `echo`, line 108)
- Create: `scripts/tests/test_cl_launcher.py` (not `test_cl.py`: one pytest run collects `scripts/tests` and `helper/tests` and basenames must be unique)
- Modify: `scripts/tests/test_install_sh.py` (append)

**Interfaces:**
- Consumes: `GET /api/usage` and `?session=` (Task 15); `accounts.json` with optional `rules` (Task 4 keeps unknown keys: `add_account`/`remove_account` return `dict(d, accounts=…)`).
- Produces:
  - `$FO_HOME/bin/cl` (mode 755): `cl [--team | --pro | --account LABEL] [--dry-run] [claude args...]`
  - `cl.main(argv, env=None, cwd=None, fetch=fetch_json, execvpe=os.execvpe, out=sys.stdout, err=sys.stderr) -> int`
  - `cl.decide(argv, env, cwd, fetch) -> (account {dir,label}, line, claude_args, dry_run)`; `cl.fetch_json(url) -> dict | None` (1 s, no proxy)
  - Order: flag → resume (`--resume/-r <id>` looked up via `?session=`) → longest matching rule → usage pick → default. Resume is checked before rules (spec: "not the rule").
  - Lines (stderr), exactly: `cl → Pro (--account)`, `cl → Pro (resume: the session's account)`, `cl → Team (rule ~/clients/big)`, `cl → Team (5h 41% · Pro 12%)`, `cl → Pro (Team 5h 93%)`, `cl → Team (all accounts near the 5h limit: 5h 95% · Pro 93%)`, `cl → Team (flowobserve not reachable)`, `cl → claude (no accounts file)`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_cl_launcher.py`:

```python
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import cl  # noqa: E402
import fo_install as fi  # noqa: E402

TEAM = {"dir": "~/.claude", "label": "Team"}
PRO = {"dir": "~/.claude-personal", "label": "Pro"}


def env_with(tmp_path, accounts=(TEAM, PRO), rules=()):
    fo = tmp_path / ".flowobserve"
    fo.mkdir(exist_ok=True)
    (fo / "accounts.json").write_text(json.dumps({"accounts": list(accounts), "rules": list(rules)}))
    return {"HOME": str(tmp_path), "FO_HOME": str(fo), "FO_PORT": "4317", "CLAUDE_CONFIG_DIR": "/stale", "PATH": "/usr/bin:/bin"}


def usage(team, pro, at=0.9):
    row = lambda a, v: {"label": a["label"], "dir": a["dir"], "fiveHour": v, "sevenDay": None if v is None else 0.1, "at": None if v is None else 1}
    return {"accounts": [row(TEAM, team), row(PRO, pro)], "switchAt": at}


def run(argv, env, cwd="/Users/p/code/app", usage_doc=None, session=None):
    calls, execs = [], []

    def fetch(url):
        calls.append(url)
        return session if "?session=" in url else usage_doc

    out, err = io.StringIO(), io.StringIO()
    rc = cl.main(argv, env=env, cwd=cwd, fetch=fetch, execvpe=lambda f, a, e: execs.append((f, a, e)), out=out, err=err)
    return rc, err.getvalue().strip(), execs, calls, out.getvalue()


def test_flag_wins_and_sets_the_config_dir(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, calls, _ = run(["--pro", "--resume", "abc"], env, usage_doc=usage(0.1, 0.9))
    assert rc == 0 and line == "cl → Pro (--account)" and calls == []
    [(f, args, e)] = execs
    assert f == "claude" and args == ["claude", "--resume", "abc"]
    assert e["CLAUDE_CONFIG_DIR"] == str(tmp_path / ".claude-personal")
    assert run(["--account", "team"], env)[1] == "cl → Team (--account)"
    rc, line, execs, _, _ = run(["--account", "Lab"], env)
    assert rc == 2 and "no account labelled Lab" in line and execs == []


def test_resume_stays_on_the_sessions_account_over_a_rule(tmp_path):
    env = env_with(tmp_path, rules=[{"path": "~/clients", "label": "Team"}])
    rc, line, execs, calls, _ = run(["--resume", "abc"], env, cwd=str(tmp_path / "clients"), session={"label": "Pro", "dir": "~/.claude-personal"})
    assert line == "cl → Pro (resume: the session's account)"
    assert calls == ["http://127.0.0.1:4317/api/usage?session=abc"]
    assert execs[0][1] == ["claude", "--resume", "abc"]


def test_longest_matching_rule_wins(tmp_path):
    env = env_with(tmp_path, rules=[{"path": "~/clients", "label": "Pro"}, {"path": "~/clients/big", "label": "Team"}])
    assert run([], env, cwd=str(tmp_path / "clients" / "big" / "x"))[1] == "cl → Team (rule ~/clients/big)"
    assert run([], env, cwd=str(tmp_path / "clients" / "small"))[1] == "cl → Pro (rule ~/clients)"
    assert run([], env, cwd=str(tmp_path / "clientsX"), usage_doc=usage(0.41, 0.12))[1] == "cl → Team (5h 41% · Pro 12%)"


def test_usage_pick(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, _, _ = run([], env, usage_doc=usage(0.41, 0.12))
    assert line == "cl → Team (5h 41% · Pro 12%)" and "CLAUDE_CONFIG_DIR" not in execs[0][2]
    assert run([], env, usage_doc=usage(None, 0.12))[1] == "cl → Team (5h — · Pro 12%)"
    assert run([], env, usage_doc=usage(0.93, 0.12))[1] == "cl → Pro (Team 5h 93%)"
    assert run([], env, usage_doc=usage(0.93, None))[1] == "cl → Team (all accounts near the 5h limit: 5h 93% · Pro —)"
    assert run([], env, usage_doc=usage(0.95, 0.93))[1] == "cl → Team (all accounts near the 5h limit: 5h 95% · Pro 93%)"


def test_server_down_or_no_accounts_file_means_default(tmp_path):
    env = env_with(tmp_path)
    assert run([], env, usage_doc=None)[1] == "cl → Team (flowobserve not reachable)"
    os.remove(os.path.join(env["FO_HOME"], "accounts.json"))
    rc, line, execs, calls, _ = run([], env)
    assert line == "cl → claude (no accounts file)" and calls == [] and "CLAUDE_CONFIG_DIR" not in execs[0][2]


def test_dry_run_prints_the_command_and_starts_nothing(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, _, out = run(["--dry-run", "--pro", "-c"], env)
    assert rc == 0 and execs == [] and line == "cl → Pro (--account)"
    assert out == "CLAUDE_CONFIG_DIR=%s claude -c\n" % (tmp_path / ".claude-personal")


def test_missing_claude_exits_127(tmp_path):
    def boom(f, a, e):
        raise OSError("not found")
    rc = cl.main([], env=env_with(tmp_path), cwd="/", fetch=lambda u: None, execvpe=boom, out=io.StringIO(), err=io.StringIO())
    assert rc == 127


def test_fetch_json_talks_to_a_local_server_and_ignores_proxies(monkeypatch):
    body = json.dumps(usage(0.2, 0.3)).encode()

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200 if self.path == "/api/usage" else 404)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    try:
        assert cl.fetch_json("http://127.0.0.1:%d/api/usage" % srv.server_port) == usage(0.2, 0.3)
        assert cl.fetch_json("http://127.0.0.1:%d/nope" % srv.server_port) is None
    finally:
        srv.shutdown()
    assert cl.fetch_json("http://127.0.0.1:9/api/usage") is None


def test_installer_keeps_rules(tmp_path):
    rule = {"path": "~/clients", "label": "Team"}
    d = fi.add_account({"accounts": [], "rules": [rule]}, "~/.claude", "Team")
    assert fi.remove_account(d, "~/.claude")["rules"] == [rule] == d["rules"]
```

Append to `scripts/tests/test_install_sh.py`:

```python
def test_install_copies_cl_and_says_how_to_reach_it(tmp_path):
    claude, env = sandbox(tmp_path)
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    p = tmp_path / ".flowobserve" / "bin" / "cl"
    assert p.exists() and os.stat(p).st_mode & 0o111
    assert 'export PATH="%s:$PATH"' % (tmp_path / ".flowobserve" / "bin") in r.stdout
    d = subprocess.run([str(p), "--dry-run"], capture_output=True, text=True, env=dict(env, FO_PORT="9"))
    assert d.returncode == 0 and d.stdout == "claude\n" and "cl → claude (flowobserve not reachable)" in d.stderr
```

(`--dry-run` against port 9: the accounts file lists `~/.claude` with label `claude`, nothing listens, so the default account is chosen.)

- [ ] **Step 2: Run them to confirm they fail**

Run: `python3 -m pytest scripts/tests/test_cl_launcher.py scripts/tests/test_install_sh.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'cl'`; install test finds no `bin/cl`.

- [ ] **Step 3: Implement `scripts/cl.py`**

```python
#!/usr/bin/python3
"""cl: start claude in the Claude account that fits (multi-account spec §9). Stdlib only.

Order: --team/--pro/--account, then a resumed session's own account, then the longest matching rule in
accounts.json, then flowobserve's 5h use (GET /api/usage), else the default account (~/.claude).
"""
import json
import os
import shlex
import sys
import urllib.parse
import urllib.request

DEFAULT_ACCT = "~/.claude"
SHORT = {"--team": "Team", "--pro": "Pro"}
SWITCH_AT = 0.9


class Usage(Exception):
    """Bad cl arguments."""


def fo_home(env):
    return env.get("FO_HOME") or os.path.join(env.get("HOME") or os.path.expanduser("~"), ".flowobserve")


def expand(d, env):
    home = env.get("HOME") or os.path.expanduser("~")
    return home if d == "~" else os.path.join(home, d[2:]) if d.startswith("~/") else d


def label_of(d):
    base = d.rstrip("/").rsplit("/", 1)[-1]
    return (base[1:] if base.startswith(".") else base) or "claude"


def load(env):
    """(accounts, rules) from accounts.json; None when it is missing, unreadable or lists no account."""
    try:
        with open(os.path.join(fo_home(env), "accounts.json"), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict):
        return None
    accounts = []
    for a in d.get("accounts") or []:
        if isinstance(a, dict) and isinstance(a.get("dir"), str) and a["dir"]:
            dr = a["dir"].rstrip("/") or a["dir"]
            lb = a.get("label") if isinstance(a.get("label"), str) and a["label"].strip() else label_of(dr)
            accounts.append({"dir": dr, "label": lb.strip()})
    rules = [r for r in d.get("rules") or [] if isinstance(r, dict) and isinstance(r.get("path"), str) and isinstance(r.get("label"), str)]
    return (accounts, rules) if accounts else None


def parse_args(argv):
    """cl's own flags (before a bare --) -> (label or None, dry_run, claude args)."""
    label, dry, rest, i = None, False, [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            rest.extend(argv[i:])
            break
        if a in SHORT:
            label = SHORT[a]
        elif a == "--account":
            if i + 1 >= len(argv):
                raise Usage("--account needs a label")
            label = argv[i + 1]
            i += 1
        elif a.startswith("--account="):
            label = a.split("=", 1)[1]
        elif a == "--dry-run":
            dry = True
        else:
            rest.append(a)
        i += 1
    return label, dry, rest


def resume_id(args):
    for i, a in enumerate(args):
        if a.startswith("--resume="):
            return a.split("=", 1)[1] or None
        if a in ("--resume", "-r") and i + 1 < len(args) and not args[i + 1].startswith("-"):
            return args[i + 1]
    return None


def rule_for(cwd, rules, env):
    """Longest rule path that is cwd or a parent of it."""
    best = None
    for r in rules:
        p = os.path.abspath(expand(r["path"].rstrip("/") or r["path"], env))
        if (cwd == p or cwd.startswith(p.rstrip("/") + "/")) and (best is None or len(p) > best[0]):
            best = (len(p), r)
    return best[1] if best else None


def fetch_json(url):
    """GET a local JSON document in 1 s, never through a proxy; None on any problem."""
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=1.0) as r:
            v = json.loads(r.read(65536).decode("utf-8"))
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def pct(x):
    return "—" if x is None else "%d%%" % round(x * 100)


def decide(argv, env, cwd, fetch):
    label, dry, rest = parse_args(argv)
    loaded = load(env)
    if loaded is None:
        if label is not None:
            raise Usage("no accounts file: run install.sh for each config dir first")
        return {"dir": DEFAULT_ACCT, "label": "claude"}, "cl → claude (no accounts file)", rest, dry
    accounts, rules = loaded
    default = next((a for a in accounts if a["dir"] == DEFAULT_ACCT), accounts[0])

    def by_label(l):
        return next((a for a in accounts if a["label"].lower() == l.lower()), None)

    if label is not None:
        a = by_label(label)
        if a is None:
            raise Usage("no account labelled %s (have: %s)" % (label, ", ".join(x["label"] for x in accounts)))
        return a, "cl → %s (--account)" % a["label"], rest, dry
    base = "http://127.0.0.1:%s/api/usage" % (env.get("FO_PORT") or "4317")
    sid = resume_id(rest)
    if sid:
        s = fetch(base + "?session=" + urllib.parse.quote(sid, safe=""))
        a = by_label(s["label"]) if isinstance(s, dict) and isinstance(s.get("label"), str) else None
        if a:
            return a, "cl → %s (resume: the session's account)" % a["label"], rest, dry
    r = rule_for(cwd, rules, env)
    if r and by_label(r["label"]):
        a = by_label(r["label"])
        return a, "cl → %s (rule %s)" % (a["label"], r["path"]), rest, dry
    u = fetch(base)
    if not isinstance(u, dict) or not isinstance(u.get("accounts"), list):
        return default, "cl → %s (flowobserve not reachable)" % default["label"], rest, dry
    at = u.get("switchAt") if isinstance(u.get("switchAt"), (int, float)) else SWITCH_AT
    five = {x.get("dir"): x.get("fiveHour") for x in u["accounts"] if isinstance(x, dict)}

    def used(a):
        v = five.get(a["dir"])
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def others(a):
        return " · ".join("%s %s" % (x["label"], pct(used(x))) for x in accounts if x is not a)

    du = used(default)
    if du is None or du < at:
        return default, "cl → %s (5h %s%s)" % (default["label"], pct(du), (" · " + others(default)) if len(accounts) > 1 else ""), rest, dry
    calm = sorted((a for a in accounts if a is not default and used(a) is not None and used(a) < at), key=used)
    if calm:
        return calm[0], "cl → %s (%s 5h %s)" % (calm[0]["label"], default["label"], pct(du)), rest, dry
    return default, "cl → %s (all accounts near the 5h limit: 5h %s · %s)" % (default["label"], pct(du), others(default)), rest, dry


def main(argv, env=None, cwd=None, fetch=fetch_json, execvpe=os.execvpe, out=sys.stdout, err=sys.stderr):
    env = dict(os.environ if env is None else env)
    cwd = os.path.abspath(cwd or os.getcwd())
    try:
        a, line, rest, dry = decide(argv, env, cwd, fetch)
    except Usage as e:
        err.write("cl: %s\n" % e)
        return 2
    err.write(line + "\n")
    if a["dir"] == DEFAULT_ACCT:
        env.pop("CLAUDE_CONFIG_DIR", None)
    else:
        env["CLAUDE_CONFIG_DIR"] = expand(a["dir"], env)
    cmd = ["claude"] + rest
    if dry:
        pre = "CLAUDE_CONFIG_DIR=%s " % shlex.quote(env["CLAUDE_CONFIG_DIR"]) if "CLAUDE_CONFIG_DIR" in env else ""
        out.write(pre + shlex.join(cmd) + "\n")
        return 0
    try:
        execvpe("claude", cmd, env)
    except OSError as e:
        err.write("cl: cannot start claude: %s\n" % e)
        return 127
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Implement the `install.sh` copy and PATH line**

In `scripts/install.sh` after the hook copy loop (after line 64, `done`) add:

```sh
{ cp "$REPO/scripts/cl.py" "$FO_HOME/bin/cl.tmp" && chmod 755 "$FO_HOME/bin/cl.tmp" && mv "$FO_HOME/bin/cl.tmp" "$FO_HOME/bin/cl"; } || die "copy cl failed"
```

Before the final `echo "flowobserve installed …"` line add:

```sh
case ":$PATH:" in
  *":$FO_HOME/bin:"*) ;;
  *) echo "cl (pick the account per session): add this to your shell profile: export PATH=\"$FO_HOME/bin:\$PATH\"" ;;
esac
```

- [ ] **Step 5: Run the scripts suites**

Run: `python3 -m pytest scripts/tests -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/cl.py scripts/install.sh scripts/tests/test_cl_launcher.py scripts/tests/test_install_sh.py
git commit -m "feat(cl): launcher picks the Claude account per session (flag, resume, rule, usage)"
```

---

### Task 17: Board Open/Restore start sessions through `cl` when installed

**Files:**
- Modify: `helper/fo_open.py:291-302` (`plan` signature and the `open` tails), new `cl_path()` after `fo_home()` (~:325), the `plan(...)` calls in `main` (~:445, ~:450)
- Create: `helper/tests/test_open_cl.py`

**Interfaces:**
- Consumes: `$FO_HOME/bin/cl` (Task 16), which itself keeps a resumed session on its recorded account.
- Produces: `plan(cmd, args, root, roots=None, cl=None)`; `cl_path() -> str | None`. With `cl`: new = `<cl>`, worktree = `<cl> --worktree`, restore = `<cl> --resume <id>`; without: `claude…` exactly as today. (Deviation from the spec's `cl --account <label> --resume <id>`: `plan()` stays pure and offline, and `cl --resume <id>` already resolves the session's account via `/api/usage?session=`; the account is the same.) `cl` execs `claude`, so iTerm tabs still show a `claude` job.

- [ ] **Step 1: Write the failing tests**

Create `helper/tests/test_open_cl.py`:

```python
import os
import shlex

from helper_fixtures import fo_home, root  # noqa: F401 (fixtures)
import fo_open as fo

U1 = "8c1f0e2a-1111-4222-8333-444455556666"
CL = "/Users/p/.flowobserve/bin/cl"


def test_open_and_restore_use_cl_when_given(root):
    d = os.path.realpath(os.path.join(root, "app"))
    [a] = fo.plan(*fo.parse("flowobserve://open?path=app"), root, None, CL)
    assert a[2].endswith(f"cd {shlex.quote(d)} && {CL}")
    [a] = fo.plan(*fo.parse(f"flowobserve://open?path=app&resume={U1}"), root, None, CL)
    assert a[2].endswith(f"cd {shlex.quote(d)} && {CL} --resume {U1}")
    os.makedirs(os.path.join(root, "app", ".git"), exist_ok=True)
    [a] = fo.plan(*fo.parse("flowobserve://open?path=app&wt=1"), root, None, CL)
    assert a[2].endswith(f"&& {CL} --worktree")


def test_without_cl_it_is_plain_claude(root):
    [a] = fo.plan(*fo.parse(f"flowobserve://open?path=app&resume={U1}"), root)
    assert a[2].endswith(f"&& claude --resume {U1}")


def test_cl_path_needs_an_executable_file(fo_home):
    p = os.path.join(os.environ["FO_HOME"], "bin", "cl")
    assert fo.cl_path() is None
    os.makedirs(os.path.dirname(p))
    with open(p, "w") as f:
        f.write("#!/bin/sh\n")
    os.chmod(p, 0o644)
    assert fo.cl_path() is None
    os.chmod(p, 0o755)
    assert fo.cl_path() == p
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `python3 -m pytest helper/tests/test_open_cl.py -q`
Expected: FAIL — `plan() takes from 3 to 4 positional arguments but 5 were given`, no `cl_path`.

- [ ] **Step 3: Implement**

In `helper/fo_open.py` change `def plan(cmd, args, root, roots=None):` to:

```python
def plan(cmd, args, root, roots=None, cl=None):
    """Pure: validated link -> list of actions. Raises Rejected. cl = path of the cl launcher, or None for plain claude."""
```

(replacing the old one-line docstring), and in the `open` branch replace the two `tails = …` lines with:

```python
        run = shlex.quote(cl) if cl else "claude"
        if "wt" in args:
            if args["wt"] != "1" or "resume" in args:
                raise Rejected("Link rejected — bad parameter")
            if not os.path.isdir(os.path.join(d, ".git")):
                raise Rejected("Link rejected — not a main folder")
            tails = [run + " --worktree"]
        else:
            tails = ["%s --resume %s" % (run, i) for i in parse_resume(args.get("resume"))] or [run]
```

(this replaces the whole `if "wt" in args: … else: …` block). After `def fo_home():` add:

```python
def cl_path():
    """$FO_HOME/bin/cl when install.sh put it there (executable), else None: plain claude as before."""
    p = os.path.join(fo_home(), "bin", "cl")
    return p if os.path.isfile(p) and os.access(p, os.X_OK) else None
```

In `main`, change the two session-opening calls to pass it:

```python
                    acts = plan("open", {"path": name, "root": label}, cfg["root"], roots_of(cfg), cl_path())
```

```python
                acts = plan(cmd, args, cfg["root"], roots_of(cfg), cl_path())
```

- [ ] **Step 4: Run the helper suite**

Run: `python3 -m pytest helper/tests -q`
Expected: PASS (existing `claude --resume` tests unchanged: `cl` defaults to None).

- [ ] **Step 5: Commit**

```bash
git add helper/fo_open.py helper/tests/test_open_cl.py
git commit -m "feat(helper): board Open/Restore start sessions through cl when installed"
```

---

### Task 17b: ⌘1–⌘9 select a tab on the board

User request (2026-10-12): quick keyboard selection of a tab. Select on the board only; nothing opens outside it. Spec §10.

**Files:**
- Modify: `pwa/src/ui/tabs.ts` (extract the click logic into `selectTab(id)`, keep the last rendered tab list, add `selectTabAt(n)`, hint attributes and badge)
- Modify: `pwa/src/input.ts` (⌘1–9 before the `metaKey` early return at ~:122; `body.cmd` on Meta down/up/blur), using the module's existing hook pattern (`hooks.*`) if input.ts does not import ui modules directly — follow what is there
- Modify: `pwa/src/styles.css` (badge hidden unless `body.cmd`)
- Test: the existing pwa unit test files for tabs and input (find them under `pwa/test`), append tests

**Interfaces:**
- Consumes: `portraitTabs` / `landscapeTabs` (`pwa/src/tabs.ts`), `pagerGo`, `renderCards`, `selectProject`, `cpage`, `ui.portrait` as used by `bindTabs` today.
- Produces:
  - `export function selectTab(id: string): void` in `pwa/src/ui/tabs.ts` — the body of today's click handler (portrait: `if (store.sessions.has(id)) { pagerGo(id); renderCards(); }`; landscape: find the fleet index whose `groups[0]?.key === id`, then `selectProject(i); renderCards();`). The click handler calls it.
  - `export function selectTabAt(n: number): boolean` — `n` in 1..9; target index = `n === 9 && shown.length > 9 ? shown.length - 1 : n - 1`; if a tab exists there, `selectTab(shown[idx].id)` and return true; else false. `shown` = the `tabs` array from the latest `renderTabs` call (module-level, set before the `sig` early return).
  - Each rendered tab with index < 9: `b.setAttribute("aria-keyshortcuts", "Meta+" + (i + 1))`, title gets ` · ⌘${i + 1}` appended, and a `<span class="kb">⌘${i + 1}</span>` child. Include the index in nothing else (the `sig` string is unchanged because positions follow `tabs` order).
  - CSS: `#tabs .kb{display:none}` and `body.cmd #tabs .kb{display:inline}` with the tab's existing small-label styling (look at `.no`).

- [ ] **Step 1: Failing tests**
  - tabs: render 3 portrait tabs → `selectTabAt(1)` focuses the first session (pager focus = its id) and returns true; `selectTabAt(5)` returns false and changes nothing; with 12 tabs `selectTabAt(9)` selects the 12th; landscape with 2 projects → `selectTabAt(2)` selects project index 1; the first 9 tabs have `aria-keyshortcuts` `Meta+1`…`Meta+9` and the 10th has none; title of tab 1 ends with `· ⌘1`.
  - input: dispatch `keydown` `{key: "1", metaKey: true}` on document → tab 1 selected and `defaultPrevented` true; `{key: "5", metaKey: true}` with 3 tabs → not prevented; `{key: "1", ctrlKey: true}` and `{key: "1", metaKey: true, shiftKey: true}` → nothing; target an `<input>` → nothing; with the spend drawer open → nothing; `keydown {key: "Meta"}` adds `body.cmd`, `keyup {key: "Meta"}` and `window` `blur` remove it.
- [ ] **Step 2: Run, expect failures** — `pnpm --filter @fo/pwa test <the two files>`
- [ ] **Step 3: Implement** as in Interfaces. In input.ts the ⌘ branch goes after the input/sheet guard and the Escape handlers, before `if (e.metaKey || e.ctrlKey || e.altKey) return;`: `if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(k)) { if (!drawerOpen() && selectTabAt(Number(k))) e.preventDefault(); return; }`.
- [ ] **Step 4: Run tests again (PASS), then `pnpm --filter @fo/pwa test` and `pnpm typecheck`.**
- [ ] **Step 5: Commit** — `git commit -m "feat(pwa): ⌘1–⌘9 select a tab on the board"`

---

### Task 18: Docs

**Files:**
- Modify: `README.md` (new section after "## Uninstall"; config table rows; "What it does" usage bullet)
- Modify: `docs/ARCHITECTURE.md` ("The hook", "What it reads and writes", "Network", wire contract bullets, iTerm2 helper)

**Interfaces:**
- Consumes: everything above.
- Produces: user docs.

- [ ] **Step 1: README "Several accounts" section**

Insert after the `## Uninstall` section (before `## Configuration`):

````markdown
## Several accounts
Run two Claude accounts on one Mac, each in its own config dir, and see both on one board. Install once per dir:
```sh
scripts/install.sh                                                   # ~/.claude
CLAUDE_DIR=~/.claude-personal FO_ACCOUNT_LABEL=Pro scripts/install.sh
```
Each run wires that dir (hooks and statusline; Dryas is optional) and records it in `~/.flowobserve/accounts.json`, in the order you install. Re-running for a dir keeps its label unless you pass `FO_ACCOUNT_LABEL`. The server, launchd agent and hook copy are shared. Wire a dir only through `install.sh`: it tags that dir's hook commands with the account.

With more than one account, every card names its account (`NO DRYAS` marks a dir without the Dryas Workflow), the usage tiles show one 5-hour and weekly pair per account, and when an account reaches `FO_SWITCH_AT` of its 5-hour limit the board says, for example, `Team 92% of 5h: /handoff, continue in Pro`. It is a hint only: flowobserve never switches accounts. In portrait the slim row marks another account near its limit with its first letter.

An account reports limits only through its statusline: copy a `statusLine` into the second dir's `settings.json` before installing if it has none. Cost per project includes every account but is not split by account.

To remove one account: `CLAUDE_DIR=~/.claude-personal scripts/uninstall.sh` (the server keeps running for the others).

### Pick the account per session: `cl`
`install.sh` also puts a small launcher at `~/.flowobserve/bin/cl` (add `~/.flowobserve/bin` to your `PATH`; the installer prints the line). Start sessions with `cl` instead of `claude`:
```sh
cl                    # picks the account, then runs claude with your arguments
cl --pro              # or --team, or --account LABEL
cl --resume <id>      # always the account the session was recorded under
cl --dry-run          # show the choice and the command, start nothing
```
It decides in this order: your flag; for `--resume`, the session's own account; the longest matching rule in `accounts.json`; the default account if its 5-hour use is under `FO_SWITCH_AT` (or unknown); else the account with the lowest known 5-hour use under it; else the default account. If flowobserve is not running, it uses the default account. It prints its reason in one line, for example `cl → Pro (Team 5h 93%)`. Rules are optional and edited by hand:
```json
{"accounts": [...], "rules": [{"path": "~/clients", "label": "Team"}]}
```
When `cl` is installed, the board's Open and Restore buttons in iTerm2 start sessions through it.
````

- [ ] **Step 2: README configuration table**

Replace the `FO_SESSIONS_DIR` row with:

```markdown
| `FO_SESSIONS_DIR` | `<dir>/sessions` of every account in `accounts.json` (else `~/.claude/sessions`); set it to read one folder only |
```

Replace the `FO_TRANSCRIPTS` row with:

```markdown
| `FO_TRANSCRIPTS` | `<dir>/projects` of every account in `accounts.json` (else `~/.claude/projects`); set it to read one folder only |
```

Add after the `FO_THRESHOLDS` row:

```markdown
| `FO_SWITCH_AT` | `0.9`: 5-hour use at which the board suggests moving work to another account; `1` turns the hint off. Put it in the plist; re-running `install.sh` rewrites the plist |
```

In "What it does", change the **Tracks limits and cost.** bullet's first sentence to: `5-hour and weekly plan usage per Claude account (and the Fable meter, when your Claude usage cache reports one) with a pace marker, a hint when one account nears its limit, and API-equivalent cost per project and model (click the usage tiles).`

- [ ] **Step 3: ARCHITECTURE**

In "## The hook" append: `Every line carries `acct`, the Claude config dir it came from with the home prefix written as `~` (`FO_ACCT` set by the installer, else `CLAUDE_CONFIG_DIR`, else `~/.claude`).`

In "## What it reads and writes" replace the transcripts and sessions bullets with:

```markdown
- `~/.flowobserve/accounts.json`, the Claude config dirs to watch and their labels (written by `install.sh`);
- Claude Code transcripts under `<dir>/projects` of every account, numbers only (message id, model, token usage, and the Remote Control takeover time), never text;
- `<dir>/sessions/*.json` of every account, for pid, session id and kind only, to drop sessions whose process has gone;
```

and change `- `~/.claude/usage-cache.json`, …` to start with ``- `~/.claude/usage-cache.json` (default account only), …``.

Under the wire contract bullets, change the **Usage** bullet to: `**Usage**: 5-hour and weekly plan use (`used` 0-1 with reset times) of the default account, optional Fable meter, `jev` (`{usedUsd, budgetUsd, monthStart}`, `null` when Jev is not installed), and with several accounts `accounts` (one `{label, session, weekly, at, primary?, near?}` per account) and `switch` (`{from, to, used}` or `null`). The server keeps one reading per account and stores them as one map.` and add to the **Session** bullet: `, and `account` (`{label, dryas}`) when there are several accounts`.

In "## Network", after the sentence about `/events`, add: `GET /api/usage` returns each account's 5-hour and weekly use (`{accounts: [{label, dir, fiveHour, sevenDay, at}], switchAt}`, `null` before a reading) and, with `?session=<id>`, the account a session was recorded under. The `cl` launcher (`~/.flowobserve/bin/cl`) reads it to choose the config dir before it starts `claude`; it never writes anything.

In "## The iTerm2 helper", append: `When `~/.flowobserve/bin/cl` exists, Open starts `cl` and Restore starts `cl --resume <id>`, so a restored session stays on its own account.`

- [ ] **Step 4: Check and commit**

Run: `node scripts/leakcheck.mjs . && pnpm test`
Expected: leakcheck prints no hits; all tests PASS.

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs: several Claude accounts on one board"
```

---

## Self-Review

**Spec coverage**
- §1 accounts file (format, `~`, default label, default account, missing file, order) → Tasks 4 (writer), 8 (reader), 6 (install flow).
- §2 hook `acct` on hook/truncated/statusline lines, through `fit()`, dedup `acct + sid`, fallback → Task 7 (plus `FO_ACCT` deviation, Task 5).
- §3 `SpoolLine.acct`, `SessionState.acct` set once, `SessionZ.account` only with >1 account, `dryas`, unknown acct label + `unknownAccount` → Task 9; Dryas-less tag on the card → Task 12.
- §4 usage map, per-account older-reading rule, persisted map + migration, cache/fable default only, `UsageZ.accounts` ≤ 8, top-level = default, `renderUsage` rows with pace and AS OF per row, slim marker → Tasks 10, 13.
- §5 switch rule, freshness, highest from, lowest to, never-reported last, null when none, `FO_SWITCH_AT` env, `1` = off, hint copy, not a session state → Tasks 11, 13, docs in 15.
- §6 multi-root transcripts, overrides, registry merge, missing dir skipped → Task 14.
- §7 installer: chain optional with `info` line, unparsable chain still an error, `account add/remove` atomic/order/no dupes, install.sh with `FO_ACCOUNT_LABEL`, uninstall.sh partial → Tasks 3, 4, 6. Windows untouched.
- §8 portrait drawer at the three sizes, cause confirmed, portrait CSS, scroll inside drawer, money columns unclipped → Task 2.
- Error handling (unreadable accounts file logged once per change, unknown acct counted not dropped, hook fallback, first reading creates entry) → Tasks 8, 9, 7, 10.
- Testing list: every bullet has a test in the matching task; leakcheck in Task 15; goldens checked in Tasks 9-11, 14.
- §9 `cl`: `/api/usage` shape, nulls, `?session=` lookup, origin check → Task 15; flag/resume/rule (longest)/usage pick/all near/server down/no file, printed line, env to exec, `--dry-run`, install copy + PATH line, rules kept by the installer → Task 16; helper Open/Restore with and without `cl` → Task 17.
- Docs → Task 18. Manual assumption check → Task 1.

**Placeholder scan (after the §9 tasks were added):** no TBD/TODO/"similar to"; every code step has full code; `void now;` in Task 10's `accountRows` is intentional and removed in Task 11.

**Type consistency:** `Account {dir,label,dryas}`, `DEFAULT_ACCT`, `canonAcct`, `makeAccount`, `accountRoots`, `AccountsFile.check()/accounts()` match across Tasks 8, 9, 14. `setUsage(u, acct = DEFAULT_ACCT)`, `primaryAcct()`, `accountRows(now)` match across 10-11. `AccountUsage` gains `near` in 11 and is consumed in 13 with `primary`/`near`. `switchHint(rows, now, threshold)`/`SwitchRow`/`usedNow` match. `toWire` `extra.account` matches `Engine.extraFor`. Python: `acct_of_dir`, `default_label`, `add_account(d, acct, label, seed_default)`, `remove_account`, `acct_tag`, `hook_command(..., acct)`, `wrap_prefix(hook, acct)`, `wire_settings(..., acct)` match across Tasks 4-7; hook `acct_of(env)` and key `acct + "|" + sid` match Task 7's tests. `Engine.usageApi()`/`sessionAccount()` (Task 15) return `{label, dir, …}` as `cl.decide` reads them (Task 16); `plan(cmd, args, root, roots=None, cl=None)` and `cl_path()` match Task 17's tests.
