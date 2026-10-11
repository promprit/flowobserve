import json, os, subprocess, time
from conftest import HOOK, PY

SID = "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b"
ITERM = "w0t1p2:1B2C3D4E-0000-4000-8000-00000000ABCD"

def run(payload, home, **env):
    e = dict(os.environ, FO_HOME=str(home))
    for k in ("CLAUDE_CODE_ENTRYPOINT", "TERM_PROGRAM", "ITERM_SESSION_ID"):
        e.pop(k, None)
    e.update(env)
    return subprocess.run([PY, "-S", HOOK], input=json.dumps(payload).encode(),
                          capture_output=True, env=e, timeout=5)

def lines(home):
    p = os.path.join(str(home), "spool", time.strftime("%Y-%m-%d") + ".jsonl")
    return [json.loads(l) for l in open(p)]

def start():
    return {"session_id": SID, "cwd": "/Users/p/app", "hook_event_name": "SessionStart", "source": "startup"}

def test_session_start_records_term(tmp_path):
    r = run(start(), tmp_path, CLAUDE_CODE_ENTRYPOINT="cli", TERM_PROGRAM="iTerm.app", ITERM_SESSION_ID=ITERM)
    assert r.returncode == 0
    [l] = lines(tmp_path)
    assert l["term"] == {"entry": "cli", "program": "iTerm.app", "iterm": ITERM}

def test_unset_env_gives_nulls(tmp_path):
    run(start(), tmp_path)
    [l] = lines(tmp_path)
    assert l["term"] == {"entry": None, "program": None, "iterm": None}

def test_other_events_have_no_term(tmp_path):
    run(dict(start(), hook_event_name="Stop"), tmp_path, TERM_PROGRAM="iTerm.app")
    [l] = lines(tmp_path)
    assert "term" not in l

def test_term_values_are_capped(tmp_path):
    run(start(), tmp_path, TERM_PROGRAM="x" * 500)
    [l] = lines(tmp_path)
    assert len(l["term"]["program"]) == 64
