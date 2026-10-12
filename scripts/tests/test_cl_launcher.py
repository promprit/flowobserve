import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import cl  # noqa: E402
import fo_install as fi  # noqa: E402

TEAM = {"dir": "~/.claude", "label": "Team"}
PRO = {"dir": "~/.claude-personal", "label": "Pro"}


def env_with(tmp_path, accounts=(TEAM, PRO), rules=()):
    fo = tmp_path / ".flowobserve"
    fo.mkdir(exist_ok=True)
    (fo / "accounts.json").write_text(json.dumps({"accounts": list(accounts), "rules": list(rules)}))
    return {"HOME": str(tmp_path), "FO_HOME": str(fo), "FO_PORT": "4317", "CLAUDE_CONFIG_DIR": "/stale", "PATH": "/usr/bin:/bin"}


def usage(team, pro, at=0.9):
    row = lambda a, v: {"label": a["label"], "dir": a["dir"], "fiveHour": v, "sevenDay": None if v is None else 0.1, "at": None if v is None else 1}
    return {"accounts": [row(TEAM, team), row(PRO, pro)], "switchAt": at}


def run(argv, env, cwd="/Users/p/code/app", usage_doc=None, session=None):
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
    assert out == "CLAUDE_CONFIG_DIR=%s claude -c\n" % (tmp_path / ".claude-personal")


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
