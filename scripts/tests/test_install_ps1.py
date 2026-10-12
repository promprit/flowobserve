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


def _claude(tmp_path):
    claude = tmp_path / "claude"
    (claude / "jev").mkdir(parents=True)
    (claude / "settings.json").write_text("{}\n", encoding="utf-8")
    (claude / "jev" / "chain.json").write_text("{}\n", encoding="utf-8")
    return claude


def test_start_sets_vscode_edition():
    text = open(os.path.join(REPO, "scripts", "start.ps1"), encoding="ascii").read()
    assert "$env:FO_EDITION = 'vscode'" in text


def test_setup_writes_helper_json_for_projects_root(tmp_path):
    home, claude, root = tmp_path / ".flowobserve", _claude(tmp_path), tmp_path / "projects"
    root.mkdir()
    env = dict(os.environ, FO_HOME=str(home), CLAUDE_DIR=str(claude), FO_SKIP_BUILD="1",
               FO_PROJECTS_ROOT=str(root))
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        os.path.join(REPO, "scripts", "setup.ps1")], env=env, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    h = json.loads((home / "helper.json").read_text(encoding="utf-8"))
    assert os.path.normcase(h["root"]) == os.path.normcase(str(root))
    assert len(h["token"]) == 64 and int(h["token"], 16) >= 0


def test_find_fonode_missing_fo_node_returns_nothing_without_error(tmp_path):
    cmd = ". (Join-Path $env:FO_SCRIPTS 'fo_win.ps1'); $r = Find-FoNode; if ($null -ne $r) { 'got:' + $r }"
    env = dict(os.environ, FO_SCRIPTS=os.path.join(REPO, "scripts"), FO_NODE=str(tmp_path / "nope" / "node.exe"))
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], env=env,
                       capture_output=True, text=True, timeout=60)
    assert r.stdout.strip() == "" and r.stderr.strip() == "", r.stdout + r.stderr


def test_setup_fo_home_guard_checks_leaf_case_insensitively(tmp_path):
    claude = _claude(tmp_path)
    r = ps("setup.ps1", tmp_path / "evil.flowobserve", claude)
    assert r.returncode != 0 and "FO_HOME must end in .flowobserve" in r.stdout + r.stderr
    r = ps("setup.ps1", tmp_path / ".FlowObserve", claude)
    assert "FO_HOME must end in .flowobserve" not in r.stdout + r.stderr, r.stdout + r.stderr


def _fallback_block():
    text = open(os.path.join(REPO, "scripts", "start.ps1"), encoding="ascii").read()
    assert "# fo-root-fallback begin" in text and "# fo-root-fallback end" in text, "helper.json root fallback missing"
    return text.split("# fo-root-fallback begin")[1].split("# fo-root-fallback end")[0]


def _run_fallback(tmp_path, helper_text, preset):
    home = tmp_path / ".flowobserve"
    home.mkdir(exist_ok=True)
    (home / "helper.json").unlink(missing_ok=True)
    if helper_text is not None:
        (home / "helper.json").write_text(helper_text, encoding="utf-8")
    cmd = "$ErrorActionPreference='Stop'; " + _fallback_block() + "; Write-Output ('ROOT=' + $env:FO_PROJECTS_ROOT)"
    env = {k: v for k, v in os.environ.items() if k != "FO_PROJECTS_ROOT"}
    env["FO_HOME"] = str(home)
    if preset is not None:
        env["FO_PROJECTS_ROOT"] = preset
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], env=env,
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    return r.stdout.strip().split("ROOT=", 1)[1]


def test_start_falls_back_to_helper_json_root(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    got = _run_fallback(tmp_path, json.dumps({"root": str(root), "token": "x"}), None)
    assert os.path.normcase(got) == os.path.normcase(str(root))


def test_start_fallback_keeps_set_root_and_ignores_bad_helper(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    assert _run_fallback(tmp_path, json.dumps({"root": str(root)}), "preset-root") == "preset-root"
    assert _run_fallback(tmp_path, json.dumps({"root": str(tmp_path / "missing")}), None) == ""
    assert _run_fallback(tmp_path, "{not json", None) == ""
    assert _run_fallback(tmp_path, None, None) == ""


def test_setup_missing_projects_root_warns_and_exits_zero(tmp_path):
    home, claude, root = tmp_path / ".flowobserve", _claude(tmp_path), tmp_path / "nope"
    env = dict(os.environ, FO_HOME=str(home), CLAUDE_DIR=str(claude), FO_SKIP_BUILD="1",
               FO_PROJECTS_ROOT=str(root))
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        os.path.join(REPO, "scripts", "setup.ps1")], env=env, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert f"warn: FO_PROJECTS_ROOT is not an absolute directory: {root}; helper.json not written" in r.stdout
    assert not (home / "helper.json").exists()


def test_setup_relative_projects_root_warns_and_exits_zero(tmp_path):
    home, claude = tmp_path / ".flowobserve", _claude(tmp_path)
    cwd = tmp_path / "cwd"
    (cwd / "src").mkdir(parents=True)
    env = dict(os.environ, FO_HOME=str(home), CLAUDE_DIR=str(claude), FO_SKIP_BUILD="1", FO_PROJECTS_ROOT="src")
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        os.path.join(REPO, "scripts", "setup.ps1")], env=env, cwd=str(cwd),
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "warn: FO_PROJECTS_ROOT is not an absolute directory: src; helper.json not written" in r.stdout
    assert not (home / "helper.json").exists()
