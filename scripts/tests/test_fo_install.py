import json
import os
import plistlib
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import fo_install as fi
import pytest

HOOK = "/Users/p/.flowobserve/bin/fo_hook.py"
HUD = "bash -c 'exec node /x/hud/dist/index.js'"


def base_settings():
    return {
        "env": {"A": "1"},
        "hooks": {
            "PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "/x/pretool-chain.sh", "timeout": 20}]}],
            "Stop": [{"hooks": [{"type": "command", "command": "/x/other.sh", "timeout": 10}]}],
        },
        "statusLine": {"type": "command", "command": HUD, "padding": 0},
    }


def base_chain():
    return {"pretool": [{"name": "scope-lock", "cmd": ["a"]}, {"name": "ruflo-pre-bash", "cmd": ["b"], "observe": True}],
            "prompt": [{"name": "jev-route", "cmd": ["c"]}]}


def fo_cmds(d, event):
    return [h["command"] for g in d["hooks"].get(event, []) for h in g["hooks"] if fi.MARKER in h["command"]]


def test_hook_command_is_exit0_wrapped_and_silent():
    c = fi.hook_command(HOOK, windows=False)
    assert c.startswith("/bin/sh -c '") and c.endswith("; exit 0'")
    assert HOOK in c and ">/dev/null 2>&1" in c


def test_wire_settings_adds_each_event_last():
    d = fi.wire_settings(base_settings(), HOOK, windows=False)
    for ev in fi.SETTINGS_EVENTS:
        assert len(fo_cmds(d, ev)) == 1, ev
        last = d["hooks"][ev][-1]
        assert fi.MARKER in last["hooks"][0]["command"]
        assert last["hooks"][0]["timeout"] == 2
        assert ("matcher" in last) == (ev in fi.TOOL_EVENTS)
    assert d["hooks"]["Stop"][0]["hooks"][0]["command"] == "/x/other.sh"
    assert fo_cmds(d, "PreToolUse") == [] and "UserPromptSubmit" not in d["hooks"]


def test_wire_settings_wraps_statusline_and_keeps_keys():
    sl = fi.wire_settings(base_settings(), HOOK, windows=False)["statusLine"]
    assert sl["command"] == fi.wrap_prefix(HOOK) + HUD
    assert sl["padding"] == 0 and sl["type"] == "command"


def test_wire_is_idempotent():
    once = fi.wire_settings(base_settings(), HOOK, windows=False)
    assert fi.wire_settings(json.loads(json.dumps(once)), HOOK, windows=False) == once


def test_wire_does_not_mutate_input():
    s = base_settings()
    fi.wire_settings(s, HOOK, windows=False)
    assert s == base_settings()


def test_unwire_settings_restores_original():
    assert fi.unwire_settings(fi.wire_settings(base_settings(), HOOK, windows=False)) == base_settings()


def test_unwire_drops_events_that_only_had_our_hook():
    assert fi.unwire_settings(fi.wire_settings({"hooks": {}}, HOOK, windows=False)) == {"hooks": {}}


def test_wire_without_statusline_leaves_it_absent():
    s = base_settings()
    del s["statusLine"]
    assert "statusLine" not in fi.wire_settings(s, HOOK, windows=False)


def test_wire_chain_appends_observe_stage_last_once():
    c = fi.wire_chain(fi.wire_chain(base_chain(), HOOK), HOOK)
    for kind in ("pretool", "prompt"):
        assert c[kind][-1] == {"name": "flowobserve", "component": "flowobserve", "cmd": ["/usr/bin/python3", "-S", HOOK],
                               "timeout": 1, "observe": True}
        assert sum(1 for s in c[kind] if s["name"] == "flowobserve") == 1
    assert fi.unwire_chain(c) == base_chain()


def test_status_ok_then_warn_when_hud_rewrites_statusline():
    s = fi.wire_settings(base_settings(), HOOK, windows=False)
    c = fi.wire_chain(base_chain(), HOOK)
    assert all(l.startswith("ok ") for l in fi.status(s, c, windows=False))
    s["statusLine"]["command"] = HUD
    assert "warn statusline: not wrapped" in fi.status(s, c, windows=False)


