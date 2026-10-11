import json, subprocess
from helper_fixtures import TOKEN, fo_home, root  # noqa: F401 (fixtures)
import fo_open as fo

U = "8c1f0e2a-1111-4222-8333-444455556666"


class Rig:
    def __init__(self, osa=None):
        self.osa_calls, self.notes, self.rows = [], [], []
        self._osa = osa or (lambda script, args: "ok")

    def osascript(self, script, args):
        self.osa_calls.append((script, args))
        return self._osa(script, args)

    def run(self, url):
        rc = fo.main([url], osascript=self.osascript, notify=self.notes.append,
                     spool=self.rows.append, now=lambda: 1.0)
        assert rc == 0
        return rc


def _row_ok(rig):
    assert len(rig.rows) == 1
    r = rig.rows[0]
    assert r["src"] == "helper" and r["event"] == "helper"
    return r["payload"]


def test_missing_or_wrong_token_is_ignored(fo_home):
    for url in ["flowobserve://open?path=app", "flowobserve://open?path=app&t=" + "0" * 64]:
        rig = Rig()
        rig.run(url)
        assert rig.notes == ["Link not from your flowobserve board — ignored"]
        assert rig.osa_calls == []


def test_rejected_url_notifies_once_and_spools(fo_home):
    rig = Rig()
    rig.run(f"flowobserve://open?path=../etc&t={TOKEN}")
    assert len(rig.notes) == 1 and rig.osa_calls == []
    p = _row_ok(rig)
    assert p["ok"] is False and p["error"] and p["action"]


def test_iterm_missing_notifies_install(fo_home):
    for exc in [FileNotFoundError("osascript"),
                # what osascript prints when no app has iTerm2's bundle id
                subprocess.CalledProcessError(1, "osascript", stderr='5:38: syntax error: Can’t get application id "com.googlecode.iterm2". (-1728)')]:
        def boom(script, args, exc=exc):
            raise exc
        rig = Rig(boom)
        rig.run(f"flowobserve://open?path=app&t={TOKEN}")
        assert rig.notes == ["Install iTerm2 to open sessions here"]
        assert _row_ok(rig)["ok"] is False


def test_script_error_is_not_reported_as_missing_iterm(fo_home):
    def boom(script, args):
        raise subprocess.CalledProcessError(1, "osascript", stderr='193:195: syntax error: Expected “,” but found property. (-2741)')
    rig = Rig(boom)
    rig.run(f"flowobserve://open?path=app&t={TOKEN}")
    assert rig.notes == ["iTerm2 action failed"]

def test_other_minus_1728_is_not_reported_as_missing_iterm(fo_home):
    def boom(script, args):
        raise subprocess.CalledProcessError(1, "osascript", stderr="192:207: execution error: Can’t get current session of missing value. (-1728)")
    rig = Rig(boom)
    rig.run(f"flowobserve://open?path=app&t={TOKEN}")
    assert rig.notes == ["iTerm2 action failed"]

def test_missing_folder(fo_home):
    rig = Rig()
    rig.run(f"flowobserve://open?path=nope&t={TOKEN}")
    assert rig.notes == ["nope not found — SSD mounted?"]
    assert rig.osa_calls == []


def test_jump_missing(fo_home):
    rig = Rig(lambda s, a: "missing")
    rig.run(f"flowobserve://jump?iterm=w0t0p0:{U}&t={TOKEN}")
    assert rig.notes == ["Session closed — Restore it from Open"]
    assert rig.osa_calls[0][1][0] == U


def test_open_success_calls_osascript_and_spools_ok(fo_home):
    rig = Rig(lambda s, a: "SESSIONID")
    rig.run(f"flowobserve://open?path=app&t={TOKEN}")
    assert len(rig.osa_calls) == 2
    assert "claude" in rig.osa_calls[1][1][0]
    assert _row_ok(rig)["ok"] is True


def test_missing_helper_json(tmp_path, monkeypatch):
    monkeypatch.setenv("FO_HOME", str(tmp_path / "empty"))
    rig = Rig()
    rig.run(f"flowobserve://open?path=app&t={TOKEN}")
    assert rig.notes == ["Run scripts/install.sh with FO_PROJECTS_ROOT set"]
    assert rig.osa_calls == []


def test_runs_isolated_from_its_own_folder(fo_home, tmp_path):
    # The app bundle runs `/usr/bin/python3 -I fo_open.py <url>`; -I drops the script's folder from
    # sys.path, so the helper must still find fo_iterm and reach main(). Evidence main ran: its spool row.
    import glob, os
    from helper_fixtures import HELPER
    r = subprocess.run(["/usr/bin/python3", "-I", os.path.join(HELPER, "fo_open.py"),
                        f"flowobserve://jump?iterm=x&t={TOKEN}"],
                       cwd=str(tmp_path), env={**os.environ, "FO_HOME": fo_home, "FO_HELPER_QUIET": "1"},
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0 and r.stderr == ""
    rows = [json.loads(l) for f in glob.glob(os.path.join(fo_home, "spool", "*.jsonl")) for l in open(f)]
    assert [(x["payload"]["action"], x["payload"]["ok"]) for x in rows] == [("jump", False)]


def test_quiet_env_skips_the_real_notification(monkeypatch):
    import fo_iterm
    calls = []
    monkeypatch.setattr(fo_iterm, "osascript", lambda script, args: calls.append(args))
    monkeypatch.setenv("FO_HELPER_QUIET", "1")
    fo_iterm.notify("hi")
    assert calls == []
    monkeypatch.delenv("FO_HELPER_QUIET")
    fo_iterm.notify("hi")
    assert calls == [["hi"]]
