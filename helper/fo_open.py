#!/usr/bin/python3
"""flowobserve:// helper: validate a link from the board, then drive iTerm2. Python stdlib only.

Security boundary. The token is checked before anything else; every parameter is matched by a
strict rule; nothing runs through a shell (argv lists only); AppleScript sees arguments only via
`item n of argv`. main() always returns 0 and never raises.
"""
import base64, binascii, colorsys, hmac, json, os, re, shlex, subprocess, sys, time, urllib.parse
from collections import namedtuple

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))  # `python3 -I` leaves the script dir off sys.path
import fo_iterm  # noqa: E402

class Rejected(Exception):
    pass

STEP_TEXT = {"handoff": "/handoff", "clear": "/clear", "resume": "Continue from the handoff"}
COMMANDS = {"open": {"path", "resume", "wt", "root", "c"}, "run": {"path", "root", "c"}, "jump": {"iterm"},
            "step": {"iterm", "do"}, "diff": {"path", "root", "c"}, "new": {"root", "name"}}
C_RE = re.compile(r"[0-9a-f]{6}")
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
NO_GIT = "git init failed — folder kept"
INSIDE_REPO = "Link rejected — inside a repo"
DIFF_BASE = ('d=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null); d=${d#origin/}; '
             'git rev-parse -q --verify "refs/heads/$d" >/dev/null 2>&1 || d=main; '
             'git rev-parse -q --verify "refs/heads/$d" >/dev/null 2>&1 || d=master')
NO_BASE = "flowobserve: no base branch (origin/HEAD, main, master) — showing uncommitted changes"
DIFF_TAIL = (DIFF_BASE + '; { base=$(git merge-base HEAD "$d" 2>/dev/null) || { echo "%s"; base=HEAD; }; '
             'git status --short; git diff --stat "$base"; git diff --color=always "$base"; } 2>&1 | less -R; exit' % NO_BASE)
UUID_RE = re.compile(r"[0-9a-fA-F-]{36}")
ITERM_RE = re.compile(r"w[0-9]+t[0-9]+p[0-9]+:([0-9A-Fa-f-]{36})")
TOKEN_RE = re.compile(r"[0-9a-fA-F]{64}")
HEX_RE = re.compile(r"#[0-9A-Fa-f]{6}")
URL_RE = re.compile(r"http://(localhost|127\.0\.0\.1):[0-9]{2,5}(/\S*)?")
BADGE_RE = re.compile(r"[A-Za-z0-9._ -]{1,64}")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")
MAX_RESUME = 12
DEFAULT_BG = (0, 0, 0)  # iTerm2 default profile background
TINT = 0.08

BAD_TOKEN = "Link not from your flowobserve board — ignored"
NO_CONFIG = "Run scripts/install.sh with FO_PROJECTS_ROOT set"
NO_ITERM = "Install iTerm2 to open sessions here"
GONE = "Session closed — Restore it from Open"

def parse(url):
    """("cmd", {param: value}) for a well-formed flowobserve:// link; the token `t` is not returned."""
    try:
        u = urllib.parse.urlsplit(url)
        pairs = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
    except (ValueError, TypeError):
        raise Rejected("Link rejected — malformed")
    if u.scheme != "flowobserve" or u.netloc not in COMMANDS or u.path not in ("", "/") or u.fragment:
        raise Rejected("Link rejected — unknown command")
    args = {}
    for k, v in pairs:
        if k in args or (k != "t" and k not in COMMANDS[u.netloc]):
            raise Rejected("Link rejected — bad parameter")
        args[k] = v
    args.pop("t", None)
    return u.netloc, args

