import json
import os
import subprocess
import sys

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows installer")
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS = ("setup.ps1", "start.ps1", "uninstall.ps1", "fo_win.ps1")
FORBIDDEN = ("Register-ScheduledTask", "ScheduledTask", "wscript", ".vbs", "CreateShortcut",
             "Startup", "Stop-Process", "-WindowStyle Hidden", "Win32_Process")


def ps(script, home, claude):
    env = dict(os.environ, FO_HOME=str(home), CLAUDE_DIR=str(claude), FO_SKIP_BUILD="1")
    return subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                           os.path.join(REPO, "scripts", script)], env=env, capture_output=True, text=True, timeout=120)


def test_setup_then_uninstall_round_trip(tmp_path):
    home, claude = tmp_path / ".flowobserve", tmp_path / "claude"
    (claude / "jev").mkdir(parents=True)
    (claude / "settings.json").write_text("{}\n", encoding="utf-8")
    (claude / "jev" / "chain.json").write_text("{}\n", encoding="utf-8")

    r = ps("setup.ps1", home, claude)
    assert r.returncode == 0, r.stdout + r.stderr
    for f in ("fo_hook.py", "fo_derive.py", "fo_redact.py"):
        assert (home / "bin" / f).is_file()
    assert not (home / "bin" / "pnpm-shim").exists()  # skipped build creates no shim
    assert list(home.rglob("*.vbs")) == []
    s = json.loads((claude / "settings.json").read_text(encoding="utf-8"))
    cmd = s["hooks"]["SessionStart"][-1]["hooks"][0]["command"]
    assert "-X utf8 -S" in cmd and "/.flowobserve/bin/fo_hook.py" in cmd and "/bin/sh" not in cmd
    assert "statusLine" not in s

    r = ps("uninstall.ps1", home, claude)
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads((claude / "settings.json").read_text(encoding="utf-8")) in ({}, {"hooks": {}})  # unwire keeps an empty hooks key


def test_scripts_parse_and_avoid_persistence_patterns():
    for name in SCRIPTS:
        path = os.path.join(REPO, "scripts", name)
        cmd = ("$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile("
               "$env:FO_PARSE,[ref]$t,[ref]$e);$e.Count")
        r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                           env=dict(os.environ, FO_PARSE=path), capture_output=True, text=True, timeout=60)
        assert r.stdout.strip() == "0", f"{name}: {r.stdout}{r.stderr}"
        text = open(path, encoding="ascii").read()
        for bad in FORBIDDEN:
            assert bad not in text, f"{name} contains {bad}"
