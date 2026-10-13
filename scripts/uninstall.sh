#!/bin/sh
# Remove flowobserve wiring and the launchd agent. Keeps ~/.flowobserve (spool, fo.db, hook copy) and all .bak files.
# --claude-dir DIR (repeatable) unwires those Claude config dirs instead of ~/.claude.
# Default (no --claude-dir, CLAUDE_DIR unset or ~/.claude): unwires ~/.claude and every other dir in accounts.json, then removes the agent.
# With other dirs given (or CLAUDE_DIR set to another dir), only those are unwired and dropped from accounts.json and the
# server keeps running while another listed account is still wired; when none is, the agent is removed too.
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
# Expand a leading ~, make relative paths absolute, strip trailing slashes (not for / itself).
norm_dir() {
  case "$1" in "~") n=$HOME ;; "~/"*) n=$HOME/${1#"~/"} ;; /*) n=$1 ;; *) n=$PWD/$1 ;; esac
  while [ "${n%/}" != "$n" ] && [ "$n" != "/" ]; do n=${n%/}; done
  printf '%s' "$n"
}
add_dir() { [ -n "$1" ] || die "--claude-dir needs a directory"; DIRS="$DIRS$(norm_dir "$1")$NL"; }
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
[ -n "$DIRS" ] || DIRS="$(norm_dir "$CLAUDE_DIR")$NL"

FI="$REPO/scripts/fo_install.py"
HOOK="$FO_HOME/bin/fo_hook.py"
ALLACCTS=
if [ -z "$GIVEN" ] && [ "${CLAUDE_DIR%/}" = "$HOME/.claude" ]; then ALLACCTS=1; fi

FAILED=  # newline-separated dirs (paths may contain spaces); match whole lines
failed() { [ -n "$FAILED" ] && printf '%s\n' "$FAILED" | grep -Fxq -- "$1"; }
# Each failure is recorded once, however often it recurs.
fail() { echo "warn: $1" >&2; failed "$2" || FAILED="$FAILED$2$NL"; }
# Sets ACCTS to the account list; an unreadable accounts.json warns, counts as a failure and lists nothing.
# Not called in $(...): fail must update FAILED in this shell.
list_accounts() {
  ACCTS=$("$PY" "$FI" account list --home "$FO_HOME" "$@") || { ACCTS=; fail "account list failed (is $FO_HOME/accounts.json corrupt?); treating the list as empty" "$FO_HOME/accounts.json"; }
}
while IFS= read -r d; do
  [ -n "$d" ] || continue
  if "$PY" "$FI" unwire --claude-dir "$d" --hook "$HOOK"; then
    "$PY" "$FI" account remove --home "$FO_HOME" --claude-dir "$d" >/dev/null || fail "account remove failed for $d" "$d"
  else
    fail "unwire failed for $d; its settings untouched" "$d"
  fi
done <<EOF
$DIRS
EOF
if [ -n "$ALLACCTS" ]; then
  list_accounts; others=$ACCTS
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    case "$d" in "~") x=$HOME ;; "~/"*) x=$HOME/${d#"~/"} ;; *) x=$d ;; esac
    if [ -d "$x" ]; then
      if "$PY" "$FI" unwire --claude-dir "$x" --hook "$HOOK"; then
        echo "unwired $d"
      else
        fail "unwire failed for $d" "$d"
        continue
      fi
    else
      echo "skipped $d (directory gone)"
    fi
    "$PY" "$FI" account remove --home "$FO_HOME" --claude-dir "$x" >/dev/null || fail "account remove failed for $d" "$d"
  done <<EOF
$others
EOF
else
  # Only a listed dir that still carries our hook keeps the server alive; listed-but-unwired dirs do not count.
  # A given dir that failed to unwire may still carry the hook; it never counts as another account.
  list_accounts --wired; wired=$ACCTS
  others=
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    case "$d" in "~") x=$HOME ;; "~/"*) x=$HOME/${d#"~/"} ;; *) x=$d ;; esac
    failed "$x" || others="$others$d$NL"
  done <<EOF
$wired
EOF
  if [ -n "$others" ]; then
    echo "flowobserve unwired from the given dirs. The server keeps running for your other accounts."
    [ -z "$FAILED" ] || { printf 'uninstall: these could not be updated:\n%s' "$FAILED" >&2; exit 1; }
    exit 0
  fi
  echo "flowobserve unwired (the last account)."
  list_accounts; left=$ACCTS
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    case "$d" in "~") x=$HOME ;; "~/"*) x=$HOME/${d#"~/"} ;; *) x=$d ;; esac
    ! failed "$x" || continue  # stays listed so a retry can find it
    "$PY" "$FI" account remove --home "$FO_HOME" --claude-dir "$x" >/dev/null || fail "account remove failed for $d" "$d"
  done <<EOF
$left
EOF
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
[ -z "$FAILED" ] || { echo 'uninstall: torn down, with errors.' >&2; printf 'uninstall: these could not be updated:\n%s' "$FAILED" >&2; exit 1; }
echo "flowobserve uninstalled. Data kept in $FO_HOME (delete by hand if wanted)."
