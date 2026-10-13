#!/bin/sh
# Install flowobserve: build, copy the hook out of the repo, launchd agent, wire ~/.claude and record it in accounts.json. Safe to re-run.
# --claude-dir DIR (repeatable) wires those Claude config dirs instead (several accounts, as in Dryas's accounts.json).
# Exit codes: 0 installed; 1 failed (or wiring incomplete); 3 installed, but the Dryas flowobserve stage is off.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
FO_HOME=${FO_HOME:-$HOME/.flowobserve}
CLAUDE_DIR=${CLAUDE_DIR:-$HOME/.claude}
LA=${FO_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}
NODE=${FO_NODE:-$(command -v node || true)}
LABEL=com.promprit.flowobserve
PLIST=$LA/$LABEL.plist
HEALTH=${FO_HEALTH_URL:-http://127.0.0.1:4317/health}
TRIES=${FO_HEALTH_TRIES:-20}
PY=/usr/bin/python3

die() { echo "install: $*" >&2; exit 1; }

EDITION=
DIRS=  # newline-separated --claude-dir values
NL='
'
add_dir() { [ -n "$1" ] || die "--claude-dir needs a directory"; DIRS="$DIRS$1$NL"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --claude-dir=*) add_dir "${1#--claude-dir=}"; shift ;;
    --claude-dir)
      [ $# -ge 2 ] || die "--claude-dir needs a directory"
      add_dir "$2"; shift 2 ;;
    --edition=*)
      EDITION=${1#--edition=}
      [ -n "$EDITION" ] || die "--edition needs vscode, iterm or both"
      shift ;;
    --edition)
      { [ $# -ge 2 ] && [ -n "$2" ]; } || die "--edition needs vscode, iterm or both"
      EDITION=$2; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
case "$EDITION" in
  ""|vscode|iterm|both) ;;
  *) die "--edition must be vscode, iterm or both" ;;
esac
[ -n "$EDITION" ] || EDITION=$("$PY" "$REPO/scripts/fo_install.py" plist-edition --plist "$PLIST")
if [ -z "$EDITION" ]; then
  if [ -t 0 ]; then
    tries=0
    while [ -z "$EDITION" ] && [ "$tries" -lt 2 ]; do
      printf 'Edition: vscode (Claude Code in VS Code), iterm (claude CLI in iTerm2) or both? [both] '
      read -r EDITION || EDITION=both
      [ -n "$EDITION" ] || EDITION=both
      case "$EDITION" in vscode|iterm|both) ;; *) EDITION=; tries=$((tries + 1)) ;; esac
    done
    [ -n "$EDITION" ] || EDITION=both
  else
    EDITION=both
  fi
fi
echo "edition: $EDITION"

