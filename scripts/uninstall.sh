#!/bin/sh
# Remove flowobserve wiring and the launchd agent. Keeps ~/.flowobserve (spool, fo.db, hook copy) and all .bak files.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
FO_HOME=${FO_HOME:-$HOME/.flowobserve}
CLAUDE_DIR=${CLAUDE_DIR:-$HOME/.claude}
LA=${FO_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}
LABEL=com.promprit.flowobserve

/usr/bin/python3 "$REPO/scripts/fo_install.py" unwire --claude-dir "$CLAUDE_DIR" --hook "$FO_HOME/bin/fo_hook.py" \
  || { echo "uninstall: unwire failed; settings untouched" >&2; exit 1; }
if [ -z "${FO_SKIP_LAUNCHCTL-}" ] && [ -z "${FO_FAKE_LAUNCHCTL-}" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
fi
rm -f "$LA/$LABEL.plist"
rm -rf "$HOME/Applications/flowobserve-open.app"
rm -f "$FO_HOME/helper.json"
echo "flowobserve uninstalled. Data kept in $FO_HOME (delete by hand if wanted)."
