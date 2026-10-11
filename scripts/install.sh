#!/bin/sh
# Install flowobserve: build, copy the hook out of the repo, launchd agent, wire ~/.claude. Safe to re-run.
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
while [ $# -gt 0 ]; do
  case "$1" in
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
for f in fo_hook.py fo_derive.py fo_redact.py; do
  { cp "$REPO/hook/$f" "$FO_HOME/bin/$f.tmp" && mv "$FO_HOME/bin/$f.tmp" "$FO_HOME/bin/$f"; } || die "copy $f failed"
done

HELPER_BUILD=${FO_HELPER_BUILD:-$REPO/helper/build.sh}
if [ -z "${FO_SKIP_HELPER-}" ] && [ "$EDITION" != vscode ]; then
  sh "$HELPER_BUILD" "$HOME/Applications" || die "helper build failed"
fi

PROOT=${FO_PROJECTS_ROOT-}
[ -n "$PROOT" ] || PROOT=$("$PY" "$REPO/scripts/fo_install.py" helper-root --home "$FO_HOME")
if [ -n "$PROOT" ]; then
  "$PY" "$REPO/scripts/fo_install.py" helper-json --home "$FO_HOME" --root "$PROOT" || die "helper.json failed"
fi

"$PY" "$REPO/scripts/fo_install.py" plist --node "$NODE" --repo "$REPO" --home "$FO_HOME" --edition "$EDITION" ${PROOT:+--projects-root "$PROOT"} > "$PLIST.tmp"
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

"$PY" "$REPO/scripts/fo_install.py" wire --claude-dir "$CLAUDE_DIR" --hook "$FO_HOME/bin/fo_hook.py" || die "wiring failed"
out=$("$PY" "$REPO/scripts/fo_install.py" status --claude-dir "$CLAUDE_DIR" --hook "$FO_HOME/bin/fo_hook.py")
echo "$out"
if echo "$out" | grep -q '^warn'; then die "wiring incomplete (see warn lines)"; fi
if [ "$EDITION" != iterm ] && command -v code >/dev/null 2>&1 && ! code --list-extensions 2>/dev/null | grep -qi '^mhelbich\.claude-code-usage-status$'; then
  echo "warn: Live usage limits need the Claude Code Usage Status extension (mhelbich.claude-code-usage-status)"
fi
echo "flowobserve installed ($EDITION edition). Open http://127.0.0.1:4317 and use Add to Dock / Install."
