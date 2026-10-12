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
