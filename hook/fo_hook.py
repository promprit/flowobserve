#!/usr/bin/python3 -S
"""flowobserve hook: redact one Claude Code hook payload and append it to the spool. Never blocks, always exits 0."""
import json
import os
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# fo_derive / fo_redact are imported inside the guarded paths so a broken module still exits 0 silently.

MAX_LINE = 4096
MAX_STDIN = 1048576
SCAN_BYTES = 65536
CLIP_FINAL = 256
MIN_KEYS = ("session_id", "cwd", "hook_event_name", "tool_name", "agent_id")
USAGE_TTL_S = 86400
KEEP_KEYS = ("hook_event_name", "tool_name", "agent_id", "agent_type", "notification_type", "fo")
KEEP_INPUT = ("skill", "subagent_type", "model", "file_path", "command", "from_model", "to_model", "task", "description")


class Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise Timeout("200ms budget exceeded")


def arm_timeout(seconds):
    """POSIX: SIGALRM raises Timeout. Windows has no SIGALRM: a daemon timer exits 0 (windows spec §3.1)."""
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _alarm)
        signal.setitimer(signal.ITIMER_REAL, seconds)
        return None
    import threading
    t = threading.Timer(seconds, os._exit, (0,))
    t.daemon = True
    t.start()
    return t


def disarm(t):
    if t is not None:
        t.cancel()
    elif hasattr(signal, "SIGALRM"):
        signal.setitimer(signal.ITIMER_REAL, 0)


def fo_home():
    return os.environ.get("FO_HOME") or os.path.join(os.path.expanduser("~"), ".flowobserve")


def append(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_BINARY", 0), 0o600)
    try:
        if sys.platform == "win32":
            _append_locked(fd, data)
        else:
            os.write(fd, data)  # one O_APPEND write per line: safe across parallel sessions
    finally:
        os.close(fd)


LOCK_AT = 1 << 40  # far past any spool size: Windows byte locks are mandatory, so never lock real data


def _append_locked(fd, data):
    """Windows O_APPEND is seek-then-write and races across processes: hold a byte lock (windows spec §3.1)."""
    import errno
    import msvcrt
    while True:  # bounded by the 0.2 s budget timer
        os.lseek(fd, LOCK_AT, 0)
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            break
        except OSError as e:
            if e.errno not in (errno.EACCES, errno.EDEADLK):
                os.write(fd, data)  # not contention: write unlocked rather than spin
                return
            time.sleep(0.002)
    try:
        os.lseek(fd, 0, 2)
        os.write(fd, data)
    finally:
        os.lseek(fd, LOCK_AT, 0)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)


def log_error(msg):
    try:
        from fo_redact import redact
        msg = redact(msg)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        append(os.path.join(fo_home(), "hook-errors.log"), ("%s %s\n" % (stamp, msg[:500])).encode("utf-8", "replace"))
    except Exception:
        pass


def iso_utc(now):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + ".%03dZ" % int((now % 1) * 1000)


def spool_path(now):
    return os.path.join(fo_home(), "spool", time.strftime("%Y-%m-%d", time.localtime(now)) + ".jsonl")