def resolve_path(root, rel):
    """Real path of an existing directory strictly inside root."""
    if not isinstance(rel, str) or not rel or len(rel) > 1024 or CONTROL_RE.search(rel) \
            or rel.startswith("/") or ".." in rel.split("/"):
        raise Rejected("Link rejected — bad path")
    base = os.path.realpath(root)
    full = os.path.realpath(os.path.join(base, rel))
    if not full.startswith(base + "/"):
        raise Rejected("Link rejected — path outside your projects folder")
    if not os.path.isdir(full):
        raise Rejected("%s not found — SSD mounted?" % os.path.basename(rel.rstrip("/")))
    return full

def parse_resume(v):
    ids = [] if v is None else v.split(",")
    if len(ids) > MAX_RESUME or not all(UUID_RE.fullmatch(i) for i in ids):
        raise Rejected("Link rejected — bad session ids")
    return ids

def parse_iterm(v):
    if not (m := ITERM_RE.fullmatch(v) if isinstance(v, str) else None):
        raise Rejected("Link rejected — bad iTerm2 session")
    return m.group(1)

def check_token(given, expected):
    ok = isinstance(given, str) and isinstance(expected, str) and TOKEN_RE.fullmatch(expected) is not None
    if not ok or not hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
        raise Rejected(BAD_TOKEN)

def _read_json(path, limit=256 * 1024):
    try:
        with open(path, "rb") as f:
            return json.loads(f.read(limit).decode("utf-8"))
    except (OSError, ValueError):
        return None

def run_spec(project_dir):
    """(argv, url or None) from .flowobserve/run, else package.json `dev`; None when there is none."""
    explicit = os.path.join(project_dir, ".flowobserve", "run")
    if os.path.isfile(explicit):
        spec = _read_json(explicit)
        cmd = spec.get("cmd") if isinstance(spec, dict) else None
        if not isinstance(cmd, list) or not cmd or not all(isinstance(c, str) and c for c in cmd):
            return None
        url = spec.get("url")
        return list(cmd), url if isinstance(url, str) and URL_RE.fullmatch(url) else None
    pkg = _read_json(os.path.join(project_dir, "package.json"))
    scripts = pkg.get("scripts") if isinstance(pkg, dict) else None
    for lock, cmd in (("pnpm-lock.yaml", ["pnpm", "dev"]), ("package-lock.json", ["npm", "run", "dev"])):
        if isinstance(scripts, dict) and isinstance(scripts.get("dev"), str) and os.path.exists(os.path.join(project_dir, lock)):
            return cmd, None
    return None

STR = r'("(?:[^"\\\n]|\\.)*")'  # a JSON string: matched first so markers inside it are kept
JSONC_COMMENT = re.compile(STR + r"|//[^\n]*|/\*[\s\S]*?(?:\*/|\Z)")
JSONC_COMMA = re.compile(STR + r"|,(\s*[}\]])")

def strip_jsonc(s):
    """Drop // and /* */ comments and trailing commas outside JSON strings."""
    s = JSONC_COMMENT.sub(lambda m: m.group(1) or "", s)
    return JSONC_COMMA.sub(lambda m: m.group(1) or m.group(2), s)

def peacock(project_dir):
    """`peacock.color` from .vscode/settings.json (JSON with comments), or None."""
    try:
        with open(os.path.join(project_dir, ".vscode", "settings.json"), encoding="utf-8") as f:
            s = f.read(256 * 1024)
    except (OSError, ValueError):
        return None
    try:
        c = json.loads(strip_jsonc(s)).get("peacock.color")
    except (ValueError, AttributeError):
        return None
    return c if isinstance(c, str) and HEX_RE.fullmatch(c) else None

def name_color(name):
    """FNV-1a 32 over UTF-8 -> hue -> hsl(hue, 55%, 62%) as #rrggbb (same as server nameColor)."""
    h = 0x811C9DC5
    for b in name.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, 0.62, 0.55)
    return "#%02x%02x%02x" % tuple(int(round(x * 255)) for x in (r, g, b))

def colour(project_dir, name, group_dir=None):
    """Project Peacock, else its group's Peacock, else the name colour (server projects.ts rules)."""
    return peacock(project_dir) or (group_dir and peacock(group_dir)) or name_color(name)

