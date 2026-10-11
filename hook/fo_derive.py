"""Small derived summary (payload["fo"]) computed before redaction and trimming."""
import re

from fo_redact import redact

PLAN_RE = re.compile(r"(?:^|/)(?:docs/superpowers/plans/[^/]+\.md|\.orchestrate/PLAN\.md)$")
TASK_RE = re.compile(r"^#{2,3} Task \d+", re.M)
SAY_MAX = 140
ARG_KEYS = ("command", "file_path", "skill", "description", "pattern", "url", "query")
PATH_TOOLS = ("Write", "Edit", "MultiEdit", "Read", "NotebookEdit")
REL_MAX = 40
_SKIP_RE = re.compile(r"^\s*(#|\|)")


def to_posix(p):
    """Windows path → forward slashes, upper-case drive; other strings unchanged (windows spec §3.1)."""
    if not isinstance(p, str):
        return p
    p = p.replace("\\", "/")
    if len(p) >= 2 and p[1] == ":" and p[0].isalpha():
        p = p[0].upper() + p[1:]
    return p


def rel_path(path, cwd):
    """Path relative to the session's project; long paths keep the first folder and the file name."""
    path, cwd = to_posix(path), to_posix(cwd)
    if isinstance(cwd, str) and cwd:
        root = cwd.rstrip("/") + "/"
        if path.startswith(root):
            path = path[len(root):]
    if len(path) > REL_MAX and "/" in path.strip("/"):
        head, tail = path.split("/", 1)[0], path.rsplit("/", 1)[1]
        path = head + "/…/" + tail
    return path


def say_line(text):
    if not isinstance(text, str):
        return ""
    for line in text.splitlines():
        line = " ".join(line.split())
        if line:
            return line if len(line) <= SAY_MAX else line[: SAY_MAX - 1] + "…"
    return ""


def plan_tasks(payload):
    if payload.get("tool_name") != "Write":
        return None
    ti = payload.get("tool_input")
    if not isinstance(ti, dict) or not PLAN_RE.search(to_posix(str(ti.get("file_path", "")))):
        return None
    return len(TASK_RE.findall(str(ti.get("content", ""))))


def result(msg):
    if not isinstance(msg, str):
        return "unknown"
    for line in msg.splitlines():
        if line.strip().upper().startswith("DONE-CRITERIA:"):
            if re.search(r"not met|partial", line, re.I):
                return "fail"
            if re.search(r"\bmet\b", line, re.I):
                return "pass"
            return "unknown"
    return "unknown"


def _tool_name(name):
    if not isinstance(name, str) or not name.startswith("mcp__") or "__" not in name[5:]:
        return name if isinstance(name, str) else ""
    server, tool = name[5:].split("__", 1)
    if server.startswith("plugin_"):
        server = server[7:].split("_")[-1]
    if tool.startswith(server + "_"):
        tool = tool[len(server) + 1:]
    return "%s · %s" % (server, tool.replace("_", " "))


_SEG_RE = re.compile(r";|&&|\|\||\||\n")
_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\+?=")
_SUBCMD = {"git", "pnpm", "npm", "npx", "python", "python3", "node", "gh", "docker", "brew", "uv", "pip", "make"}
_WRAP = {"sudo", "env", "time", "nohup", "exec"}
_FLAG_VAL = {"-C", "-c", "-e", "-m", "--git-dir", "--work-tree"}


def bash_verb(command):
    try:
        for seg in _SEG_RE.split(command):
            toks = seg.split()
            i = 0
            while i < len(toks) and _ASSIGN_RE.match(toks[i]):
                if "=(" in toks[i] and ")" not in toks[i]:
                    while i < len(toks) and ")" not in toks[i]:
                        i += 1
                i += 1
            toks = [t for t in (t.rstrip(")") for t in toks[i:]) if t]
            if toks and toks[0].startswith("("):
                toks[0] = toks[0].lstrip("(")
                if not toks[0]:
                    toks = toks[1:]
            while toks and toks[0] in _WRAP:
                w = toks[0]
                toks = toks[1:]
                while w == "env" and toks and _ASSIGN_RE.match(toks[0]):
                    toks = toks[1:]
            if not toks or toks[0] == "cd":
                continue
            verb = toks[0].rstrip("/").rsplit("/", 1)[-1]
            if not verb:
                continue
            if verb in _SUBCMD:
                skip = False
                for t in toks[1:]:
                    if skip:
                        skip = False
                    elif t in _FLAG_VAL and not (t == "-m" and verb.startswith("python")):
                        skip = True
                    elif not t.startswith("-"):
                        verb += " " + t
                        break
            return "Bash · " + verb
        return "Bash"
    except Exception:
        return "Bash"


