import io
import shlex
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import cl  # noqa: E402
import fo_install as fi  # noqa: E402
from home_env import home_vars  # noqa: E402

TEAM = {"dir": "~/.claude", "label": "Team"}
PRO = {"dir": "~/.claude-personal", "label": "Pro"}
APP = os.path.abspath("/Users/p/code/app")  # cl abspaths its cwd, so on Windows this gains a drive letter


def env_with(tmp_path, accounts=(TEAM, PRO), rules=()):
    fo = tmp_path / ".flowobserve"
    fo.mkdir(exist_ok=True)
    (fo / "accounts.json").write_text(json.dumps({"accounts": list(accounts), "rules": list(rules)}))
    return {**home_vars(tmp_path), "FO_HOME": str(fo), "FO_PORT": "4317", "CLAUDE_CONFIG_DIR": "/stale", "PATH": "/usr/bin:/bin"}


def usage(team, pro, at=0.9):
    row = lambda a, v: {"label": a["label"], "dir": a["dir"], "fiveHour": v, "sevenDay": None if v is None else 0.1, "at": None if v is None else 1}
    return {"accounts": [row(TEAM, team), row(PRO, pro)], "switchAt": at}


def run(argv, env, cwd=APP, usage_doc=None, session=None):
    calls, execs = [], []

    def fetch(url):
        calls.append(url)
        return session if "?session=" in url else usage_doc

    out, err = io.StringIO(), io.StringIO()
    rc = cl.main(argv, env=env, cwd=cwd, fetch=fetch, execvpe=lambda f, a, e: execs.append((f, a, e)), out=out, err=err)
    return rc, err.getvalue().strip(), execs, calls, out.getvalue()


