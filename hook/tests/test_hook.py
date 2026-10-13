import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from conftest import HOOK, PY
from fo_hook import fit, minimal_payload


def run(stdin, home):
    env = dict(os.environ, FO_HOME=str(home))
    return subprocess.run([PY, "-S", HOOK], input=stdin, capture_output=True, env=env, timeout=5)


def spool_lines(home):
    path = os.path.join(str(home), "spool", time.strftime("%Y-%m-%d") + ".jsonl")
    if not os.path.exists(path):
        return []
    with open(path, "rb") as f:
        return [json.loads(l) for l in f.read().splitlines()]


def pre(command="git status", **extra):
    p = {"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/Users/p/app", "hook_event_name": "PreToolUse",
         "tool_name": "Bash", "tool_input": {"command": command}}
    p.update(extra)
    return json.dumps(p).encode()


def test_appends_one_redacted_line(tmp_path):
    r = run(pre("API_TOKEN=abc123 make"), tmp_path)
    assert r.returncode == 0 and r.stdout == b""
    [line] = spool_lines(tmp_path)
    assert line["v"] == 1 and line["src"] == "hook" and line["sid"] == "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b"
    assert line["cwd"] == "/Users/p/app" and line["event"] == "PreToolUse"
    assert line["ts"].endswith("Z")
    assert "abc123" not in json.dumps(line)
    assert line["payload"]["fo"]["say"]== "Bash · make"


def test_bad_stdin_exits_zero_and_logs(tmp_path):
    for bad in [b"not json", b"[1,2]", b""]:
        r = run(bad, tmp_path)
        assert r.returncode == 0 and r.stdout == b""
    assert spool_lines(tmp_path) == []
    with open(os.path.join(str(tmp_path), "hook-errors.log")) as f:
        assert len(f.read().splitlines()) == 3


def test_large_payload_is_trimmed_to_4096_bytes(tmp_path):
    big = {"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/a", "hook_event_name": "PostToolUse", "tool_name": "Write",
           "tool_input": {"file_path": "/a/docs/superpowers/plans/p.md", "content": "### Task 1\n" + "x" * 100000},
           "tool_response": {"stdout": "y" * 50000}}
    r = run(json.dumps(big).encode(), tmp_path)
    assert r.returncode == 0
    path = os.path.join(str(tmp_path), "spool", time.strftime("%Y-%m-%d") + ".jsonl")
    raw = open(path, "rb").read()
    assert len(raw) <= 4096
    line = json.loads(raw)
    assert line["truncated"] is True
    assert line["payload"]["tool_input"]["file_path"] == "/a/docs/superpowers/plans/p.md"
    assert line["payload"]["fo"]["planTasks"] == 1


def test_fit_keeps_small_lines_untouched():
    line = {"v": 1, "payload": {"a": 1}}
    assert json.loads(fit(line)) == line


def test_concurrent_writers_produce_whole_lines(tmp_path):
    with ThreadPoolExecutor(max_workers=10) as ex:
        list(ex.map(lambda i: run(pre("echo %d" % i), tmp_path), range(20)))
    lines = spool_lines(tmp_path)
    assert len(lines) == 20
    assert sorted(l["payload"]["tool_input"]["command"] for l in lines) == sorted("echo %d" % i for i in range(20))


def errors(home):
    path = os.path.join(str(home), "hook-errors.log")
    return open(path).read() if os.path.exists(path) else ""


def test_log_error_redacts(tmp_path, monkeypatch):
    import fo_hook
    monkeypatch.setenv("FO_HOME", str(tmp_path))
    fo_hook.log_error("ValueError: bad API_TOKEN=abc123 here")
    text = errors(tmp_path)
    assert "ValueError" in text and "abc123" not in text


def test_broken_import_exits_zero_silently(tmp_path):
    import shutil
    from conftest import HOOK_DIR
    shutil.copy(HOOK, str(tmp_path / "fo_hook.py"))
    shutil.copy(os.path.join(HOOK_DIR, "fo_redact.py"), str(tmp_path / "fo_redact.py"))
    (tmp_path / "fo_derive.py").write_text("raise RuntimeError('broken module')\n")
    home = tmp_path / "home"
    env = dict(os.environ, FO_HOME=str(home))
    r = subprocess.run([PY, "-S", str(tmp_path / "fo_hook.py")], input=pre(), capture_output=True,
                       env=env, timeout=5)
    assert r.returncode == 0 and r.stdout == b""
    assert "broken module" in errors(home)


def test_lone_surrogate_still_writes_line(tmp_path):
    r = run(pre("echo a\ud800b"), tmp_path)
    assert r.returncode == 0
    assert len(spool_lines(tmp_path)) == 1