[ "$(basename "$FO_HOME")" = ".flowobserve" ] || die "FO_HOME must end in .flowobserve (got $FO_HOME)"
{ [ -n "$NODE" ] && [ -x "$NODE" ]; } || die "node not found; set FO_NODE"
major=$("$NODE" --version 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p')
[ -n "$major" ] || die "cannot read node version from $NODE"
[ "$major" -ge 24 ] || die "Node >= 24 required (found v$major at $NODE)"

if [ -z "${FO_SKIP_BUILD-}" ]; then
  (cd "$REPO" && pnpm install --frozen-lockfile && pnpm build) || die "build failed"
fi

mkdir -p "$FO_HOME/bin" "$FO_HOME/spool" "$LA"
for f in fo_hook.py fo_derive.py fo_redact.py fo_status.py; do
  { cp "$REPO/hook/$f" "$FO_HOME/bin/$f.tmp" && mv "$FO_HOME/bin/$f.tmp" "$FO_HOME/bin/$f"; } || die "copy $f failed"
done
{ cp "$REPO/scripts/cl.py" "$FO_HOME/bin/cl.tmp" && chmod 755 "$FO_HOME/bin/cl.tmp" && mv "$FO_HOME/bin/cl.tmp" "$FO_HOME/bin/cl"; } || die "copy cl failed"

HELPER_BUILD=${FO_HELPER_BUILD:-$REPO/helper/build.sh}
if [ -z "${FO_SKIP_HELPER-}" ] && [ "$EDITION" != vscode ]; then
  sh "$HELPER_BUILD" "$HOME/Applications" || die "helper build failed"
fi

PROOT=${FO_PROJECTS_ROOT-}
[ -n "$PROOT" ] || PROOT=$("$PY" "$REPO/scripts/fo_install.py" helper-root --home "$FO_HOME")
if [ -n "$PROOT" ]; then
  "$PY" "$REPO/scripts/fo_install.py" helper-json --home "$FO_HOME" --root "$PROOT" || die "helper.json failed"
fi

# FO_DISKS (host disk gauges) and DRYAS_DATA_ROOT: env wins, else keep what the installed plist has.
DISKS=${FO_DISKS-}
[ -n "$DISKS" ] || DISKS=$("$PY" "$REPO/scripts/fo_install.py" plist-disks --plist "$PLIST")
DROOT=${DRYAS_DATA_ROOT-}
[ -n "$DROOT" ] || DROOT=$("$PY" "$REPO/scripts/fo_install.py" plist-env --plist "$PLIST" --key DRYAS_DATA_ROOT)
[ -z "$DROOT" ] || export DRYAS_DATA_ROOT="$DROOT"  # the accounts and stage checks below use it too
"$PY" "$REPO/scripts/fo_install.py" plist --node "$NODE" --repo "$REPO" --home "$FO_HOME" --edition "$EDITION" ${PROOT:+--projects-root "$PROOT"} ${DISKS:+--disks "$DISKS"} ${DROOT:+--dryas-root "$DROOT"} > "$PLIST.tmp"
mv "$PLIST.tmp" "$PLIST"

if [ -z "${FO_SKIP_LAUNCHCTL-}" ]; then
  if [ -z "${FO_FAKE_LAUNCHCTL-}" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    # bootout returns before teardown ends; bootstrap then fails with error 5
    i=0
    while [ "$i" -lt "$TRIES" ] && launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; do
      i=$((i + 1)); sleep 0.5
    done
    launchctl bootstrap "gui/$(id -u)" "$PLIST" || die "launchctl bootstrap failed"
  fi
  i=0; ok=
  while [ "$i" -lt "$TRIES" ]; do
    if curl -fsS --max-time 1 "$HEALTH" 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
    i=$((i + 1)); sleep 0.5
  done
  [ -n "$ok" ] || die "server health check failed at $HEALTH; see $FO_HOME/server.log"
fi

[ -n "$DIRS" ] || DIRS="$CLAUDE_DIR$NL"
ndirs=$(printf '%s' "$DIRS" | grep -c .)  # FO_ACCOUNT_LABEL names an account only when exactly one dir is given
if [ "$ndirs" -eq 1 ] && [ -n "${FO_ACCOUNT_LABEL-}" ]; then  # check before any dir is wired
  "$PY" "$REPO/scripts/fo_install.py" account check-label --label "$FO_ACCOUNT_LABEL" || die "invalid FO_ACCOUNT_LABEL; nothing was wired"
fi
HOOK="$FO_HOME/bin/fo_hook.py"
rm -f "$FO_HOME/disabled"  # uninstall's off switch for hook entries left behind
warned= ; off= ; all=
while IFS= read -r d; do
  [ -n "$d" ] || continue
  "$PY" "$REPO/scripts/fo_install.py" wire --claude-dir "$d" --hook "$HOOK" || die "wiring $d failed"
  label=; [ "$ndirs" -ne 1 ] || label=${FO_ACCOUNT_LABEL-}
  "$PY" "$REPO/scripts/fo_install.py" account add --home "$FO_HOME" --claude-dir "$d" ${label:+--label "$label"} \
    || die "account add $d failed"
  out=$("$PY" "$REPO/scripts/fo_install.py" status --claude-dir "$d" --hook "$HOOK")
  echo "claude dir: $d"
  echo "$out"
  if echo "$out" | grep -q '^warn'; then warned=1; fi
  if echo "$out" | grep -q '^off'; then off=$d; fi
  all="$all --claude-dir '$d'"
done <<EOF
$DIRS
EOF
# Dryas accounts (~/.dryas/accounts.json) not wired yet: say how; never edit a dir that was not asked for.
missing=$("$PY" "$REPO/scripts/fo_install.py" accounts --unwired --hook "$HOOK" --exclude "$DIRS")
if [ -n "$missing" ]; then
  while IFS= read -r d; do
    echo "note: Dryas account $d is not wired for flowobserve"
    all="$all --claude-dir '$d'"
  done <<EOF
$missing
EOF
  echo "note: to wire every account, run: '$REPO/scripts/install.sh' --edition $EDITION$all"
fi
if [ "$EDITION" != iterm ] && command -v code >/dev/null 2>&1 && ! code --list-extensions 2>/dev/null | grep -qi '^mhelbich\.claude-code-usage-status$'; then
  echo "warn: Live usage limits need the Claude Code Usage Status extension (mhelbich.claude-code-usage-status)"
fi
case ":$PATH:" in
  *":$FO_HOME/bin:"*) ;;
  *) echo "cl (pick the account per session): add this to your shell profile: export PATH=\"$FO_HOME/bin:\$PATH\"" ;;
esac
echo "flowobserve installed ($EDITION edition). Open http://127.0.0.1:4317 and use Add to Dock / Install."
[ -z "$warned" ] || die "wiring incomplete (see warn lines)"
if [ -n "$off" ]; then
  # The Dryas chain stage feeds PreToolUse / UserPromptSubmit. It lives in ~/.dryas/chain.local.json, shared by every
  # account, so one Dryas setup run turns it on for all of them.
  extra=; [ "$off" = "$HOME/.claude" ] || extra=" --claude-dir '$off'"
  echo "note: turn on the Dryas flowobserve stage (once; it is shared by every account): <dryas clone>/install/install.sh --flowobserve$extra"
  echo "install: installed; Dryas stage off (exit 3)" >&2
  exit 3
fi
