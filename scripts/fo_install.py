#!/usr/bin/python3
"""Wire flowobserve into ~/.claude on macOS and Windows (settings.json hooks + statusline, jev/chain.json) and render the launchd plist.

Edits are pure functions over parsed JSON; the CLI adds backup + atomic write. Our entries are found by MARKER,
so wire is idempotent and unwire removes only what wire added.
"""
import argparse
import copy
import difflib
import json
import os
import plistlib
import re
import secrets
import sys
import time

MARKER = "/.flowobserve/bin/fo_hook.py"
LABEL = "com.promprit.flowobserve"
SETTINGS_EVENTS = ("SessionStart", "SessionEnd", "PostToolUse", "PostToolUseFailure", "SubagentStart",
                   "SubagentStop", "Notification", "PermissionRequest", "Stop")
TOOL_EVENTS = ("PostToolUse", "PostToolUseFailure", "PermissionRequest")
CHAIN_KINDS = ("pretool", "prompt")
STAGE = "flowobserve"
WRAP_HEAD = "/bin/sh -c 'if [ -f \""
WRAP_TAIL = "fi' "


IS_WIN = os.name == "nt"
DEFAULT_PY = "/usr/bin/python3"


def _fwd(p):
    return p.replace("\\", "/")


def hook_command(hook, python=DEFAULT_PY, windows=IS_WIN):
    if windows:
        # No /bin/sh on Windows; the hook never prints and always exits 0 (windows spec §3.4).
        return '"%s" -X utf8 -S "%s"' % (_fwd(python), _fwd(hook))
    return "/bin/sh -c '%s -S \"%s\" >/dev/null 2>&1; exit 0'" % (python, hook)


def wrap_prefix(hook):
    # The original statusline command follows verbatim; the outer shell splits it into "$0" "$@".
    return (WRAP_HEAD + "%s\" ]; then exec /usr/bin/python3 -S \"%s\" --usage -- \"$0\" \"$@\"; "
            "else exec \"$0\" \"$@\"; " + WRAP_TAIL) % (hook, hook)


def _is_ours(h):
    return MARKER in _fwd(str(h.get("command", "")))


def _wrapped(cmd):
    return cmd.startswith(WRAP_HEAD) and WRAP_TAIL in cmd and MARKER in cmd.split(WRAP_TAIL, 1)[0]


def _simple(cmd):
    """True if cmd has no unquoted ; & | < > and does not start with NAME=value."""
    q = None
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if q == "'":
            if c == "'":
                q = None
        elif q == '"':
            if c == "\\":
                i += 1
            elif c == '"':
                q = None
        elif c == "\\":
            i += 1
        elif c in "'\"":
            q = c
        elif c in ";&|<>":
            return False
        i += 1
    first = cmd.split(None, 1)[0] if cmd.split() else ""
    name, eq, _ = first.partition("=")
    return not (eq and name.replace("_", "a").isalnum() and not name[0].isdigit())


def unwire_settings(d):
    d = copy.deepcopy(d)
    hooks = d.get("hooks", {})
    for ev in list(hooks):
        groups = []
        for g in hooks[ev]:
            inner = g.get("hooks", [])
            kept = [h for h in inner if not _is_ours(h)]
            if kept or not inner:
                groups.append(dict(g, hooks=kept) if inner else g)
        if groups:
            hooks[ev] = groups
        else:
            del hooks[ev]
    sl = d.get("statusLine")
    if isinstance(sl, dict) and isinstance(sl.get("command"), str) and _wrapped(sl["command"]):
        sl["command"] = sl["command"].split(WRAP_TAIL, 1)[1]
    return d


def wire_settings(d, hook, python=DEFAULT_PY, windows=IS_WIN):
    d = unwire_settings(d)
    hooks = d.setdefault("hooks", {})
    for ev in SETTINGS_EVENTS:
        group = {"hooks": [{"type": "command", "command": hook_command(hook, python, windows), "timeout": 2}]}
        if ev in TOOL_EVENTS:
            group = {"matcher": "*", **group}
        hooks.setdefault(ev, []).append(group)
    sl = d.get("statusLine")
    if not windows and isinstance(sl, dict) and isinstance(sl.get("command"), str) and sl["command"] and _simple(sl["command"]):
        sl["command"] = wrap_prefix(hook) + sl["command"]
    return d


def unwire_chain(d):
    d = copy.deepcopy(d)
    for kind in CHAIN_KINDS:
        if kind in d:
            d[kind] = [s for s in d[kind] if s.get("name") != STAGE]
    return d