def test_tool_response_is_slimmed(tmp_path):
    p = {"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/a", "hook_event_name": "PostToolUse", "tool_name": "Bash",
         "tool_input": {"command": "cat big"}, "tool_response": {"stdout": "y" * 500000, "interrupted": False}}
    run(json.dumps(p).encode(), tmp_path)
    [line] = spool_lines(tmp_path)
    assert line["payload"]["tool_response"] == {"interrupted": False}
    assert line["payload"]["tool_input"]["command"] == "cat big"
    p["tool_response"] = "z" * 1000
    run(json.dumps(p).encode(), tmp_path)
    assert "tool_response" not in spool_lines(tmp_path)[1]["payload"]


def test_oversize_stdin_writes_minimal_line(tmp_path):
    p = {"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/a", "hook_event_name": "PostToolUse", "tool_name": "Read", "agent_id": "ag1",
         "tool_input": {"file_path": "/a/x"}, "tool_response": {"content": "q" * 1200000}}
    data = json.dumps(p).encode()
    assert len(data) > 1200000
    run(data, tmp_path)
    path = os.path.join(str(tmp_path), "spool", time.strftime("%Y-%m-%d") + ".jsonl")
    raw = open(path, "rb").read()
    assert len(raw) <= 4096
    [line] = spool_lines(tmp_path)
    assert line["event"] == "PostToolUse" and line["sid"] == "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b" and line["cwd"] == "/a"
    assert line["truncated"] is True
    assert line["payload"]["tool_name"] == "Read" and line["payload"]["agent_id"] == "ag1"


def test_fit_final_fallback_bounded_and_keeps_fo():
    line = {"v": 1, "ts": "t", "src": "hook", "sid": "s" * 10000, "cwd": "c" * 10000, "event": "PreToolUse",
            "payload": {"hook_event_name": "PreToolUse", "tool_name": "Bash", "fo": {"say": "Bash ls"}}}
    b = fit(line)
    assert len(b) <= 4096
    assert json.loads(b)["payload"]["fo"]["say"] == "Bash ls"


@pytest.mark.skipif(sys.platform == "win32", reason="the Windows thread timer calls os._exit(0), which would end the pytest process (windows spec §3.1)")
def test_timeout_path_logs_and_returns(tmp_path, monkeypatch):
    import fo_hook

    class In:
        class buffer:
            @staticmethod
            def read(n=-1):
                return b"{}"

    monkeypatch.setenv("FO_HOME", str(tmp_path))
    monkeypatch.setattr(fo_hook, "run_hook", lambda stdin, now, direct=False: time.sleep(1))
    monkeypatch.setattr(sys, "stdin", In)
    t = time.perf_counter()
    assert fo_hook.main(["fo_hook.py"]) == 0
    assert time.perf_counter() - t < 0.6
    assert "Timeout" in errors(tmp_path)


def test_ignores_probe_sessions(tmp_path):
    # Workflow checks (release_check.py, live checks) pipe synthetic events with ids like "release-check";
    # Claude Code always sends a UUID, so anything else never reaches the spool.
    for sid in ("release-check", "live-check", "s1"):
        r = run(pre(session_id=sid), tmp_path)
        assert r.returncode == 0 and r.stdout == b""
    assert spool_lines(tmp_path) == []
    run(pre(session_id="0F8E2C3A-6B1D-4E5F-9A7B-2C4D6E8F0A1B"), tmp_path)
    assert len(spool_lines(tmp_path)) == 1


def test_ignores_missing_or_malformed_session_ids(tmp_path):
    for sid in (None, 42, "", "x" * 36, "0f8e2c3a6-b1d-4e5f-9a7b-2c4d6e8f0a1b"):
        run(pre(session_id=sid), tmp_path)
    p = json.loads(pre())
    del p["session_id"]
    run(json.dumps(p).encode(), tmp_path)
    assert spool_lines(tmp_path) == []


def test_agent_description_survives_trim(tmp_path):
    p = {"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/a", "hook_event_name": "PreToolUse",
         "tool_name": "Agent",
         "tool_input": {"description": "T1 tester: term line tests", "subagent_type": "executor",
                        "prompt": "p" * 100000},
         "extra": ["e" * 300 for _ in range(20)]}  # padding: line stays over 4096 bytes after clipping, so the KEEP_INPUT trim runs
    run(json.dumps(p).encode(), tmp_path)
    [line] = spool_lines(tmp_path)
    assert line["truncated"] is True
    ti = line["payload"]["tool_input"]
    assert ti["description"] == "T1 tester: term line tests"
    assert ti["subagent_type"] == "executor"
    assert "prompt" not in ti


def test_arm_uses_a_thread_timer_without_sigalrm(monkeypatch):
    import fo_hook
    monkeypatch.delattr(fo_hook.signal, "SIGALRM", raising=False)
    t = fo_hook.arm_timeout(5)
    try:
        assert t is not None and t.daemon and t.is_alive()
    finally:
        fo_hook.disarm(t)
    t.join(1)
    assert not t.is_alive()