def encode(obj):
    return (json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8", "replace")


def _clip(v, n):
    if isinstance(v, str):
        return v if len(v) <= n else v[:n] + "…"
    if isinstance(v, dict):
        return {k: _clip(x, n) for k, x in v.items()}
    if isinstance(v, list):
        return [_clip(x, n) for x in v[:20]]
    return v


def fit(line):
    b = encode(line)
    if len(b) <= MAX_LINE:
        return b
    line = dict(line, truncated=True)
    line["payload"] = _clip(line.get("payload"), 256)
    b = encode(line)
    if len(b) <= MAX_LINE:
        return b
    p = line["payload"] if isinstance(line["payload"], dict) else {}
    keep = {k: p[k] for k in KEEP_KEYS if k in p}
    ti = p.get("tool_input")
    if isinstance(ti, dict):
        keep["tool_input"] = {k: _clip(ti[k], 200) for k in KEEP_INPUT if k in ti}
    line["payload"] = keep
    b = encode(line)
    if len(b) <= MAX_LINE:
        return b
    final = {k: keep[k] for k in ("fo", "hook_event_name", "tool_name", "agent_id") if k in keep}
    line["payload"] = _clip(final, CLIP_FINAL)
    for k in ("sid", "cwd", "event"):
        line[k] = _clip(str(line.get(k, "")), CLIP_FINAL)
    return encode(line)


def minimal_payload(stdin):
    """Pull the routing keys out of an oversize (cut) payload with small regexes over its head."""
    import re
    head = stdin[:SCAN_BYTES].decode("utf-8", "replace")
    out = {}
    for k in MIN_KEYS:
        m = re.search(r'"%s"\s*:\s*"([^"]{0,200})"' % k, head)
        if m:
            try:
                out[k] = json.loads('"%s"' % m.group(1))
            except ValueError:
                out[k] = m.group(1)
    return out


HEX = frozenset("0123456789abcdefABCDEF")


def is_session_id(sid):
    """Claude Code session ids are UUIDs; workflow probes (release_check.py, live checks) use names like
    "release-check" and must not become sessions."""
    return (isinstance(sid, str) and len(sid) == 36 and all(sid[i] == "-" for i in (8, 13, 18, 23))
            and all(c in HEX for c in sid.replace("-", "")))


TERM_ENV = (("entry", "CLAUDE_CODE_ENTRYPOINT"), ("program", "TERM_PROGRAM"), ("iterm", "ITERM_SESSION_ID"))


def term_info(env=os.environ):
    out = {}
    for key, var in TERM_ENV:
        v = env.get(var)
        out[key] = v[:64] if isinstance(v, str) and v else None
    return out


def run_hook(stdin, now):
    from fo_redact import redact_obj
    try:
        payload = json.loads(stdin.decode("utf-8", "replace"))
    except ValueError:
        if len(stdin) < MAX_STDIN:
            raise
        payload = minimal_payload(stdin)
        if not is_session_id(payload.get("session_id")):
            return
        line = {
            "v": 1, "ts": iso_utc(now), "src": "hook",
            "sid": payload.get("session_id", ""), "cwd": payload.get("cwd", ""),
            "event": payload.get("hook_event_name", ""), "payload": redact_obj(payload), "truncated": True,
        }
        append(spool_path(now), fit(line))
        return
    if not isinstance(payload, dict):
        raise ValueError("payload is not an object")
    if not is_session_id(payload.get("session_id")):
        return
    from fo_derive import derive
    fo = derive(payload)
    if fo:
        payload["fo"] = fo
    if "tool_response" in payload:  # slim before redaction: redacting large tool output is the main cost
        tr = payload["tool_response"]
        if isinstance(tr, dict):
            payload["tool_response"] = {"interrupted": bool(tr.get("interrupted"))}
        else:
            del payload["tool_response"]
    line = {
        "v": 1, "ts": iso_utc(now), "src": "hook",
        "sid": str(payload.get("session_id", "")), "cwd": str(payload.get("cwd", "")),
        "event": str(payload.get("hook_event_name", "")), "payload": redact_obj(payload),
    }
    if line["event"] == "SessionStart":
        line["term"] = term_info()
    append(spool_path(now), fit(line))


USAGE_STATE = "usage-last.json"
USAGE_EVERY_S = 60


def usage_payload(raw):
    rl = raw.get("rate_limits")
    if not isinstance(rl, dict):
        return None
    cost = raw.get("cost")
    model = raw.get("model")
    return {
        "rate_limits": {k: rl[k] for k in ("five_hour", "seven_day") if isinstance(rl.get(k), dict)},
        "cost": {"total_cost_usd": cost.get("total_cost_usd")} if isinstance(cost, dict) else None,
        "model": {"id": model.get("id")} if isinstance(model, dict) else None,
    }


def _age(now, entry):
    """Seconds since a [key, ts] state entry was written; malformed entries count as infinitely old."""
    if isinstance(entry, list) and len(entry) == 2 and isinstance(entry[1], (int, float)):
        return now - entry[1]
    return float("inf")


def record_usage(data, now):
    from fo_redact import redact_obj
    raw = json.loads(data.decode("utf-8", "replace"))
    if not isinstance(raw, dict):
        return
    if not is_session_id(raw.get("session_id")):
        return
    payload = usage_payload(raw)
    if payload is None:
        return
    sid = str(raw.get("session_id", ""))
    ws = raw.get("workspace") if isinstance(raw.get("workspace"), dict) else {}
    cwd = str(raw.get("cwd") or ws.get("current_dir") or "")
    key = json.dumps(payload, sort_keys=True)
    state_path = os.path.join(fo_home(), USAGE_STATE)
    try:
        with open(state_path) as f:
            state = json.load(f)
    except Exception:
        state = {}
    if not isinstance(state, dict):
        state = {}
    last = state.get(sid)
    if isinstance(last, list) and len(last) == 2 and last[0] == key and _age(now, last) < USAGE_EVERY_S:
        return
    line = {"v": 1, "ts": iso_utc(now), "src": "statusline", "sid": sid, "cwd": cwd, "event": "usage",
            "payload": redact_obj(payload)}
    append(spool_path(now), encode(line))
    state = {k: v for k, v in state.items() if _age(now, v) < USAGE_TTL_S}
    state[sid] = [key, now]
    tmp = state_path + ".%d.tmp" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, state_path)


def exec_with_stdin(cmd, data):
    import tempfile
    f = tempfile.TemporaryFile()
    f.write(data)
    f.flush()
    f.seek(0)
    os.dup2(f.fileno(), 0)
    os.execvp(cmd[0], cmd)


def run_usage(rest):
    cmd = rest[1:] if rest[:1] == ["--"] else rest
    data = sys.stdin.buffer.read(MAX_STDIN)
    t = arm_timeout(0.2)
    try:
        record_usage(data, time.time())
    except BaseException as e:
        log_error("usage %s: %s" % (type(e).__name__, e))
    finally:
        disarm(t)  # never let the timer fire inside the HUD
    if cmd:
        try:
            exec_with_stdin(cmd, data)
        except BaseException as e:
            log_error("usage exec %s: %s" % (type(e).__name__, e))
    return 0


def main(argv):
    if len(argv) > 1 and argv[1] == "--usage":
        return run_usage(argv[2:])
    t = arm_timeout(0.2)
    try:
        run_hook(sys.stdin.buffer.read(MAX_STDIN), time.time())
    except BaseException as e:  # Timeout, bad input, disk full: never surface to Claude Code
        log_error("%s: %s" % (type(e).__name__, e))
    finally:
        disarm(t)
    return 0


if __name__ == "__main__":
    try:
        main(sys.argv)
    except BaseException:
        pass
    sys.exit(0)