def _project(d, base):
    """Nearest folder from d up to (not including) base holding a .git directory (worktrees hold a
    .git file), and its group: a top-level parent without .git. Falls back to d itself."""
    p = d
    while p.startswith(base + "/") and not os.path.isdir(os.path.join(p, ".git")):
        p = os.path.dirname(p)
    p = p if p.startswith(base + "/") else d
    g = os.path.dirname(p)
    return p, g if os.path.dirname(g) == base and not os.path.exists(os.path.join(g, ".git")) else None

def _rgb(hexc):
    return tuple(int(hexc[i:i + 2], 16) for i in (1, 3, 5))

def _b64(s):
    return base64.b64encode(s.encode("utf-8")).decode("ascii")

# Display name (user.fo_name) over the fo-iterm mod's status (user.fo_badge). user.fo_project is the hex tab key; never set it here.
BADGE_FORMAT = _b64("\\(user.fo_name)\n\\(user.fo_badge)")

def _shell(d, tail, rgb, badge):
    """Tab colour and badge escapes, then cd into the folder and run tail."""
    fmt = "\\033]6;1;bg;red;brightness;%d\\a\\033]6;1;bg;green;brightness;%d\\a\\033]6;1;bg;blue;brightness;%d\\a" % rgb
    pre = "printf '%s' && " % fmt
    if badge:
        pre = "printf '%s\\033]1337;SetUserVar=fo_name=%%s\\a\\033]1337;SetBadgeFormat=%%s\\a' %s %s && " % (
            fmt, shlex.quote(_b64(badge)), shlex.quote(BADGE_FORMAT))
    return "%scd %s && %s" % (pre, shlex.quote(d), tail)

def _folder(root, rel, label="projects", pick=None):
    d = resolve_path(root, rel)
    name, (proj, group) = os.path.basename(d), _project(d, os.path.realpath(root))
    rgb = _rgb("#" + pick) if pick and C_RE.fullmatch(pick) else _rgb(colour(proj, os.path.basename(proj), group))
    tint = tuple(int(round((bg + (c - bg) * TINT) * 257)) for bg, c in zip(DEFAULT_BG, rgb))
    return d, rgb, tint, name if BADGE_RE.fullmatch(name) else None, project_key(root, d, label)

Tab = namedtuple("Tab", "win first n tags")
WIN_RE = re.compile(r"[0-9]{1,12}")
KEY_RE = re.compile(r"[0-9a-f]{1,8192}")

def project_key(root, d, label="projects"):
    """Project folder of d relative to root, hex-encoded so any folder name survives the iTerm2 tag and the
    listing's separators: worktrees count with their main folder; a group-folder repo is its own."""
    base = os.path.realpath(root)
    rel = os.path.relpath(_project(d, base)[0], base)
    return binascii.hexlify((rel if label == "projects" else "%s:%s" % (label, rel)).encode("utf-8")).decode("ascii")

def parse_listing(text):
    """(current window id or None, [Tab]) from LIST_SCRIPT output; malformed lines are skipped."""
    cur, tabs = None, []
    for line in (text or "").splitlines():
        f = line.split("\t")
        if f[0] == "C" and len(f) == 2:
            cur = f[1] if WIN_RE.fullmatch(f[1]) else None
        elif f[0] == "T" and len(f) == 5 and WIN_RE.fullmatch(f[1]) and UUID_RE.fullmatch(f[2]) and f[3].isdigit():
            tags = [tuple(x.rsplit(":", 1)) for x in f[4].split("|") if ":" in x]
            tabs.append(Tab(f[1], f[2], int(f[3]), [(k, kd) for k, kd in tags if KEY_RE.fullmatch(k)]))
    return cur, tabs

