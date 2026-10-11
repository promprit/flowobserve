#!/bin/sh
# Build flowobserve-open.app into <dest-dir> and register the flowobserve:// scheme.
set -eu
[ $# -eq 1 ] || { echo "usage: build.sh <dest-dir>" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
APP="$1/flowobserve-open.app"
PB=/usr/libexec/PlistBuddy
mkdir -p "$1"
rm -rf "$APP"
osacompile -o "$APP" "$HERE/open.applescript"
cp "$HERE/fo_open.py" "$HERE/fo_iterm.py" "$APP/Contents/Resources/"
PL="$APP/Contents/Info.plist"
"$PB" -c "Set :CFBundleIdentifier com.promprit.flowobserve.open" "$PL" 2>/dev/null \
  || "$PB" -c "Add :CFBundleIdentifier string com.promprit.flowobserve.open" "$PL"
"$PB" -c "Add :CFBundleURLTypes array" "$PL"
"$PB" -c "Add :CFBundleURLTypes:0 dict" "$PL"
"$PB" -c "Add :CFBundleURLTypes:0:CFBundleURLName string flowobserve" "$PL"
"$PB" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PL"
"$PB" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string flowobserve" "$PL"
"$PB" -c "Set :LSUIElement true" "$PL" 2>/dev/null || "$PB" -c "Add :LSUIElement bool true" "$PL"
codesign --force --sign - "$APP" 2>/dev/null || true  # plist edits invalidate the ad-hoc signature
if [ -z "${FO_SKIP_LSREGISTER-}" ]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
fi