def wire_chain(d, hook, python=DEFAULT_PY):
    d = unwire_chain(d)
    for kind in CHAIN_KINDS:
        d.setdefault(kind, []).append({"name": STAGE, "component": STAGE, "cmd": [python, "-S", hook], "timeout": 1, "observe": True})
    return d


def status(settings, chain, windows=IS_WIN):
    out = []
    hooks = settings.get("hooks", {})
    for ev in SETTINGS_EVENTS:
        n = sum(1 for g in hooks.get(ev, []) for h in g.get("hooks", []) if _is_ours(h))
        out.append("ok hook %s" % ev if n == 1 else "warn hook %s: %d entries" % (ev, n))
    for kind in CHAIN_KINDS:
        stages = chain.get(kind, [])
        last = stages[-1].get("name") if stages else None
        out.append("ok chain %s" % kind if last == STAGE else "warn chain %s: flowobserve not last" % kind)
        if any(s.get("name") == "claude-office" for s in stages):
            out.append("warn chain %s: claude-office stage still present" % kind)
    if windows:
        out.append("ok statusline: n/a (windows)")
        return out
    sl = settings.get("statusLine")
    cmd = sl.get("command", "") if isinstance(sl, dict) else ""
    if isinstance(cmd, str) and _wrapped(cmd):
        out.append("ok statusline")
    elif isinstance(cmd, str) and cmd and not _simple(cmd):
        out.append("warn statusline: not a simple command")
    else:
        out.append("warn statusline: not wrapped")
    return out


def render_plist(node, repo, home, projects_root=None, edition=None, disks=None):
    main = os.path.join(repo, "server", "dist", "main.js")
    log = os.path.join(home, "server.log")
    env = {"FO_HOME": home, "FO_PORT": "4317", "NODE_ENV": "production"}
    if projects_root:
        env["FO_PROJECTS_ROOT"] = projects_root
    if edition:
        env["FO_EDITION"] = edition
    if disks:
        env["FO_DISKS"] = disks
    return plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": [node, "--disable-warning=ExperimentalWarning", main],
        "WorkingDirectory": os.path.join(repo, "server"),
        "RunAtLoad": True,
        "KeepAlive": {"PathState": {main: True}},
        "EnvironmentVariables": env,
        "StandardOutPath": log,
        "StandardErrorPath": log,
    })


def write_helper_json(home, root):
    """Write home/helper.json {root, token, createRoots} atomically, mode 0600; keep an existing valid 64-hex token."""
    if not os.path.isabs(root):
        raise ValueError("root must be an absolute path: %s" % root)
    if not os.path.isdir(root):
        raise ValueError("root is not a directory: %s" % root)
    path = os.path.join(home, "helper.json")
    token = None
    try:
        old = read_json(path).get("token")
        if isinstance(old, str) and re.fullmatch(r"[0-9a-f]{64}", old):
            token = old
    except (OSError, ValueError):
        pass
    if token is None:
        token = secrets.token_hex(32)
    roots = []
    try:
        old_roots = read_json(path).get("createRoots")
        if isinstance(old_roots, list):
            roots = [r for r in old_roots if isinstance(r, dict) and isinstance(r.get("label"), str)]
    except (OSError, ValueError):
        pass
    roots = [r for r in roots if r["label"] != "projects"]
    roots.append({"label": "projects", "path": root})
    parent = os.path.dirname(root)
    if (os.path.basename(root) == "projects" and os.path.isdir(parent)
            and not any(r["label"] == "Dev" for r in roots)):
        roots.append({"label": "Dev", "path": parent})
    os.makedirs(home, exist_ok=True)
    tmp = path + ".fo-tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps({"root": root, "token": token, "createRoots": roots}, indent=2) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def helper_root(home):
    """Root recorded in home/helper.json if it is an absolute existing directory, else None."""
    try:
        root = read_json(os.path.join(home, "helper.json")).get("root")
    except (OSError, ValueError):
        return None
    if isinstance(root, str) and os.path.isabs(root) and os.path.isdir(root):
        return root
    return None


def read_json(path):
    with open(path, encoding="utf-8-sig") as f:
        v = json.load(f)
    if not isinstance(v, dict):
        raise ValueError("top level is not an object")
    return v


def render(d):
    return json.dumps(d, indent=2, ensure_ascii=False) + "\n"


def render_chain(d):
    """chain.json layout: one stage object per line, as hand-written in ~/.claude/jev."""
    parts = []
    for k, v in d.items():
        key = json.dumps(k, ensure_ascii=False)
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
            rows = ",\n".join("    " + json.dumps(x, ensure_ascii=False) for x in v)
            parts.append("  %s: [\n%s\n  ]" % (key, rows))
        else:
            parts.append("  %s: %s" % (key, json.dumps(v, ensure_ascii=False)))
    return "{\n" + ",\n".join(parts) + "\n}\n" if parts else "{}\n"


