#!/usr/bin/env python3
"""cl: start claude in the Claude account that fits (multi-account spec §9). Stdlib only.

Order: --team/--pro/--account, then a resumed session's own account (server, else a transcript on disk), then the
longest matching rule in accounts.json, then for -c/--continue/bare --resume the account with the newest transcript
for this folder (no usage step), then flowobserve's use (GET /api/usage): the first account, unless it is near a 5h or weekly
limit, then the other account with the lowest 5h use that is not near one, else the first.
"""
import glob
import json
import os
import re
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


def continues(args):
    """-c / --continue, or --resume / -r without an id: pick the conversation, not by usage."""
    for i, a in enumerate(args):
        if a == "--":
            break
        if a in ("-c", "--continue"):
            return True
        if a in ("--resume", "-r") and not (i + 1 < len(args) and not args[i + 1].startswith("-")):
            return True
    return False


def project_dir_name(cwd):
    """Claude Code's project dir name: the cwd with every non-alphanumeric character as '-'."""
    return re.sub(r"[^A-Za-z0-9]", "-", cwd)


def newest_transcript(adir, cwd):
    """mtime of the newest *.jsonl in <adir>/projects/<cwd project dir>/, or None."""
    best = None
    for c in {cwd, os.path.realpath(cwd)}:
        for f in glob.glob(os.path.join(glob.escape(adir), "projects", project_dir_name(c), "*.jsonl")):
            try:
                m = os.path.getmtime(f)
            except OSError:
                continue
            if best is None or m > best:
                best = m
    return best


def rule_for(cwd, rules, env):
    """Longest rule path that is cwd or a parent of it (both compared by realpath)."""
    cwd = os.path.normcase(os.path.realpath(cwd))
    best = None
    for r in rules:
        p = os.path.normcase(os.path.realpath(expand(r["path"].rstrip("/") or r["path"], env)))
        if (cwd == p or cwd.startswith(p.rstrip(os.sep) + os.sep)) and (best is None or len(p) > best[0]):
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


def decide(argv, env, cwd, fetch, warn=lambda m: None):
    label, dry, rest = parse_args(argv)
    loaded = load(env)
    if loaded is None:
        if label is not None:
            raise Usage("no accounts file: run install.sh for each config dir first")
        return {"dir": DEFAULT_ACCT, "label": "claude"}, "cl → claude (no accounts file)", rest, dry
    accounts, rules = loaded
    default = accounts[0]

    def by_dir(d):
        return next((a for a in accounts if expand(a["dir"], env) == expand(d.rstrip("/") or d, env)), None)

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
        a = None
        if isinstance(s, dict):
            a = by_dir(s["dir"]) if isinstance(s.get("dir"), str) and s["dir"] else None
            a = a or (by_label(s["label"]) if isinstance(s.get("label"), str) else None)
        if a:
            return a, "cl → %s (resume: the session's account)" % a["label"], rest, dry
        for x in accounts:
            if glob.glob(os.path.join(glob.escape(expand(x["dir"], env)), "projects", "*", glob.escape(sid) + ".jsonl")):
                return x, "cl → %s (resume: found the transcript)" % x["label"], rest, dry
    r = rule_for(cwd, rules, env)
    if r:
        a = by_label(r["label"])
        if a:
            return a, "cl → %s (rule %s)" % (a["label"], r["path"]), rest, dry
        warn("cl: rule %s names unknown account %s" % (r["path"], r["label"]))
    if continues(rest):
        seen = [(newest_transcript(expand(x["dir"], env), cwd), x) for x in accounts]
        seen = [(m, x) for m, x in seen if m is not None]
        if seen:
            x = max(seen, key=lambda t: t[0])[1]
            return x, "cl → %s (continue: latest conversation here)" % x["label"], rest, dry
        return default, "cl → %s (continue: no conversation here, default account)" % default["label"], rest, dry
    u = fetch(base)
    if not isinstance(u, dict) or not isinstance(u.get("accounts"), list):
        return default, "cl → %s (flowobserve not reachable)" % default["label"], rest, dry
    at = u.get("switchAt") if isinstance(u.get("switchAt"), (int, float)) else SWITCH_AT
    rows = {x.get("dir"): x for x in u["accounts"] if isinstance(x, dict)}

    def num(a, k):
        v = rows.get(a["dir"], {}).get(k)
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def used(a):
        return num(a, "fiveHour")

    def others(a):
        return " · ".join("%s %s" % (x["label"], pct(used(x))) for x in accounts if x is not a)

    def near(a):
        return any(v is not None and v >= at for v in (used(a), num(a, "sevenDay")))

    du, dw = used(default), num(default, "sevenDay")
    if not near(default):
        return default, "cl → %s (5h %s%s)" % (default["label"], pct(du), (" · " + others(default)) if len(accounts) > 1 else ""), rest, dry
    calm = sorted((a for a in accounts if a is not default and used(a) is not None and not near(a)), key=used)
    if calm:
        why = "5h %s" % pct(du) if du is not None and du >= at else "week %s" % pct(dw)
        return calm[0], "cl → %s (%s %s)" % (calm[0]["label"], default["label"], why), rest, dry
    return default, "cl → %s (all accounts near a limit: 5h %s · %s)" % (default["label"], pct(du), others(default)), rest, dry


def main(argv, env=None, cwd=None, fetch=fetch_json, execvpe=os.execvpe, out=sys.stdout, err=sys.stderr):
    env = dict(os.environ if env is None else env)
    cwd = os.path.abspath(cwd or os.getcwd())
    try:
        a, line, rest, dry = decide(argv, env, cwd, fetch, lambda m: err.write(m + "\n"))
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
