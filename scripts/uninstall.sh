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
