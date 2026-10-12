#!/usr/bin/python3
"""Wire flowobserve into a Claude config dir on macOS and Windows (settings.json hooks + statusline, jev/chain.json when Dryas is there) and render the launchd plist.

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
STATUS_MARKER = "fo_status.py"
STAGE = "flowobserve"
WRAP_HEAD = "/bin/sh -c 'if [ -f \""
WRAP_TAIL = "fi' "


IS_WIN = os.name == "nt"
DEFAULT_PY = "/usr/bin/python3"


def _fwd(p):
    return p.replace("\\", "/")


UNSAFE_ACCT = re.compile(r"[\"'$`\\\x00-\x1f]")


def _acct_env(acct):
    """FO_ACCT="<acct>" for a POSIX command line; the value sits in double quotes inside the single-quoted sh -c script."""
    if UNSAFE_ACCT.search(acct):
        raise ValueError("unsupported characters in claude dir: %r" % acct)
    return 'FO_ACCT="%s"' % acct


def hook_command(hook, python=DEFAULT_PY, windows=IS_WIN, acct=None):
    if windows:
        # No /bin/sh on Windows; the hook never prints and always exits 0 (windows spec §3.4). Windows keeps the default account.
        return '"%s" -X utf8 -S "%s"' % (_fwd(python), _fwd(hook))
    env = "" if acct is None else _acct_env(acct) + " "
    return "/bin/sh -c '" + env + python + " -S \"" + hook + "\" >/dev/null 2>&1; exit 0'"


def wrap_prefix(hook, acct=None):
    # The original statusline command follows verbatim; the outer shell splits it into "$0" "$@".
    run = "exec /usr/bin/python3" if acct is None else "exec /usr/bin/env " + _acct_env(acct) + " /usr/bin/python3"
    return (WRAP_HEAD + hook + "\" ]; then " + run + " -S \"" + hook + "\" --usage -- \"$0\" \"$@\"; "
            "else exec \"$0\" \"$@\"; " + WRAP_TAIL)


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
    if isinstance(sl, dict) and isinstance(sl.get("command"), str) and "/bin/" + STATUS_MARKER in sl["command"]:
        del d["statusLine"]  # the one we added: the user had none before
    return d


def wire_settings(d, hook, python=DEFAULT_PY, windows=IS_WIN, acct=None):
    d = unwire_settings(d)
    hooks = d.setdefault("hooks", {})
    for ev in SETTINGS_EVENTS:
        group = {"hooks": [{"type": "command", "command": hook_command(hook, python, windows, acct), "timeout": 2}]}
        if ev in TOOL_EVENTS:
            group = {"matcher": "*", **group}
        hooks.setdefault(ev, []).append(group)
    if windows:
        return d
    if "statusLine" not in d:
        status_py = os.path.join(os.path.dirname(hook), STATUS_MARKER)
        d["statusLine"] = {"type": "command", "command": wrap_prefix(hook, acct) + DEFAULT_PY + ' -S "' + status_py + '"'}
        return d
    sl = d.get("statusLine")
    if isinstance(sl, dict) and isinstance(sl.get("command"), str) and sl["command"] and _simple(sl["command"]):
        sl["command"] = wrap_prefix(hook, acct) + sl["command"]
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
    if chain is None:
        out.append("info chain: none (no Dryas in this dir)")
    else:
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
    if isinstance(cmd, str) and _wrapped(cmd) and STATUS_MARKER in cmd.split(WRAP_TAIL, 1)[1]:
        out.append("info statusline: added by flowobserve")
    elif isinstance(cmd, str) and _wrapped(cmd):
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


DEFAULT_ACCT = "~/.claude"
ACCOUNTS = "accounts.json"
MAX_LABEL = 32


def acct_of_dir(d):
    """Account key of a config dir, as the hook writes it: absolute, normalized, home prefix as ~ (no user name)."""
    p = os.path.abspath(os.path.expanduser(d))
    home = os.path.abspath(os.path.expanduser("~"))
    if p == home or p.startswith(home + os.sep):
        p = "~" + p[len(home):].replace(os.sep, "/")
    return p


def acct_tag(claude_dir):
    """FO_ACCT for a dir's wired commands; None for the default ~/.claude (the hook defaults to it)."""
    acct = acct_of_dir(claude_dir)
    return None if acct == DEFAULT_ACCT else acct


def default_label(acct):
    base = acct.rstrip("/").rsplit("/", 1)[-1]
    base = base[1:] if base.startswith(".") else base
    return (base if base and base != "~" else "claude")[:MAX_LABEL]


