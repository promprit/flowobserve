import json
import os
import subprocess
import sys
import time

import pytest

from conftest import HOOK, HOOK_DIR, PY

sys.path.insert(0, os.path.join(os.path.dirname(HOOK_DIR), "scripts"))
import fo_install  # noqa: E402
import fo_hook  # noqa: E402

SID = "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b"
STATUSLINE = os.path.join(os.path.dirname(HOOK_DIR), "fixtures", "statusline.json")


def env_for(fo_home, home, **extra):
    e = dict(os.environ, FO_HOME=str(fo_home), HOME=str(home), USERPROFILE=str(home))
    for k in ("FO_ACCT", "CLAUDE_CONFIG_DIR"):
        e.pop(k, None)
    e.update(extra)
    return e


def lines(fo_home):
    p = os.path.join(str(fo_home), "spool", time.strftime("%Y-%m-%d") + ".jsonl")
    return [json.loads(l) for l in open(p, "rb").read().splitlines()] if os.path.exists(p) else []


def pre():
    return json.dumps({"session_id": SID, "cwd": "/Users/p/app", "hook_event_name": "PreToolUse",
                       "tool_name": "Bash", "tool_input": {"command": "ls"}}).encode()


def hook(tmp_path, stdin, *args, **extra):
    return subprocess.run([PY, "-S", HOOK, *args], input=stdin, capture_output=True,
                          env=env_for(tmp_path / "fo", tmp_path, **extra), timeout=5)


def test_acct_of_rules(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))  # Windows expanduser reads this, not HOME
    assert fo_hook.acct_of({}) == "~/.claude"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": str(tmp_path / ".claude-personal")}) == "~/.claude-personal"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": str(tmp_path / ".claude-personal") + "/"}) == "~/.claude-personal"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": "~/.claude-personal"}) == "~/.claude-personal"
    assert fo_hook.acct_of({"FO_ACCT": "~/.claude-work", "CLAUDE_CONFIG_DIR": "~/.claude-personal"}) == "~/.claude-work"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": "/opt/claude"}) == "/opt/claude"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": "/x" * 200}) == "~/.claude"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": ""}) == "~/.claude"
    assert fo_hook.acct_of({"CLAUDE_CONFIG_DIR": "rel/dir"}) == "~/.claude"
    assert fo_hook.acct_of({"FO_ACCT": ".claude-x"}) == "~/.claude"


def test_hook_line_has_default_acct(tmp_path):
    assert hook(tmp_path, pre()).returncode == 0
    [l] = lines(tmp_path / "fo")
    assert l["acct"] == "~/.claude"


def test_hook_line_uses_config_dir_with_tilde(tmp_path):
    hook(tmp_path, pre(), CLAUDE_CONFIG_DIR=str(tmp_path / ".claude-personal"))
    [l] = lines(tmp_path / "fo")
    assert l["acct"] == "~/.claude-personal"
    assert str(tmp_path) not in json.dumps(l)


def test_truncated_line_has_acct(tmp_path):
    p = {"session_id": SID, "cwd": "/a", "hook_event_name": "PostToolUse", "tool_name": "Read",
         "tool_input": {"file_path": "/a/x"}, "tool_response": {"content": "q" * 1200000}}
    hook(tmp_path, json.dumps(p).encode(), FO_ACCT="~/.claude-personal")
    [l] = lines(tmp_path / "fo")
    assert l["truncated"] is True and l["acct"] == "~/.claude-personal"


def test_statusline_line_has_acct_and_dedups_per_account(tmp_path):
    data = open(STATUSLINE, "rb").read()
    hook(tmp_path, data, "--usage")
    hook(tmp_path, data, "--usage")
    hook(tmp_path, data, "--usage", FO_ACCT="~/.claude-personal")
    got = lines(tmp_path / "fo")
    assert [l["acct"] for l in got] == ["~/.claude", "~/.claude-personal"]
    state = json.load(open(os.path.join(str(tmp_path / "fo"), "usage-last.json")))
    sid = got[0]["sid"]
    assert sorted(state) == sorted(["~/.claude|" + sid, "~/.claude-personal|" + sid])


def test_fit_final_fallback_keeps_acct_bounded():
    line = {"v": 1, "ts": "t", "src": "hook", "sid": "s" * 10000, "cwd": "c" * 10000, "event": "PreToolUse",
            "acct": "~/.claude-personal", "payload": {"hook_event_name": "PreToolUse", "fo": {"say": "x"}}}
    out = json.loads(fo_hook.fit(line))
    assert out["acct"] == "~/.claude-personal"


@pytest.mark.skipif(sys.platform == "win32" or not os.path.exists("/usr/bin/python3"), reason="POSIX wiring only")
def test_installer_commands_reach_the_hook(tmp_path):
    acct = "~/.claude-personal"
    env = env_for(tmp_path / "fo", tmp_path)
    cmd = fo_install.hook_command(HOOK, python=PY, windows=False, acct=acct)
    subprocess.run(cmd, shell=True, input=pre(), env=env, timeout=5)
    sl = fo_install.wrap_prefix(HOOK, acct) + "/bin/cat"
    r = subprocess.run(sl, shell=True, input=open(STATUSLINE, "rb").read(), env=env, capture_output=True, timeout=5)
    assert r.returncode == 0 and r.stdout == open(STATUSLINE, "rb").read()
    assert [l["acct"] for l in lines(tmp_path / "fo")] == [acct, acct]