def write_json(path, d, now, renderer=render):
    if read_json(path) == d:
        return False
    st = os.stat(path)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now))
    bak = "%s.bak-fo-%s" % (path, stamp)
    fd = os.open(bak, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, st.st_mode & 0o777)
    with open(path, "rb") as src, os.fdopen(fd, "wb") as dst:
        dst.write(src.read())
    os.chmod(bak, st.st_mode & 0o777)
    tmp = path + ".fo-tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(renderer(d))
    os.chmod(tmp, st.st_mode & 0o777)
    os.replace(tmp, path)
    return True


def main(argv):
    ap = argparse.ArgumentParser(prog="fo_install.py")
    ap.add_argument("cmd", choices=["wire", "unwire", "status", "plist", "helper-json", "helper-root", "plist-edition", "plist-disks"])
    ap.add_argument("--claude-dir", default=os.path.expanduser("~/.claude"))
    ap.add_argument("--hook", default=os.path.expanduser("~/.flowobserve/bin/fo_hook.py"))
    ap.add_argument("--python", default=sys.executable if IS_WIN else DEFAULT_PY)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--node")
    ap.add_argument("--repo")
    ap.add_argument("--home")
    ap.add_argument("--projects-root")
    ap.add_argument("--root")
    ap.add_argument("--edition")
    ap.add_argument("--plist")
    ap.add_argument("--disks")
    a = ap.parse_args(argv)
    if a.cmd == "plist":
        sys.stdout.write(render_plist(a.node, a.repo, a.home, a.projects_root, a.edition, a.disks).decode("utf-8"))
        return 0
    if a.cmd == "plist-edition":
        try:
            with open(a.plist, "rb") as f:
                v = plistlib.load(f).get("EnvironmentVariables", {}).get("FO_EDITION")
        except Exception:
            v = None
        if v in ("vscode", "iterm", "both"):
            sys.stdout.write(v + "\n")
        return 0
    if a.cmd == "plist-disks":
        try:
            with open(a.plist, "rb") as f:
                v = plistlib.load(f).get("EnvironmentVariables", {}).get("FO_DISKS")
        except Exception:
            v = None
        if isinstance(v, str) and v and "\n" not in v:
            sys.stdout.write(v + "\n")
        return 0
    if a.cmd == "helper-root":
        root = helper_root(a.home)
        if root:
            sys.stdout.write(root + "\n")
        return 0
    if a.cmd == "helper-json":
        try:
            write_helper_json(a.home, a.root)
        except (OSError, ValueError, TypeError) as e:
            sys.stderr.write("fo_install: helper-json: %s\n" % e)
            return 1
        return 0
    sp = os.path.join(a.claude_dir, "settings.json")
    cp = os.path.join(a.claude_dir, "jev", "chain.json")
    try:
        s, c = read_json(sp), None
    except (OSError, ValueError) as e:
        sys.stderr.write("fo_install: cannot read %s: %s\n" % (sp, e))
        return 1
    try:
        c = read_json(cp)
    except (OSError, ValueError) as e:
        sys.stderr.write("fo_install: cannot read %s: %s\n" % (cp, e))
        return 1
    if a.cmd == "status":
        sys.stdout.write("\n".join(status(s, c)) + "\n")
        return 0
    wiring = a.cmd == "wire"
    try:
        new_s = wire_settings(s, a.hook, a.python) if wiring else unwire_settings(s)
    except (AttributeError, TypeError, ValueError) as e:
        sys.stderr.write("fo_install: cannot %s %s: %s\n" % (a.cmd, sp, e))
        return 1
    try:
        new_c = wire_chain(c, a.hook, a.python) if wiring else unwire_chain(c)
    except (AttributeError, TypeError, ValueError) as e:
        sys.stderr.write("fo_install: cannot %s %s: %s\n" % (a.cmd, cp, e))
        return 1
    if a.dry_run:
        out = []
        for path, old, new, rend in ((sp, s, new_s, render), (cp, c, new_c, render_chain)):
            if old != new:
                with open(path, encoding="utf-8") as f:
                    before = f.read()
                out.extend(difflib.unified_diff(before.splitlines(True), rend(new).splitlines(True),
                                                "a/" + path, "b/" + path))
        sys.stdout.write("".join(out) if out else "no changes\n")
        return 0
    now = time.time()
    write_json(sp, new_s, now)
    write_json(cp, new_c, now, render_chain)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