def tool_say(payload):
    try:
        name = payload.get("tool_name", "")
        ti = payload.get("tool_input")
        ti = ti if isinstance(ti, dict) else {}

        def s(k):
            v = ti.get(k)
            return v if isinstance(v, str) and v else ""

        if name == "SubagentHandback":
            text = "agent report"
        elif name == "AskUserQuestion":
            text = "question for you"
        elif name == "ToolSearch":
            text = "load tools"
        elif name == "Skill" and s("skill"):
            text = "skill · " + s("skill")
        elif name == "Agent" and s("description"):
            text = "agent · " + s("description")
        elif name == "Bash" and s("description"):
            text = "Bash · " + s("description")
        elif name == "Bash":
            text = bash_verb(s("command"))
        elif name in PATH_TOOLS and s("file_path"):
            text = name + " · " + rel_path(s("file_path"), payload.get("cwd"))
        else:
            arg = ""
            for k in ARG_KEYS:
                if s(k):
                    arg = s(k)
                    break
            text = ("%s %s" % (_tool_name(name), arg)).strip() if arg else _tool_name(name)
        return say_line(redact(text))
    except Exception:
        return ""


_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")


def pick_line(msg):
    try:
        if not isinstance(msg, str):
            return msg
        lines, skipped = [], []
        for raw in msg.splitlines():
            t = _LINK_RE.sub(r"\1", raw).replace("*", "").replace("`", "")
            t = " ".join(t.lstrip("#>- \t").split())
            if t:
                (skipped if _SKIP_RE.match(raw) else lines).append(t)
        if not lines:
            lines = skipped
        if not lines:
            return ""
        qs = [l for l in lines if l.endswith("?")]
        if qs:
            return qs[-1]
        for l in lines:
            if len(l.split()) >= 4 and not l.endswith(":"):
                return l
        return lines[0]
    except Exception:
        return msg


# TEST_CMD must stay identical to TEST_RE in server/src/ingest.ts
TEST_CMD = re.compile(r"(?:^|[;&|(\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:npx|pnpm exec)\s+)?(?:pnpm (?:-r )?(?:--filter \S+ )?test|npm (?:run )?test|vitest|pytest|(?:[^\s;&|()]*\/)?python3? -m pytest|xcodebuild test)(?=$|[\s;&|)])")
COUNT_RES = (
    (re.compile(r"Tests\s+(\d+) failed \| (\d+) passed"), lambda m: (int(m[2]), int(m[1]))),
    (re.compile(r"Tests\s+(\d+) passed"), lambda m: (int(m[1]), 0)),
    (re.compile(r"(\d+) failed, (\d+) passed"), lambda m: (int(m[2]), int(m[1]))),
    (re.compile(r"(\d+) passed"), lambda m: (int(m[1]), 0)),
    (re.compile(r"Executed (\d+) tests?, with (\d+) failures?"), lambda m: (int(m[1]) - int(m[2]), int(m[2]))),
)


def test_counts(payload):
    if payload.get("tool_name") != "Bash":
        return None
    if not TEST_CMD.search(str((payload.get("tool_input") or {}).get("command", ""))):
        return None
    tr = payload.get("tool_response")
    if not isinstance(tr, dict):
        return None
    out, err = tr.get("stdout"), tr.get("stderr")
    tail = (out[-4096:] if isinstance(out, str) else "") + "\n" + (err[-4096:] if isinstance(err, str) else "")
    tail = tail[-4096:]
    for rx, f in COUNT_RES:
        m = rx.search(tail)
        if m:
            passed, failed = f(m)
            return {"passed": max(passed, 0), "failed": max(failed, 0)}
    return None


def derive(payload):
    ev = payload.get("hook_event_name")
    out = {}
    if ev == "PreToolUse":
        out["say"] = tool_say(payload)
    elif ev in ("PostToolUse", "PostToolUseFailure"):
        if ev == "PostToolUse":
            n = plan_tasks(payload)
            if n is not None:
                out["planTasks"] = n
        t = test_counts(payload)
        if t is not None:
            out["tests"] = t
    elif ev == "SubagentStop":
        msg = payload.get("last_assistant_message")
        out["result"] = result(msg)
        s = say_line(redact(pick_line(msg))) if isinstance(msg, str) else ""
        if s:
            out["say"] = s
    elif ev == "Stop":
        msg = payload.get("last_assistant_message")
        s = say_line(redact(pick_line(msg))) if isinstance(msg, str) else ""
        if s:
            out["say"] = s
    return out