def place(cur, tabs, key):
    """Spec §8: the project's last listed tab (split while < 4), else a new tab; untagged and diff-only tabs never count."""
    mine = [t for t in tabs if any(k == key and kd != "diff" for k, kd in t.tags)]
    if mine:
        t = mine[-1]
        return ("split", t.first) if t.n < 4 else ("tab", t.win)
    return ("tab", cur) if cur else ("window",)

def _open_placed(osascript, shell, tint, key, kind):
    try:
        listing = osascript(fo_iterm.LIST_SCRIPT, [])
    except (subprocess.SubprocessError, OSError) as e:  # placement is best-effort: a failed listing opens a new window
        if _is_no_iterm(e):
            raise
        listing = ""
    cur, tabs = parse_listing(listing)
    p = place(cur, tabs, key)
    return osascript(fo_iterm.OPEN_SCRIPT, [shell, *[str(x) for x in tint], p[0], p[1] if len(p) > 1 else "", key, kind])

def _need(args, key):
    if key not in args:
        raise Rejected("Link rejected — missing %s" % key)
    return args[key]

def _git(argv):
    return subprocess.run(argv, capture_output=True, text=True, timeout=20, check=False)

def check_root_exists(label, path):
    if not os.path.isdir(path):
        raise Rejected("%s not found — SSD mounted?" % label)
    return os.path.realpath(path)

def create_project(parent, name, git=_git):
    """mkdir parent/name, then git init in it. Never removes or overwrites; a failed init keeps the folder."""
    target = os.path.join(parent, name)
    if os.path.lexists(target):
        return False, "Folder already exists"
    try:
        os.mkdir(target)
    except FileExistsError:
        return False, "Folder already exists"
    except OSError as e:
        return False, "Couldn't create folder: %s" % (e.strerror or "error")
    return git_init(target, git)

def git_init(target, git=_git):
    """git init in an existing folder; (ok, error). Never removes, overwrites or moves anything."""
    try:
        r = git(["git", "-C", target, "init", "-q"])
    except FileNotFoundError:
        return False, NO_GIT + " (git not installed)"
    except Exception:
        return False, NO_GIT
    if r.returncode != 0:
        first = (r.stderr or "").strip().splitlines()[:1]
        return False, NO_GIT + ": " + (first[0] if first else "git exited %d" % r.returncode)
    return True, None

def needs_init(base, rel, d):
    """True when an open of d must git init it first. Raises Rejected for a path through a .git folder
    or inside an existing repo (a .git entry in any folder below base, up to d), or holding a repo below d."""
    if os.path.lexists(os.path.join(d, ".git")):
        return False
    base = os.path.realpath(base)
    if any(c.lower() == ".git" for c in rel.split("/") + os.path.relpath(d, base).split("/")):
        raise Rejected(INSIDE_REPO)
    p = os.path.dirname(d)
    while p.startswith(base + "/"):
        if os.path.lexists(os.path.join(p, ".git")):
            raise Rejected(INSIDE_REPO)
        p = os.path.dirname(p)
    if _repo_below(d, 3):
        raise Rejected(INSIDE_REPO)
    return True

def _repo_below(d, depth):
    """True when a folder up to depth levels below d (not hidden, not _-prefixed, not a symlink) has .git."""
    try:
        subs = [e.path for e in os.scandir(d) if e.is_dir(follow_symlinks=False) and e.name[:1] not in "._"]
    except OSError:
        return False
    return any(os.path.lexists(os.path.join(s, ".git")) or (depth > 1 and _repo_below(s, depth - 1)) for s in subs)

