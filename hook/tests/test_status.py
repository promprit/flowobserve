import json
import os
import subprocess
import sys

STATUS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fo_status.py")


def run(stdin):
    return subprocess.run([sys.executable, "-S", STATUS], input=stdin.encode(), capture_output=True)


def test_model_and_five_hour_percent():
    r = run(json.dumps({"model": {"display_name": "Opus"}, "rate_limits": {"five_hour": {"used_percentage": 41.4}}}))
    assert (r.returncode, r.stdout) == (0, "Opus · 5h 41%\n".encode())


def test_model_only_without_rate_limits():
    r = run(json.dumps({"model": {"display_name": "Opus"}}))
    assert (r.returncode, r.stdout) == (0, b"Opus\n")


def test_bad_json_prints_claude_and_exits_0():
    r = run("not json")
    assert (r.returncode, r.stdout) == (0, b"claude\n")


def test_missing_model_prints_claude():
    assert run("{}").stdout == b"claude\n"


def test_null_rate_limits_keeps_model():
    r = run(json.dumps({"model": {"display_name": "Opus"}, "rate_limits": None}))
    assert (r.returncode, r.stdout) == (0, b"Opus\n")


def test_null_five_hour_keeps_model():
    r = run(json.dumps({"model": {"display_name": "Opus"}, "rate_limits": {"five_hour": None}}))
    assert (r.returncode, r.stdout) == (0, b"Opus\n")


def test_disabled_marker_prints_but_records_nothing(tmp_path):
    (tmp_path / "disabled").write_text("")
    payload = json.dumps({"session_id": "11111111-1111-4111-8111-111111111111", "model": {"display_name": "Opus"},
                          "rate_limits": {"five_hour": {"used_percentage": 40, "resets_at": 2000000000}}}).encode()
    r = subprocess.run([sys.executable, "-S", STATUS], input=payload, env=dict(os.environ, FO_HOME=str(tmp_path)),
                       capture_output=True)
    assert r.returncode == 0
    assert r.stdout.strip()                       # statusline still shown
    assert not (tmp_path / "spool").exists()      # nothing recorded


def _through_wrapper(home):
    """The installed statusline path: fo_hook.py --usage -- <fo_status.py> (the wrapper records, fo_status only prints)."""
    hook = os.path.join(os.path.dirname(STATUS), "fo_hook.py")
    payload = json.dumps({"session_id": "11111111-1111-4111-8111-111111111111", "model": {"display_name": "Opus"},
                          "rate_limits": {"five_hour": {"used_percentage": 40, "resets_at": 2000000000}}}).encode()
    return subprocess.run([sys.executable, "-S", hook, "--usage", "--", sys.executable, "-S", STATUS], input=payload,
                          env=dict(os.environ, FO_HOME=str(home)), capture_output=True)


def test_wrapper_records_usage_when_enabled(tmp_path):
    r = _through_wrapper(tmp_path)
    assert r.stdout.strip() and (tmp_path / "spool").exists()


def test_wrapper_with_disabled_marker_prints_but_records_nothing(tmp_path):
    (tmp_path / "disabled").write_text("")
    r = _through_wrapper(tmp_path)
    assert r.returncode == 0 and r.stdout.strip()
    assert not (tmp_path / "spool").exists()