def test_flag_wins_and_sets_the_config_dir(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, calls, _ = run(["--pro", "--resume", "abc"], env, usage_doc=usage(0.1, 0.9))
    assert rc == 0 and line == "cl → Pro (--account)" and calls == []
    [(f, args, e)] = execs
    assert f == "claude" and args == ["claude", "--resume", "abc"]
    assert e["CLAUDE_CONFIG_DIR"] == str(tmp_path / ".claude-personal")
    assert run(["--account", "team"], env)[1] == "cl → Team (--account)"
    rc, line, execs, _, _ = run(["--account", "Lab"], env)
    assert rc == 2 and "no account labelled Lab" in line and execs == []


def test_resume_stays_on_the_sessions_account_over_a_rule(tmp_path):
    env = env_with(tmp_path, rules=[{"path": "~/clients", "label": "Team"}])
    rc, line, execs, calls, _ = run(["--resume", "abc"], env, cwd=str(tmp_path / "clients"), session={"label": "Pro", "dir": "~/.claude-personal"})
    assert line == "cl → Pro (resume: the session's account)"
    assert calls == ["http://127.0.0.1:4317/api/usage?session=abc"]
    assert execs[0][1] == ["claude", "--resume", "abc"]


def test_longest_matching_rule_wins(tmp_path):
    env = env_with(tmp_path, rules=[{"path": "~/clients", "label": "Pro"}, {"path": "~/clients/big", "label": "Team"}])
    assert run([], env, cwd=str(tmp_path / "clients" / "big" / "x"))[1] == "cl → Team (rule ~/clients/big)"
    assert run([], env, cwd=str(tmp_path / "clients" / "small"))[1] == "cl → Pro (rule ~/clients)"
    assert run([], env, cwd=str(tmp_path / "clientsX"), usage_doc=usage(0.41, 0.12))[1] == "cl → Team (5h 41% · Pro 12%)"


def test_usage_pick(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, _, _ = run([], env, usage_doc=usage(0.41, 0.12))
    assert line == "cl → Team (5h 41% · Pro 12%)" and "CLAUDE_CONFIG_DIR" not in execs[0][2]
    assert run([], env, usage_doc=usage(None, 0.12))[1] == "cl → Team (5h — · Pro 12%)"
    assert run([], env, usage_doc=usage(0.93, 0.12))[1] == "cl → Pro (Team 5h 93%)"
    assert run([], env, usage_doc=usage(0.93, None))[1] == "cl → Team (all accounts near the 5h limit: 5h 93% · Pro —)"
    assert run([], env, usage_doc=usage(0.95, 0.93))[1] == "cl → Team (all accounts near the 5h limit: 5h 95% · Pro 93%)"


def test_server_down_or_no_accounts_file_means_default(tmp_path):
    env = env_with(tmp_path)
    assert run([], env, usage_doc=None)[1] == "cl → Team (flowobserve not reachable)"
    os.remove(os.path.join(env["FO_HOME"], "accounts.json"))
    rc, line, execs, calls, _ = run([], env)
    assert line == "cl → claude (no accounts file)" and calls == [] and "CLAUDE_CONFIG_DIR" not in execs[0][2]


def test_dry_run_prints_the_command_and_starts_nothing(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, _, out = run(["--dry-run", "--pro", "-c"], env)
    assert rc == 0 and execs == [] and line == "cl → Pro (--account)"
    assert out == "CLAUDE_CONFIG_DIR=%s claude -c\n" % shlex.quote(str(tmp_path / ".claude-personal"))


def test_missing_claude_exits_127(tmp_path):
    def boom(f, a, e):
        raise OSError("not found")
    rc = cl.main([], env=env_with(tmp_path), cwd="/", fetch=lambda u: None, execvpe=boom, out=io.StringIO(), err=io.StringIO())
    assert rc == 127


def test_fetch_json_talks_to_a_local_server_and_ignores_proxies(monkeypatch):
    body = json.dumps(usage(0.2, 0.3)).encode()

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200 if self.path == "/api/usage" else 404)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    try:
        assert cl.fetch_json("http://127.0.0.1:%d/api/usage" % srv.server_port) == usage(0.2, 0.3)
        assert cl.fetch_json("http://127.0.0.1:%d/nope" % srv.server_port) is None
    finally:
        srv.shutdown()
    assert cl.fetch_json("http://127.0.0.1:9/api/usage") is None


def test_installer_keeps_rules(tmp_path):
    rule = {"path": "~/clients", "label": "Team"}
    d = fi.add_account({"accounts": [], "rules": [rule]}, "~/.claude", "Team")
    assert fi.remove_account(d, "~/.claude")["rules"] == [rule] == d["rules"]


def test_rule_with_an_unknown_account_warns_and_falls_through(tmp_path):
    env = env_with(tmp_path, rules=[{"path": "~/clients", "label": "Teem"}])
    (tmp_path / "clients").mkdir()
    rc, text, execs, _, _ = run([], env, cwd=str(tmp_path / "clients"), usage_doc=usage(0.41, 0.12))
    assert rc == 0 and execs
    assert text.splitlines() == ["cl: rule ~/clients names unknown account Teem", "cl → Team (5h 41% · Pro 12%)"]


def test_rule_matches_through_a_symlink(tmp_path):
    real = tmp_path / "real"
    (real / "sub").mkdir(parents=True)
    os.symlink(real, tmp_path / "clients")
    env = env_with(tmp_path, rules=[{"path": "~/clients", "label": "Pro"}])
    assert run([], env, cwd=str(real / "sub"))[1] == "cl → Pro (rule ~/clients)"


def test_resume_picks_the_account_by_dir_before_label(tmp_path):
    a = {"dir": "~/.claude", "label": "work"}
    b = {"dir": "~/.claude-b", "label": "Work"}
    env = env_with(tmp_path, accounts=(a, b))
    rc, line, *_ = run(["--resume", "abc"], env, session={"label": "work", "dir": "~/.claude-b"})
    assert line == "cl → Work (resume: the session's account)"


def test_shebang_is_env_python3():
    with open(os.path.join(HERE, "cl.py")) as f:
        assert f.readline().strip() == "#!/usr/bin/env python3"


def transcript(tmp_path, acct_dir, name, mtime, cwd=APP):
    import re
    d = tmp_path / acct_dir / "projects" / re.sub(r"[^A-Za-z0-9]", "-", cwd)
    d.mkdir(parents=True, exist_ok=True)
    f = d / (name + ".jsonl")
    f.write_text("{}\n")
    os.utime(f, (mtime, mtime))
    return f


def test_resume_equals_form_asks_the_server(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, calls, _ = run(["--resume=abc"], env, session={"label": "Pro", "dir": "~/.claude-personal"})
    assert line == "cl → Pro (resume: the session's account)"
    assert calls == ["http://127.0.0.1:4317/api/usage?session=abc"]


def test_resume_falls_back_to_transcripts_when_the_server_is_down(tmp_path):
    env = env_with(tmp_path)
    transcript(tmp_path, ".claude-personal", "sess-1", 100)
    for argv in (["--resume", "sess-1"], ["--resume=sess-1"], ["-r", "sess-1"]):
        rc, line, execs, _, _ = run(argv, env, usage_doc=None, session=None)
        assert line == "cl → Pro (resume: found the transcript)", argv
        assert execs[0][2]["CLAUDE_CONFIG_DIR"] == str(tmp_path / ".claude-personal")
    # unknown to both: falls through to the usual order
    assert run(["--resume", "nope"], env, usage_doc=None)[1] == "cl → Team (flowobserve not reachable)"


def test_continue_picks_the_account_with_the_newest_transcript_here(tmp_path):
    env = env_with(tmp_path)
    transcript(tmp_path, ".claude", "a", 100)
    transcript(tmp_path, ".claude-personal", "b", 200)
    transcript(tmp_path, ".claude", "other", 900, cwd=os.path.abspath("/Users/p/elsewhere"))
    for argv in (["-c"], ["--continue"]):
        rc, line, execs, calls, _ = run(argv, env, usage_doc=usage(0.95, 0.1))
        assert line == "cl → Pro (continue: latest conversation here)"
        assert calls == []
    transcript(tmp_path, ".claude", "c", 300)
    assert run(["--continue"], env, usage_doc=usage(0.95, 0.1))[1] == "cl → Team (continue: latest conversation here)"


def test_continue_with_no_transcripts_means_default_without_usage(tmp_path):
    env = env_with(tmp_path)
    rc, line, execs, calls, _ = run(["-c"], env, usage_doc=usage(0.95, 0.1))
    assert line == "cl → Team (continue: no conversation here, default account)" and calls == []


def test_bare_resume_skips_usage(tmp_path):
    env = env_with(tmp_path)
    transcript(tmp_path, ".claude-personal", "b", 200)
    for argv in (["--resume"], ["-r"]):
        rc, line, execs, calls, _ = run(argv, env, usage_doc=usage(0.95, 0.1))
        assert line == "cl → Pro (continue: latest conversation here)" and calls == []