def test_status_flags_claude_office_leftover():
    c = fi.wire_chain(base_chain(), HOOK)
    c["prompt"].insert(0, {"name": "claude-office", "cmd": ["x"], "observe": True})
    assert any(l.startswith("warn ") and "claude-office" in l for l in fi.status(fi.wire_settings(base_settings(), HOOK, windows=False), c, windows=False))


def test_write_json_backs_up_and_skips_unchanged(tmp_path):
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(base_settings(), indent=2) + "\n")
    assert fi.write_json(str(p), base_settings(), 1791000000) is False
    assert list(tmp_path.glob("*.bak-fo-*")) == []
    assert fi.write_json(str(p), fi.wire_settings(base_settings(), HOOK, windows=False), 1791000000) is True
    baks = list(tmp_path.glob("settings.json.bak-fo-*"))
    assert len(baks) == 1 and json.loads(baks[0].read_text()) == base_settings()
    assert fi.MARKER in p.read_text()
    assert not list(tmp_path.glob("*.fo-tmp"))


@pytest.mark.skipif(sys.platform == "win32", reason="launchd plist is macOS-only")
def test_render_plist():
    pl = plistlib.loads(fi.render_plist("/n/bin/node", "/r/flowobserve", "/Users/p/.flowobserve"))
    assert pl["Label"] == "com.promprit.flowobserve"
    assert pl["ProgramArguments"] == ["/n/bin/node", "--disable-warning=ExperimentalWarning", "/r/flowobserve/server/dist/main.js"]
    assert pl["WorkingDirectory"] == "/r/flowobserve/server"
    assert pl["RunAtLoad"] is True
    assert pl["KeepAlive"] == {"PathState": {"/r/flowobserve/server/dist/main.js": True}}
    assert pl["EnvironmentVariables"] == {"FO_HOME": "/Users/p/.flowobserve", "FO_PORT": "4317", "NODE_ENV": "production"}
    assert pl["StandardOutPath"] == pl["StandardErrorPath"] == "/Users/p/.flowobserve/server.log"


def test_render_plist_with_projects_root():
    pl = plistlib.loads(fi.render_plist("/n/bin/node", "/r/flowobserve", "/Users/p/.flowobserve", "/Users/p/Dev/projects"))
    assert pl["EnvironmentVariables"] == {"FO_HOME": "/Users/p/.flowobserve", "FO_PORT": "4317", "NODE_ENV": "production",
                                          "FO_PROJECTS_ROOT": "/Users/p/Dev/projects"}


def run_cli(*args):
    return subprocess.run([sys.executable, os.path.join(HERE, "fo_install.py"), *args], capture_output=True, text=True)


def claude_dir(tmp_path, settings_text):
    (tmp_path / "jev").mkdir()
    (tmp_path / "settings.json").write_text(settings_text)
    (tmp_path / "jev" / "chain.json").write_text(json.dumps(base_chain()))
    return str(tmp_path)