def test_windows_cwd_is_recorded_as_given(tmp_path):
    r = run(pre(cwd="C:\\Users\\dev\\Desktop\\HARBOR PC\\harbor-website"), tmp_path)
    assert r.returncode == 0 and r.stdout == b"" and r.stderr == b""
    [line] = spool_lines(tmp_path)
    assert line["cwd"] == "C:\\Users\\dev\\Desktop\\HARBOR PC\\harbor-website"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows byte-range locks only")
def test_append_lock_never_blocks_readers(tmp_path):
    import msvcrt
    import fo_hook
    path = str(tmp_path / "s.jsonl")
    fo_hook.append(path, b'{"a":1}\n')
    fd = os.open(path, os.O_RDWR | os.O_BINARY)
    try:
        os.lseek(fd, fo_hook.LOCK_AT, 0)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        with open(path, "rb") as f:
            assert f.read() == b'{"a":1}\n'
        os.lseek(fd, fo_hook.LOCK_AT, 0)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    finally:
        os.close(fd)
    fo_hook.append(path, b'{"b":2}\n')
    assert open(path, "rb").read().count(b"\n") == 2


@pytest.mark.skipif(sys.platform != "win32", reason="Windows byte-range locks only")
def test_append_falls_back_when_locking_fails_for_other_reasons(tmp_path, monkeypatch):
    import errno
    import msvcrt
    import fo_hook

    def boom(fd, mode, n):
        raise OSError(errno.EINVAL, "invalid")

    monkeypatch.setattr(msvcrt, "locking", boom)
    path = str(tmp_path / "s.jsonl")
    t0 = time.monotonic()
    fo_hook.append(path, b'{"a":1}\n')
    assert time.monotonic() - t0 < 0.1
    assert open(path, "rb").read() == b'{"a":1}\n'


@pytest.mark.skipif(sys.platform != "win32", reason="exercises the Windows thread timer")
def test_windows_timer_exits_zero_silently_when_hook_is_slow(tmp_path):
    script = tmp_path / "slow.py"
    script.write_text(
        "import sys, time\n"
        "sys.path.insert(0, sys.argv[1])\n"
        "import fo_hook\n"
        "fo_hook.run_hook = lambda stdin, now, direct=False: time.sleep(1)\n"
        "sys.exit(fo_hook.main(['fo_hook.py']))\n")
    env = dict(os.environ, FO_HOME=str(tmp_path / "home"))
    t0 = time.monotonic()
    r = subprocess.run([PY, str(script), os.path.dirname(HOOK)], input=b"{}", capture_output=True, env=env, timeout=5)
    elapsed = time.monotonic() - t0
    assert r.returncode == 0 and r.stdout == b"" and r.stderr == b""
    assert 0.15 < elapsed < 0.9


def test_minimal_payload_decodes_escaped_windows_cwd():
    head = b'{"session_id": "x", "cwd": "C:\\\\Users\\\\dev\\\\code\\\\app", "hook_event_name": "Stop"'
    result = minimal_payload(head)
    assert result["cwd"] == "C:\\Users\\dev\\code\\app"


def test_disabled_marker_makes_the_hook_a_silent_no_op(tmp_path):
    (tmp_path / "disabled").write_text("")
    r = run(pre(), tmp_path)
    assert r.returncode == 0 and r.stdout == b"" and r.stderr == b""
    assert spool_lines(tmp_path) == []
    assert not (tmp_path / "spool").exists()
    (tmp_path / "disabled").unlink()
    run(pre(), tmp_path)
    assert len(spool_lines(tmp_path)) == 1


def _stage(root, on):
    root.mkdir(exist_ok=True)
    st = {"flowobserve": {"enabled": on}}
    (root / "chain.local.json").write_text(json.dumps({"stages": {"pretool": st, "prompt": st}}))


def run_direct(stdin, home, root):
    env = dict(os.environ, FO_HOME=str(home), DRYAS_DATA_ROOT=str(root))
    return subprocess.run([PY, "-S", HOOK, "--direct"], input=stdin, capture_output=True, env=env, timeout=5)


def test_direct_entry_steps_aside_while_the_dryas_stage_is_on(tmp_path):
    home, root = tmp_path / "home", tmp_path / "dryas"
    _stage(root, True)
    r = run_direct(pre(), home, root)
    assert r.returncode == 0 and r.stdout == b"" and r.stderr == b""
    assert spool_lines(home) == []
    run(pre(), home)  # the Dryas chain stage itself (no --direct) is recorded
    assert len(spool_lines(home)) == 1


def test_direct_entry_records_when_dryas_is_off_missing_or_unreadable(tmp_path):
    home, root = tmp_path / "home", tmp_path / "dryas"
    run_direct(pre(), home, root)  # no Dryas at all
    _stage(root, False)
    run_direct(pre(), home, root)  # stage turned off
    (root / "chain.local.json").write_text("{broken")
    run_direct(pre(), home, root)
    assert len(spool_lines(home)) == 3
    _stage(root, True)  # session events other than PreToolUse / UserPromptSubmit are never skipped
    run_direct(pre(hook_event_name="Stop"), home, root)
    assert len(spool_lines(home)) == 4
