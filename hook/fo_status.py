#!/usr/bin/python3
"""Minimal Claude Code statusline: "<model> · 5h <N>%". Installed only when a config dir has no statusLine, so the
flowobserve wrapper around it can read the account's plan limits. Stdlib only; any problem prints "claude"."""
import json
import sys


def line(raw):
    d = json.loads(raw)
    out = str(d["model"]["display_name"])
    rl = d.get("rate_limits")
    fh = rl.get("five_hour") if isinstance(rl, dict) else None
    pct = fh.get("used_percentage") if isinstance(fh, dict) else None
    if isinstance(pct, (int, float)) and not isinstance(pct, bool):
        out += " · 5h %d%%" % round(pct)
    return out


def main():
    try:
        out = line(sys.stdin.buffer.read().decode("utf-8"))
    except Exception:
        out = "claude"
    sys.stdout.buffer.write((out + "\n").encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
