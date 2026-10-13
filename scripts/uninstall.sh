#!/bin/sh
# Remove flowobserve wiring and the launchd agent. Keeps ~/.flowobserve (spool, fo.db, hook copy) and all .bak files.
# Default (CLAUDE_DIR unset or ~/.claude): unwires ~/.claude and every other dir in accounts.json, then removes the agent.
# With CLAUDE_DIR set to another dir, only that dir is unwired and dropped from accounts.json and the server keeps
# running for the other accounts; when it was the last account listed, the agent is removed too.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
FO_HOME=${FO_HOME:-$HOME/.flowobserve}
CLAUDE_DIR=${CLAUDE_DIR:-$HOME/.claude}
LA=${FO_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}
LABEL=com.promprit.flowobserve
FI="$REPO/scripts/fo_install.py"
HOOK="$FO_HOME/bin/fo_hook.py"

/usr/bin/python3 "$FI" unwire --claude-dir "$CLAUDE_DIR" --hook "$HOOK" \
  || { echo "uninstall: unwire failed; settings untouched" >&2; exit 1; }
if [ "${CLAUDE_DIR%/}" != "$HOME/.claude" ]; then
  /usr/bin/python3 "$FI" account remove --home "$FO_HOME" --claude-dir "$CLAUDE_DIR" \
    || { echo "uninstall: account remove failed" >&2; exit 1; }
  left=$(/usr/bin/python3 "$FI" account list --home "$FO_HOME") || { echo "uninstall: account list failed" >&2; exit 1; }
  if [ -n "$left" ]; then
    echo "flowobserve unwired from $CLAUDE_DIR. The server keeps running for your other accounts."
    exit 0
  fi
  echo "flowobserve unwired from $CLAUDE_DIR (the last account)."
else
  /usr/bin/python3 "$FI" account remove --home "$FO_HOME" --claude-dir "$CLAUDE_DIR" \
    || { echo "uninstall: account remove failed" >&2; exit 1; }
  others=$(/usr/bin/python3 "$FI" account list --home "$FO_HOME") || { echo "uninstall: account list failed" >&2; exit 1; }
  printf '%s\n' "$others" | while IFS= read -r d; do
    [ -n "$d" ] || continue
    case "$d" in "~") x=$HOME ;; "~/"*) x=$HOME/${d#"~/"} ;; *) x=$d ;; esac
    if [ -d "$x" ]; then
      /usr/bin/python3 "$FI" unwire --claude-dir "$x" --hook "$HOOK" \
        || { echo "uninstall: unwire failed for $d" >&2; exit 1; }
      echo "unwired $d"
    else
      echo "skipped $d (directory gone)"
    fi
    /usr/bin/python3 "$FI" account remove --home "$FO_HOME" --claude-dir "$x" >/dev/null \
      || { echo "uninstall: account remove failed for $d" >&2; exit 1; }
  done
fi
if [ -z "${FO_SKIP_LAUNCHCTL-}" ] && [ -z "${FO_FAKE_LAUNCHCTL-}" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
fi
rm -f "$LA/$LABEL.plist"
rm -rf "$HOME/Applications/flowobserve-open.app"
rm -f "$FO_HOME/helper.json"
echo "flowobserve uninstalled. Data kept in $FO_HOME (delete by hand if wanted)."