def _check_label(label):
    s = label.strip()
    if not 1 <= len(s) <= MAX_LABEL or not s.isprintable():
        raise ValueError("label must be 1-%d printable characters: %r" % (MAX_LABEL, label))
    return s


def add_account(d, acct, label, seed_default=False):
    """accounts.json with acct added at the end (or its label updated in place). Re-adding without a label keeps the label."""
    label = None if label is None else _check_label(label)
    rows = [dict(r) for r in d.get("accounts", [])]
    if seed_default and not rows and acct != DEFAULT_ACCT:
        rows.append({"dir": DEFAULT_ACCT, "label": default_label(DEFAULT_ACCT)})
    for r in rows:
        if r.get("dir") == acct:
            if label is not None:
                r["label"] = label
            return dict(d, accounts=rows)
    rows.append({"dir": acct, "label": label if label is not None else default_label(acct)})
    return dict(d, accounts=rows)


def remove_account(d, acct):
    return dict(d, accounts=[dict(r) for r in d.get("accounts", []) if r.get("dir") != acct])


def read_accounts(path):
    """Parsed accounts.json; a missing file is an empty list. A file that is not {"accounts": [{dir, ...}]} is an error."""
    if not os.path.exists(path):
        return {"accounts": []}
    d = read_json(path)
    rows = d.get("accounts")
    if not isinstance(rows, list) or not all(isinstance(r, dict) and isinstance(r.get("dir"), str) for r in rows):
        raise ValueError("%s: accounts must be a list of {dir, label}" % path)
    return d


def write_accounts(path, d):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".fo-tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(render(d))
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


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
    ap.add_argument("cmd", choices=["wire", "unwire", "status", "plist", "helper-json", "helper-root", "plist-edition", "plist-disks", "account"])
    ap.add_argument("sub", nargs="?", choices=["add", "remove", "list"])
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
    ap.add_argument("--label")
    a = ap.parse_args(argv)
    if a.cmd == "account":
        if a.sub is None:
            ap.error("account needs add or remove")
        home = a.home or os.environ.get("FO_HOME") or os.path.expanduser("~/.flowobserve")
        path = os.path.join(home, ACCOUNTS)
        acct = acct_of_dir(a.claude_dir)
        if a.sub == "list":
            try:
                rows = read_accounts(path)["accounts"]
            except (OSError, ValueError) as e:
                sys.stderr.write("fo_install: account list (%s): %s\n" % (ACCOUNTS, e))
                return 1
            for r in rows:
                sys.stdout.write(r["dir"] + "\n")
            return 0
        try:
            existed = os.path.exists(path)
            d = read_accounts(path)
            if a.sub == "add":
                seed = not existed and os.path.isdir(os.path.expanduser(DEFAULT_ACCT))
                write_accounts(path, add_account(d, acct, a.label, seed))
            else:
                # Removing from a missing or unchanged file writes nothing, so a later add still seeds ~/.claude.
                d2 = remove_account(d, acct)
                if d2 != d:
                    write_accounts(path, d2)
        except (OSError, ValueError) as e:
            sys.stderr.write("fo_install: account %s (%s): %s\n" % (a.sub, ACCOUNTS, e))
            return 1
        sys.stdout.write("account %s: %s\n" % (a.sub, acct))
        return 0
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
        s = read_json(sp)
    except (OSError, ValueError) as e:
        sys.stderr.write("fo_install: cannot read %s: %s\n" % (sp, e))
        return 1
    c = None
    if os.path.lexists(cp):  # no chain file = a plain config dir without Dryas: settings.json only
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
        new_s = wire_settings(s, a.hook, a.python, acct=acct_tag(a.claude_dir)) if wiring else unwire_settings(s)
    except (AttributeError, TypeError, ValueError) as e:
        sys.stderr.write("fo_install: cannot %s %s: %s\n" % (a.cmd, sp, e))
        return 1
    new_c = None
    if c is not None:
        try:
            new_c = wire_chain(c, a.hook, a.python) if wiring else unwire_chain(c)
        except (AttributeError, TypeError, ValueError) as e:
            sys.stderr.write("fo_install: cannot %s %s: %s\n" % (a.cmd, cp, e))
            return 1
    files = [(sp, s, new_s, render)] + ([(cp, c, new_c, render_chain)] if c is not None else [])
    if a.dry_run:
        out = []
        for path, old, new, rend in files:
            if old != new:
                with open(path, encoding="utf-8") as f:
                    before = f.read()
                out.extend(difflib.unified_diff(before.splitlines(True), rend(new).splitlines(True),
                                                "a/" + path, "b/" + path))
        sys.stdout.write("".join(out) if out else "no changes\n")
        return 0
    now = time.time()
    for path, _old, new, rend in files:
        write_json(path, new, now, rend)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