def plan(cmd, args, root, roots=None):
    """Pure: validated link -> list of actions. Raises Rejected."""
    if cmd == "open":
        d, rgb, tint, badge, key = _folder(_base(args, root, roots), _need(args, "path"), args.get("root", "projects"), args.get("c"))
        if "wt" in args:
            if args["wt"] != "1" or "resume" in args:
                raise Rejected("Link rejected — bad parameter")
            if not os.path.isdir(os.path.join(d, ".git")):
                raise Rejected("Link rejected — not a main folder")
            tails = ["claude --worktree"]
        else:
            tails = ["claude --resume %s" % i for i in parse_resume(args.get("resume"))] or ["claude"]
        return [("open_session", d, _shell(d, t, rgb, badge), tint, badge, key) for t in tails]
    if cmd == "run":
        d, rgb, tint, badge, key = _folder(_base(args, root, roots), _need(args, "path"), args.get("root", "projects"), args.get("c"))
        spec = run_spec(d)
        if not spec:
            return [("notify", "%s has no start command" % os.path.basename(d))]
        return [("run_session", d, _shell(d, shlex.join(spec[0]), rgb, badge), tint, badge, spec[1], key)]
    if cmd == "diff":
        d, rgb, tint, badge, key = _folder(_base(args, root, roots), _need(args, "path"), args.get("root", "projects"), args.get("c"))
        return [("diff_session", d, _shell(d, DIFF_TAIL, rgb, badge), tint, badge, key)]
    if cmd == "jump":
        return [("jump", parse_iterm(_need(args, "iterm")))]
    if cmd == "step":
        uid, do = parse_iterm(_need(args, "iterm")), _need(args, "do")
        if do not in STEP_TEXT:
            raise Rejected("Link rejected — unknown step")
        return [("step", uid, STEP_TEXT[do])]
    if cmd == "new":
        label = _need(args, "root")
        base = check_root_exists(label, _base(args, root, roots))
        name = _need(args, "name")
        if not NAME_RE.fullmatch(name) or name.endswith(".") or name in (".", ".."):
            raise Rejected("Link rejected — invalid name")
        return [("create_project", base, name, label)]
    raise Rejected("Link rejected — unknown command")

def fo_home():
    return os.environ.get("FO_HOME") or os.path.join(os.path.expanduser("~"), ".flowobserve")

def load_config():
    c = _read_json(os.path.join(fo_home(), "helper.json"))
    return c if isinstance(c, dict) and isinstance(c.get("root"), str) and os.path.isabs(c["root"]) else None

def roots_of(cfg):
    """label -> path for every root a link may name; 'projects' is the projects root. First label wins."""
    out = {"projects": cfg["root"]}
    for r in cfg.get("createRoots") or []:
        if isinstance(r, dict) and isinstance(r.get("label"), str) and r["label"] \
                and isinstance(r.get("path"), str) and os.path.isabs(r["path"]):
            out.setdefault(r["label"], r["path"])
    return out

def _base(args, root, roots):
    """Directory a link's path is relative to: the named root, or the projects root when none is named."""
    if "root" not in args:
        return root
    roots = roots if roots is not None else {"projects": root}
    if args["root"] not in roots:
        raise Rejected("Link rejected — unknown root")
    return roots[args["root"]]

def _token_of(url):
    try:
        ts = [v for k, v in urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query, keep_blank_values=True) if k == "t"]
    except (ValueError, TypeError):
        return None
    return ts[0] if len(ts) == 1 else None

def iso_utc(now):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + ".%03dZ" % int((now % 1) * 1000)

