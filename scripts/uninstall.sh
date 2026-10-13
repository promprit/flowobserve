#!/bin/sh
# Remove flowobserve wiring and the launchd agent. Keeps ~/.flowobserve (spool, fo.db, hook copy) and all .bak files.
# --claude-dir DIR (repeatable) unwires those Claude config dirs instead of ~/.claude.
# Default (no --claude-dir, CLAUDE_DIR unset or ~/.claude): unwires ~/.claude and every other dir in accounts.json, then removes the agent.
# With other dirs given (or CLAUDE_DIR set to another dir), only those are unwired and dropped from accounts.json and the
# server keeps running for the other accounts; when the last account listed is gone, the agent is removed too.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
FO_HOME=${FO_HOME:-$HOME/.flowobserve}
CLAUDE_DIR=${CLAUDE_DIR:-$HOME/.claude}
LA=${FO_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}
LABEL=com.promprit.flowobserve
PY=/usr/bin/python3

die() { echo "uninstall: $*" >&2; exit 1; }
DIRS=
NL='
'
add_dir() { [ -n "$1" ] || die "--claude-dir needs a directory"; DIRS="$DIRS$1$NL"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --claude-dir=*) add_dir "${1#--claude-dir=}"; shift ;;
    --claude-dir)
      [ $# -ge 2 ] || die "--claude-dir needs a directory"
      add_dir "$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
GIVEN=$DIRS
[ -n "$DIRS" ] || DIRS="$CLAUDE_DIR$NL"

FI="$REPO/scripts/fo_install.py"
HOOK="$FO_HOME/bin/fo_hook.py"
ALLACCTS=
if [ -z "$GIVEN" ] && [ "${CLAUDE_DIR%/}" = "$HOME/.claude" ]; then ALLACCTS=1; fi

while IFS= read -r d; do
  [ -n "$d" ] || continue
  "$PY" "$FI" unwire --claude-dir "$d" --hook "$HOOK" \
    || die "unwire $d failed; its settings untouched"
  "$PY" "$FI" account remove --home "$FO_HOME" --claude-dir "$d" >/dev/null || die "account remove $d failed"
done <<EOF
$DIRS
EOF
if [ -n "$ALLACCTS" ]; then
  others=$("$PY" "$FI" account list --home "$FO_HOME") || die "account list failed"
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    case "$d" in "~") x=$HOME ;; "~/"*) x=$HOME/${d#"~/"} ;; *) x=$d ;; esac
    if [ -d "$x" ]; then
      "$PY" "$FI" unwire --claude-dir "$x" --hook "$HOOK" || die "unwire failed for $d"
      echo "unwired $d"
    else
      echo "skipped $d (directory gone)"
    fi
    "$PY" "$FI" account remove --home "$FO_HOME" --claude-dir "$x" >/dev/null || die "account remove failed for $d"
  done <<EOF
$others
EOF
else
  left=$("$PY" "$FI" account list --home "$FO_HOME") || die "account list failed"
  if [ -n "$left" ]; then
    echo "flowobserve unwired from the given dirs. The server keeps running for your other accounts."
    exit 0
  fi
  echo "flowobserve unwired (the last account)."
fi
if [ -z "${FO_SKIP_LAUNCHCTL-}" ] && [ -z "${FO_FAKE_LAUNCHCTL-}" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
fi
rm -f "$LA/$LABEL.plist"
rm -rf "$HOME/Applications/flowobserve-open.app"
rm -f "$FO_HOME/helper.json"
[ ! -d "$FO_HOME" ] || : > "$FO_HOME/disabled"  # hook entries left anywhere (other accounts, the Dryas stage) now do nothing
# Other Dryas accounts that still carry our hooks (they stay until unwired; the hook fails silent without the server).
"$PY" "$FI" accounts --hook "$HOOK" --exclude "$DIRS" --wired \
  | while IFS= read -r d; do echo "note: $d is still wired (a no-op now); to unwire it run: '$REPO/scripts/uninstall.sh' --claude-dir '$d'"; done
if [ "$("$PY" "$FI" dryas-stage)" = on ]; then
  echo "note: the Dryas chain still runs the flowobserve stage (a no-op now). To turn it off for every account, run once: <dryas clone>/install/install.sh --no-flowobserve"
fi
echo "flowobserve uninstalled. Data kept in $FO_HOME (delete by hand if wanted)."