def test_cli_wire_status_unwire_roundtrip(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings()))
    assert run_cli("wire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert fi.MARKER in (tmp_path / "settings.json").read_text()
    assert "flowobserve" in (tmp_path / "jev" / "chain.json").read_text()
    st = run_cli("status", "--claude-dir", d, "--hook", HOOK)
    assert st.returncode == 0 and "warn" not in st.stdout
    assert run_cli("unwire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert json.loads((tmp_path / "settings.json").read_text()) == base_settings()
    assert json.loads((tmp_path / "jev" / "chain.json").read_text()) == base_chain()


def test_cli_invalid_json_aborts_without_write(tmp_path):
    d = claude_dir(tmp_path, "{ not json")
    r = run_cli("wire", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 1 and "settings.json" in r.stderr
    assert (tmp_path / "settings.json").read_text() == "{ not json"
    assert "flowobserve" not in (tmp_path / "jev" / "chain.json").read_text()


def mode(p):
    return os.stat(str(p)).st_mode & 0o777


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no POSIX file modes")
def test_write_preserves_0600_mode(tmp_path):
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(base_settings(), indent=2) + "\n")
    os.chmod(p, 0o600)
    assert fi.write_json(str(p), fi.wire_settings(base_settings(), HOOK, windows=False), 1791000000) is True
    assert mode(p) == 0o600
    baks = list(tmp_path.glob("settings.json.bak-fo-*"))
    assert len(baks) == 1 and mode(baks[0]) == 0o600


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no POSIX file modes")
def test_cli_wire_unwire_keep_0600(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings()))
    os.chmod(tmp_path / "settings.json", 0o600)
    assert run_cli("wire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert mode(tmp_path / "settings.json") == 0o600
    assert run_cli("unwire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert mode(tmp_path / "settings.json") == 0o600
    assert all(mode(b) == 0o600 for b in tmp_path.glob("settings.json.bak-fo-*"))


def snapshot(tmp_path):
    return sorted((str(p.relative_to(tmp_path)), p.read_bytes()) for p in tmp_path.rglob("*") if p.is_file())


def test_dry_run_wire_prints_diff_and_writes_nothing(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings(), indent=2) + "\n")
    before = snapshot(tmp_path)
    r = run_cli("wire", "--dry-run", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 0
    assert "--- a/%s" % (tmp_path / "settings.json") in r.stdout
    assert "+++ b/%s" % (tmp_path / "settings.json") in r.stdout
    assert "--- a/%s" % (tmp_path / "jev" / "chain.json") in r.stdout
    assert fi.MARKER in r.stdout
    assert snapshot(tmp_path) == before


def test_dry_run_unwire_prints_diff_and_writes_nothing(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings(), indent=2) + "\n")
    assert run_cli("wire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    before = snapshot(tmp_path)
    r = run_cli("unwire", "--dry-run", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 0
    assert "--- a/%s" % (tmp_path / "settings.json") in r.stdout
    assert snapshot(tmp_path) == before


def test_dry_run_prints_no_changes_when_identical(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings(), indent=2) + "\n")
    (tmp_path / "jev" / "chain.json").write_text(json.dumps(base_chain(), indent=2) + "\n")
    before = snapshot(tmp_path)
    r = run_cli("unwire", "--dry-run", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 0 and "no changes" in r.stdout
    assert snapshot(tmp_path) == before


def test_malformed_settings_shape_writes_nothing(tmp_path):
    s = base_settings()
    s["hooks"]["Stop"] = "oops"
    d = claude_dir(tmp_path, json.dumps(s))
    before = snapshot(tmp_path)
    r = run_cli("wire", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 1
    assert "fo_install: cannot wire %s" % (tmp_path / "settings.json") in r.stderr or "fo_install: cannot wire" in r.stderr
    assert "Traceback" not in r.stderr
    assert snapshot(tmp_path) == before


def test_malformed_chain_leaves_settings_untouched(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings()))
    (tmp_path / "jev" / "chain.json").write_text(json.dumps({"pretool": ["notobject"], "prompt": []}))
    before = snapshot(tmp_path)
    r = run_cli("wire", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 1 and "fo_install: cannot wire" in r.stderr
    assert "Traceback" not in r.stderr
    assert snapshot(tmp_path) == before


def test_wire_skips_non_simple_statusline_commands():
    for cmd in ("a; b", "a && b", "a | b", "a & b", "a > f", "a < f", "FOO=1 node x.js"):
        s = base_settings()
        s["statusLine"]["command"] = cmd
        out = fi.wire_settings(s, HOOK, windows=False)
        assert out["statusLine"]["command"] == cmd, cmd
        assert "warn statusline: not a simple command" in fi.status(out, fi.wire_chain(base_chain(), HOOK), windows=False), cmd


def test_wire_still_wraps_bash_c_with_quoted_separators():
    s = base_settings()
    s["statusLine"]["command"] = "bash -c 'echo a; echo b | cat'"
    out = fi.wire_settings(s, HOOK, windows=False)
    assert out["statusLine"]["command"] == fi.wrap_prefix(HOOK) + "bash -c 'echo a; echo b | cat'"


COMPACT = (
    '{\n'
    '  "pretool": [\n'
    '    {"name": "scope-lock", "component": "core", "cmd": ["a"], "timeout": 3},\n'
    '    {"name": "flowobserve", "component": "flowobserve", "enabled": false, "cmd": ["/bin/sh", "x"], "observe": true}\n'
    '  ],\n'
    '  "prompt": [\n'
    '    {"name": "jev-route", "component": "jev", "cmd": ["c"], "timeout": 5}\n'
    '  ]\n'
    '}\n'
)


def test_render_chain_keeps_one_stage_per_line():
    assert fi.render_chain(json.loads(COMPACT)) == COMPACT
    assert fi.render_chain({"pretool": [], "prompt": []}) == '{\n  "pretool": [],\n  "prompt": []\n}\n'


def test_wire_chain_replaces_placeholder_stage():
    c = fi.wire_chain(json.loads(COMPACT), HOOK)
    fo = [s for s in c["pretool"] if s["name"] == "flowobserve"]
    assert fo == [{"name": "flowobserve", "component": "flowobserve", "cmd": ["/usr/bin/python3", "-S", HOOK],
                   "timeout": 1, "observe": True}]


def test_dry_run_chain_diff_only_touches_flowobserve_lines(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings()))
    (tmp_path / "jev" / "chain.json").write_text(COMPACT)
    r = run_cli("wire", "--dry-run", "--claude-dir", d, "--hook", HOOK)
    chain_diff = r.stdout.split("--- a/%s" % (tmp_path / "jev" / "chain.json"))[1]
    changed = [l for l in chain_diff.splitlines()[1:] if l[:1] in "+-" and not l.startswith("+++")]
    other = [l for l in changed if "flowobserve" not in l]
    # only a comma may be added to the stage that precedes the appended flowobserve stage
    removed = sorted(l[1:].rstrip(",") for l in other if l.startswith("-"))
    added = sorted(l[1:].rstrip(",") for l in other if l.startswith("+"))
    assert any("flowobserve" in l for l in changed) and removed == added, changed


def test_wire_writes_chain_compact(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings()))
    (tmp_path / "jev" / "chain.json").write_text(COMPACT)
    assert run_cli("wire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    text = (tmp_path / "jev" / "chain.json").read_text()
    assert text == fi.render_chain(json.loads(text))
    assert '    {"name": "scope-lock", "component": "core", "cmd": ["a"], "timeout": 3},\n' in text


def helper_json(tmp_path, root):
    home = tmp_path / ".flowobserve"
    r = run_cli("helper-json", "--home", str(home), "--root", str(root))
    return r, home / "helper.json"


def test_helper_json_writes_root(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    r, p = helper_json(tmp_path, root)
    assert r.returncode == 0, r.stderr
    assert json.loads(p.read_text())["root"] == str(root)


def test_helper_json_refuses_relative_root(tmp_path):
    r, p = helper_json(tmp_path, "relative/dir")
    assert r.returncode != 0 and not p.exists()
    missing = tmp_path / "nope"
    r, p = helper_json(tmp_path, missing)
    assert r.returncode != 0 and not p.exists()


def test_helper_json_token_is_64_hex_and_kept_on_rerun(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    r, p = helper_json(tmp_path, root)
    assert r.returncode == 0, r.stderr
    tok = json.loads(p.read_text())["token"]
    assert len(tok) == 64 and all(c in "0123456789abcdef" for c in tok)
    other = tmp_path / "other"
    other.mkdir()
    r, p = helper_json(tmp_path, other)
    assert r.returncode == 0, r.stderr
    d = json.loads(p.read_text())
    assert d["token"] == tok and d["root"] == str(other)


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no POSIX file modes")
def test_helper_json_mode_0600(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    r, p = helper_json(tmp_path, root)
    assert r.returncode == 0, r.stderr
    assert mode(p) == 0o600
    assert not list(p.parent.glob("*tmp*"))


def test_helper_json_writes_default_create_roots(tmp_path):
    dev = tmp_path / "Dev"; proj = dev / "projects"; proj.mkdir(parents=True)
    fi.write_helper_json(str(tmp_path / "home"), str(proj))
    data = json.loads((tmp_path / "home" / "helper.json").read_text())
    assert data["createRoots"] == [
        {"label": "projects", "path": str(proj)},
        {"label": "Dev", "path": str(dev)},
    ]


def test_helper_json_keeps_user_added_roots_on_reinstall(tmp_path):
    dev = tmp_path / "Dev"; proj = dev / "projects"; proj.mkdir(parents=True)
    other = tmp_path / "Docs"; other.mkdir()
    home = tmp_path / "home"; home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": str(proj), "token": "a" * 64,
        "createRoots": [{"label": "Docs", "path": str(other)}]}))
    fi.write_helper_json(str(home), str(proj))
    labels = [r["label"] for r in json.loads((home / "helper.json").read_text())["createRoots"]]
    assert labels == ["Docs", "projects", "Dev"]


def test_helper_json_no_dev_entry_when_root_not_named_projects(tmp_path):
    proj = tmp_path / "work"; proj.mkdir()
    fi.write_helper_json(str(tmp_path / "home"), str(proj))
    data = json.loads((tmp_path / "home" / "helper.json").read_text())
    assert data["createRoots"] == [{"label": "projects", "path": str(proj)}]


def test_render_plist_with_edition():
    p = plistlib.loads(fi.render_plist("/n", "/r", "/h", "/p", "vscode"))
    assert p["EnvironmentVariables"]["FO_EDITION"] == "vscode"
    assert "FO_EDITION" not in plistlib.loads(fi.render_plist("/n", "/r", "/h"))["EnvironmentVariables"]


def test_plist_edition_reads_installed_value(tmp_path, capsys):
    f = tmp_path / "x.plist"
    f.write_bytes(fi.render_plist("/n", "/r", "/h", None, "iterm"))
    assert fi.main(["plist-edition", "--plist", str(f)]) == 0
    assert capsys.readouterr().out.strip() == "iterm"
    assert fi.main(["plist-edition", "--plist", str(tmp_path / "missing.plist")]) == 0
    assert capsys.readouterr().out == ""


def test_plist_edition_corrupt_plist(tmp_path, capsys):
    f = tmp_path / "x.plist"
    f.write_bytes(fi.render_plist("/n", "/r", "/h", None, "iterm")[:80])
    assert fi.main(["plist-edition", "--plist", str(f)]) == 0
    assert capsys.readouterr().out == ""


def test_render_plist_with_disks():
    p = plistlib.loads(fi.render_plist("/n", "/r", "/h", None, None, "/:System,/Volumes/X:X"))
    assert p["EnvironmentVariables"]["FO_DISKS"] == "/:System,/Volumes/X:X"
    assert "FO_DISKS" not in plistlib.loads(fi.render_plist("/n", "/r", "/h"))["EnvironmentVariables"]


def test_plist_disks_reads_installed_value(tmp_path, capsys):
    f = tmp_path / "x.plist"
    f.write_bytes(fi.render_plist("/n", "/r", "/h", None, None, "/:System,/Volumes/X:X"))
    assert fi.main(["plist-disks", "--plist", str(f)]) == 0
    assert capsys.readouterr().out.strip() == "/:System,/Volumes/X:X"
    assert fi.main(["plist-disks", "--plist", str(tmp_path / "missing.plist")]) == 0
    assert capsys.readouterr().out == ""
    f.write_bytes(fi.render_plist("/n", "/r", "/h", None, None, "/:System")[:80])
    assert fi.main(["plist-disks", "--plist", str(f)]) == 0
    assert capsys.readouterr().out == ""


WIN_HOOK = "C:\\Users\\dev\\.flowobserve\\bin\\fo_hook.py"
WIN_PY = "C:\\Python 3.14\\python.exe"


def test_windows_hook_command_has_no_shell_and_quotes_spaces():
    c = fi.hook_command(WIN_HOOK, python=WIN_PY, windows=True)
    assert c == '"C:/Python 3.14/python.exe" -X utf8 -S "C:/Users/dev/.flowobserve/bin/fo_hook.py"'
    assert "/bin/sh" not in c and fi.MARKER in c


def test_windows_wire_leaves_statusline_and_unwire_restores():
    s = base_settings()
    d = fi.wire_settings(s, WIN_HOOK, python=WIN_PY, windows=True)
    assert d["statusLine"] == s["statusLine"]
    for ev in fi.SETTINGS_EVENTS:
        assert len(fo_cmds(d, ev)) == 1, ev
    assert fi.unwire_settings(d) == s


def test_windows_status_reports_statusline_na():
    d = fi.wire_settings(base_settings(), WIN_HOOK, python=WIN_PY, windows=True)
    c = fi.wire_chain(base_chain(), WIN_HOOK, python=WIN_PY)
    out = fi.status(d, c, windows=True)
    assert "ok statusline: n/a (windows)" in out
    assert [l for l in out if l.startswith("warn")] == []


def test_wire_chain_uses_the_given_python():
    c = fi.wire_chain(base_chain(), WIN_HOOK, python=WIN_PY)
    assert c["pretool"][-1]["cmd"] == [WIN_PY, "-S", WIN_HOOK]
    assert fi.wire_chain(base_chain(), HOOK)["pretool"][-1]["cmd"] == ["/usr/bin/python3", "-S", HOOK]


def test_is_ours_matches_backslash_paths():
    assert fi._is_ours({"command": '"C:\\py.exe" -S "C:\\Users\\dev\\.flowobserve\\bin\\fo_hook.py"'})


@pytest.mark.skipif(sys.platform != "win32", reason="the Windows default interpreter")
def test_cli_python_defaults_to_sys_executable_on_windows(tmp_path):
    d = claude_dir(tmp_path, json.dumps(base_settings()))
    assert run_cli("wire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    cmd = json.loads((tmp_path / "settings.json").read_text())["hooks"]["Stop"][-1]["hooks"][0]["command"]
    assert cmd.startswith('"%s" ' % fi._fwd(sys.executable))


def test_cli_wires_settings_with_utf8_bom(tmp_path):
    d = claude_dir(tmp_path, "")
    (tmp_path / "settings.json").write_bytes(b"\xef\xbb\xbf" + json.dumps(base_settings()).encode())
    r = run_cli("wire", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 0, r.stderr
    assert fi.MARKER in (tmp_path / "settings.json").read_text(encoding="utf-8")


def plain_dir(tmp_path, settings_text=None):
    (tmp_path / "settings.json").write_text(settings_text if settings_text is not None else json.dumps(base_settings()))
    return str(tmp_path)


def test_status_without_chain_says_info_not_warn():
    out = fi.status(fi.wire_settings(base_settings(), HOOK, windows=False), None, windows=False)
    assert "info chain: none (no Dryas in this dir)" in out
    assert not [l for l in out if l.startswith("warn")]
    assert not [l for l in out if l.startswith("ok chain")]


def test_cli_wire_status_unwire_without_chain(tmp_path):
    d = plain_dir(tmp_path)
    assert run_cli("wire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert fi.MARKER in (tmp_path / "settings.json").read_text()
    assert not (tmp_path / "jev").exists()
    st = run_cli("status", "--claude-dir", d, "--hook", HOOK)
    assert st.returncode == 0
    assert "info chain: none (no Dryas in this dir)" in st.stdout.splitlines()
    assert not [l for l in st.stdout.splitlines() if l.startswith("warn")]
    assert run_cli("unwire", "--claude-dir", d, "--hook", HOOK).returncode == 0
    assert json.loads((tmp_path / "settings.json").read_text()) == base_settings()


def test_dry_run_without_chain_diffs_settings_only(tmp_path):
    d = plain_dir(tmp_path, json.dumps(base_settings(), indent=2) + "\n")
    before = snapshot(tmp_path)
    r = run_cli("wire", "--dry-run", "--claude-dir", d, "--hook", HOOK)
    assert r.returncode == 0
    assert "+++ b/%s" % (tmp_path / "settings.json") in r.stdout
    assert "chain.json" not in r.stdout
    assert snapshot(tmp_path) == before


def test_unparsable_chain_is_still_an_error(tmp_path):
    d = plain_dir(tmp_path)
    (tmp_path / "jev").mkdir()
    (tmp_path / "jev" / "chain.json").write_text("{ nope")
    before = snapshot(tmp_path)
    for cmd in ("wire", "status"):
        r = run_cli(cmd, "--claude-dir", d, "--hook", HOOK)
        assert r.returncode == 1 and "chain.json" in r.stderr, cmd
    assert snapshot(tmp_path) == before