def spool_append(row, now):
    path = os.path.join(fo_home(), "spool", time.strftime("%Y-%m-%d", time.localtime(now)) + ".jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.write(fd, (json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    finally:
        os.close(fd)

def _action_name(cmd, args):
    if cmd == "open":
        return "restore" if args.get("resume") else "open"
    return {"run": "run", "jump": "jump", "step": "step", "diff": "diff", "new": "new"}.get(cmd, "unknown")

def _is_no_iterm(e):
    return isinstance(e, FileNotFoundError) or (isinstance(e, subprocess.CalledProcessError)
                                                and any(m in "%s %s" % (e.stderr or "", e.output or "") for m in ('application id "com.googlecode.iterm2"',)))

def _wait_and_open(osascript, sid, url):
    for _ in range(60):
        if url in osascript(fo_iterm.CONTENTS_SCRIPT, [sid]):
            subprocess.run(["/usr/bin/open", url], check=False, timeout=30)
            return
        time.sleep(1)

def _execute(acts, osascript, notify):
    """Run planned actions; returns (ok, error)."""
    for a in acts:
        kind = a[0]
        if kind == "notify":
            notify(a[1])
            return False, a[1]
        if kind in ("open_session", "run_session"):
            sid = _open_placed(osascript, a[2], a[3], a[-1], "claude" if kind == "open_session" else "run")
            if kind == "run_session" and a[5] and UUID_RE.fullmatch(sid or ""):
                _wait_and_open(osascript, sid, a[5])
        elif kind == "diff_session":
            _open_placed(osascript, a[2], a[3], a[5], "diff")
        elif kind == "jump" or kind == "step":
            script = fo_iterm.JUMP_SCRIPT if kind == "jump" else fo_iterm.STEP_SCRIPT
            if osascript(script, list(a[1:])) == "missing":
                notify(GONE)
                return False, GONE
    return True, None

def main(argv, osascript=None, notify=None, spool=None, now=time.time, git=_git):
    osascript = osascript or fo_iterm.osascript
    notify = notify or fo_iterm.notify
    spool = spool or (lambda row: spool_append(row, now()))

    def say(text):
        try:
            notify(text)
        except Exception:  # a failed notification must not stop the spool row
            pass

    try:
        url = argv[0] if argv and isinstance(argv[0], str) else ""
        cfg = load_config()
        if cfg is None:
            say(NO_CONFIG)
            return 0
        try:
            check_token(_token_of(url), cfg.get("token"))
        except Rejected as e:
            say(str(e))
            try:
                action = _action_name(*parse(url))
            except Exception:
                action = "unknown"
            spool({"v": 1, "ts": iso_utc(now()), "src": "helper", "sid": "", "cwd": "", "event": "helper",
                   "payload": {"action": action, "ok": False, "error": str(e)}})
            return 0
        cmd, args, cwd, ok, err, count, init = "unknown", {}, "", False, None, None, None
        try:
            cmd, args = parse(url)
            if cmd == "new":
                _, base, name, label = plan(cmd, args, cfg["root"], roots_of(cfg))[0]
                ok, err = create_project(base, name, git)
                if ok:
                    cwd = os.path.join(base, name)
                    acts = plan("open", {"path": name, "root": label}, cfg["root"], roots_of(cfg))
                    ok, err = _execute(acts, osascript, say)
                else:
                    say(err)
            else:
                acts = plan(cmd, args, cfg["root"], roots_of(cfg))
                cwd = next((a[1] for a in acts if a[0] in ("open_session", "run_session", "diff_session")), "")
                count = len(acts) if cmd == "open" and args.get("resume") else None
                if _action_name(cmd, args) == "open":  # a fresh open of a plain folder makes it a git project first
                    init = needs_init(_base(args, cfg["root"], roots_of(cfg)), args["path"], cwd)
                    err = git_init(cwd, git)[1] if init else None
                if err:
                    say(err)
                else:
                    ok, err = _execute(acts, osascript, say)
        except Rejected as e:
            err = str(e)
            say(err)
        except Exception as e:
            err = NO_ITERM if _is_no_iterm(e) else "iTerm2 action failed"
            say(err)
        payload = {"action": _action_name(cmd, args), "ok": ok, **({"error": err} if err else {}),
                   **({"count": count} if count is not None else {}), **({"init": init} if init is not None else {}), **({"name": args["name"]} if cmd == "new" and "name" in args else {})}
        spool({"v": 1, "ts": iso_utc(now()), "src": "helper", "sid": "", "cwd": cwd, "event": "helper", "payload": payload})
    except Exception:  # never raise into the URL handler
        pass
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
