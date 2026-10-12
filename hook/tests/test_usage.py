import json
import os
import subprocess
import sys
import time

import pytest

from conftest import HOOK, PY

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "fixtures", "statusline.json")


def run(stdin, home, *cmd, **env_extra):
    env = dict(os.environ, FO_HOME=str(home))
    for k in ("FO_ACCT", "CLAUDE_CONFIG_DIR"):
        env.pop(k, None)
    env.update(env_extra)
    args = [PY, "-S", HOOK, "--usage"] + (["--"] + list(cmd) if cmd else [])
    return subprocess.run(args, input=stdin, capture_output=True, env=env, timeout=5)


def lines(home):
    path = os.path.join(str(home), "spool", time.strftime("%Y-%m-%d") + ".jsonl")
    return [json.loads(l) for l in open(path, "rb").read().splitlines()] if os.path.exists(path) else []


def fixture():
    return open(FIXTURE, "rb").read()


@pytest.mark.skipif(sys.platform == "win32", reason="statusline wrapper is not wired on Windows (windows spec §3.4)")
def test_passes_stdin_through_to_the_wrapped_command(tmp_path):
    data = fixture()
    r = run(data, tmp_path, "/bin/cat")
    assert r.returncode == 0
    assert r.stdout == data


def test_writes_usage_line_with_limits_cost_and_model(tmp_path):
    run(fixture(), tmp_path, "/bin/cat")
    [line] = lines(tmp_path)
    assert line["src"] == "statusline" and line["event"] == "usage" and line["sid"] == "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
    p = line["payload"]
    assert p["rate_limits"]["five_hour"]["used_percentage"] == 42.5
    assert p["rate_limits"]["seven_day"]["resets_at"] == 1791446400
    assert p["cost"] == {"total_cost_usd": 1.2345}
    assert p["model"] == {"id": "claude-opus-5-5"}


@pytest.mark.skipif(sys.platform == "win32", reason="statusline wrapper is not wired on Windows (windows spec §3.4)")
def test_no_rate_limits_means_no_line_but_hud_still_runs(tmp_path):
    raw = json.loads(fixture())
    del raw["rate_limits"]
    data = json.dumps(raw).encode()
    r = run(data, tmp_path, "/bin/cat")
    assert r.stdout == data
    assert lines(tmp_path) == []


def test_throttles_identical_payloads(tmp_path):
    run(fixture(), tmp_path, "/bin/cat")
    run(fixture(), tmp_path, "/bin/cat")
    assert len(lines(tmp_path)) == 1
    raw = json.loads(fixture())
    raw["cost"]["total_cost_usd"] = 2.0
    run(json.dumps(raw).encode(), tmp_path, "/bin/cat")
    assert len(lines(tmp_path)) == 2


@pytest.mark.skipif(sys.platform == "win32", reason="statusline wrapper is not wired on Windows (windows spec §3.4)")
def test_bad_json_still_runs_hud(tmp_path):
    r = run(b"garbage", tmp_path, "/bin/cat")
    assert r.returncode == 0 and r.stdout == b"garbage"


def test_missing_command_or_exec_failure_exits_zero(tmp_path):
    assert run(fixture(), tmp_path).returncode == 0
    assert run(fixture(), tmp_path, "/nonexistent/hud").returncode == 0


def state_path(home):
    return os.path.join(str(home), "usage-last.json")


def test_malformed_state_entry_still_writes(tmp_path):
    with open(state_path(tmp_path), "w") as f:
        json.dump({"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d": []}, f)
    run(fixture(), tmp_path, "/bin/cat")
    assert len(lines(tmp_path)) == 1


def test_stale_state_entries_pruned(tmp_path):
    with open(state_path(tmp_path), "w") as f:
        json.dump({"old": ["k", time.time() - 90000], "recent": ["k", time.time() - 100]}, f)
    run(fixture(), tmp_path, "/bin/cat")
    state = json.load(open(state_path(tmp_path)))
    assert "old" not in state and "recent" in state and "~/.claude|1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" in state


def test_ignores_probe_statusline(tmp_path):
    raw = json.loads(fixture())
    raw["session_id"] = "release-check"
    assert run(json.dumps(raw).encode(), tmp_path, "/bin/cat").returncode == 0
    assert lines(tmp_path) == []
