import json
import os
import plistlib
import subprocess
import sys
import pytest

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX-only: /bin/sh wrapper or macOS budget (windows spec §3.6)")

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SETTINGS = {"hooks": {}, "statusLine": {"type": "command", "command": "printf HUD"}}


def fake_node(tmp_path, out, name="node"):
    f = tmp_path / name
    f.write_text("#!/bin/sh\n" + (f"echo {out}\n" if out else "exit 0\n"))
    f.chmod(0o755)
    return str(f)


def sandbox(tmp_path):
    claude = tmp_path / ".claude"
    (claude / "jev").mkdir(parents=True)
    (claude / "settings.json").write_text(json.dumps(SETTINGS))
    (claude / "jev" / "chain.json").write_text(json.dumps({"pretool": [], "prompt": []}))
    env = dict(os.environ, HOME=str(tmp_path), FO_HOME=str(tmp_path / ".flowobserve"), CLAUDE_DIR=str(claude),
               FO_LAUNCH_AGENTS=str(tmp_path / "LA"), FO_NODE=fake_node(tmp_path, "v24.0.0", "node24"), FO_SKIP_BUILD="1", FO_SKIP_LAUNCHCTL="1", FO_SKIP_HELPER="1")
    return claude, env


def run(script, env):
    return subprocess.run(["/bin/sh", os.path.join(REPO, "scripts", script)], capture_output=True, text=True, env=env)


def test_install_twice_then_uninstall(tmp_path):
    claude, env = sandbox(tmp_path)
    fo = tmp_path / ".flowobserve"
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    for n in ("fo_hook.py", "fo_derive.py", "fo_redact.py"):
        assert (fo / "bin" / n).exists()
    pl = plistlib.loads((tmp_path / "LA" / "com.promprit.flowobserve.plist").read_bytes())
    assert pl["EnvironmentVariables"]["FO_HOME"] == str(fo)
    assert pl["WorkingDirectory"] == os.path.join(REPO, "server")
    s = (claude / "settings.json").read_text()
    assert str(fo / "bin" / "fo_hook.py") in s
    assert "warn" not in r.stdout
    baks = sorted(p.name for p in claude.glob("settings.json.bak-fo-*"))
    r2 = run("install.sh", env)
    assert r2.returncode == 0, r2.stderr
    assert (claude / "settings.json").read_text() == s
    assert sorted(p.name for p in claude.glob("settings.json.bak-fo-*")) == baks  # nothing changed, no new backup
    u = run("uninstall.sh", env)
    assert u.returncode == 0, u.stderr
    assert json.loads((claude / "settings.json").read_text()) == SETTINGS
    assert json.loads((claude / "jev" / "chain.json").read_text()) == {"pretool": [], "prompt": []}
    assert not (tmp_path / "LA" / "com.promprit.flowobserve.plist").exists()
    assert (fo / "bin" / "fo_hook.py").exists()  # data and hook copy kept


def test_install_fails_loudly_when_health_never_ok(tmp_path):
    claude, env = sandbox(tmp_path)
    del env["FO_SKIP_LAUNCHCTL"]
    env.update(FO_FAKE_LAUNCHCTL="1", FO_HEALTH_URL="http://127.0.0.1:9/health", FO_HEALTH_TRIES="2")
    r = run("install.sh", env)
    assert r.returncode == 1
    assert "health" in r.stderr and "server.log" in r.stderr
    assert "fo_hook.py" not in (claude / "settings.json").read_text()  # not wired when the server is down


def test_install_rejects_old_node(tmp_path):
    claude, env = sandbox(tmp_path)
    fake = tmp_path / "node"
    fake.write_text("#!/bin/sh\necho v20.1.0\n")
    fake.chmod(0o755)
    env["FO_NODE"] = str(fake)
    r = run("install.sh", env)
    assert r.returncode == 1 and "Node >= 24" in r.stderr


def test_install_rejects_foreign_fo_home(tmp_path):
    claude, env = sandbox(tmp_path)
    env["FO_HOME"] = str(tmp_path / "elsewhere")
    r = run("install.sh", env)
    assert r.returncode == 1 and ".flowobserve" in r.stderr


def test_empty_node_version_fails(tmp_path):
    claude, env = sandbox(tmp_path)
    env["FO_NODE"] = fake_node(tmp_path, "")
    r = run("install.sh", env)
    assert r.returncode == 1 and "cannot read node version" in r.stderr


def test_node_22_rejected(tmp_path):
    claude, env = sandbox(tmp_path)
    env["FO_NODE"] = fake_node(tmp_path, "v22.1.0")
    r = run("install.sh", env)
    assert r.returncode == 1 and "Node >= 24 required" in r.stderr


def test_failed_hook_copy_exits_1(tmp_path):
    claude, env = sandbox(tmp_path)
    bindir = tmp_path / ".flowobserve" / "bin"
    bindir.mkdir(parents=True)
    bindir.chmod(0o555)  # copy destination unwritable
    try:
        r = run("install.sh", env)
    finally:
        bindir.chmod(0o755)
    assert r.returncode == 1 and "copy fo_hook.py failed" in r.stderr
    assert "fo_hook.py" not in (claude / "settings.json").read_text()


def test_projects_root_writes_plist_env_and_helper_json(tmp_path):
    claude, env = sandbox(tmp_path)
    root = tmp_path / "projects"
    root.mkdir()
    env["FO_PROJECTS_ROOT"] = str(root)
    fo = tmp_path / ".flowobserve"
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    pl = plistlib.loads((tmp_path / "LA" / "com.promprit.flowobserve.plist").read_bytes())
    assert pl["EnvironmentVariables"]["FO_PROJECTS_ROOT"] == str(root)
    assert json.loads((fo / "helper.json").read_text())["root"] == str(root)
    assert not (tmp_path / "Applications").exists()  # FO_SKIP_HELPER skips the app build
    u = run("uninstall.sh", env)
    assert u.returncode == 0, u.stderr
    assert not (fo / "helper.json").exists()


def test_no_projects_root_means_no_env_and_no_helper_json(tmp_path):
    claude, env = sandbox(tmp_path)
    env.pop("FO_PROJECTS_ROOT", None)
    fo = tmp_path / ".flowobserve"
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    pl = plistlib.loads((tmp_path / "LA" / "com.promprit.flowobserve.plist").read_bytes())
    assert "FO_PROJECTS_ROOT" not in pl["EnvironmentVariables"]
    assert not (fo / "helper.json").exists()


def test_rerun_without_env_keeps_projects_root(tmp_path):
    claude, env = sandbox(tmp_path)
    root = tmp_path / "projects"
    root.mkdir()
    fo = tmp_path / ".flowobserve"
    env["FO_PROJECTS_ROOT"] = str(root)
    assert run("install.sh", env).returncode == 0
    token = json.loads((fo / "helper.json").read_text())["token"]
    env.pop("FO_PROJECTS_ROOT")
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    pl = plistlib.loads((tmp_path / "LA" / "com.promprit.flowobserve.plist").read_bytes())
    assert pl["EnvironmentVariables"]["FO_PROJECTS_ROOT"] == str(root)
    hj = json.loads((fo / "helper.json").read_text())
    assert hj["token"] == token and hj["root"] == str(root)


def edition_env(tmp_path):
    claude, env = sandbox(tmp_path)
    del env["FO_SKIP_HELPER"]
    marker = tmp_path / "helper-built"
    build = tmp_path / "fake-helper-build.sh"
    build.write_text(f"#!/bin/sh\ntouch {marker}\n")
    env["FO_HELPER_BUILD"] = str(build)
    return env, marker


def installed_edition(tmp_path):
    pl = plistlib.loads((tmp_path / "LA" / "com.promprit.flowobserve.plist").read_bytes())
    return pl["EnvironmentVariables"].get("FO_EDITION")


def run_args(env, *args):
    return subprocess.run(["/bin/sh", os.path.join(REPO, "scripts", "install.sh"), *args], capture_output=True,
                          text=True, env=env, stdin=subprocess.DEVNULL)


def test_edition_vscode_skips_helper(tmp_path):
    env, marker = edition_env(tmp_path)
    r = run_args(env, "--edition", "vscode")
    assert r.returncode == 0, r.stderr
    assert installed_edition(tmp_path) == "vscode"
    assert not marker.exists()


def test_edition_iterm_builds_helper(tmp_path):
    env, marker = edition_env(tmp_path)
    r = run_args(env, "--edition", "iterm")
    assert r.returncode == 0, r.stderr
    assert installed_edition(tmp_path) == "iterm"
    assert marker.exists()


def test_rerun_without_flag_keeps_edition(tmp_path):
    env, _ = edition_env(tmp_path)
    assert run_args(env, "--edition", "vscode").returncode == 0
    r = run_args(env)
    assert r.returncode == 0, r.stderr
    assert installed_edition(tmp_path) == "vscode"


def test_no_flag_first_install_defaults_to_both(tmp_path):
    env, _ = edition_env(tmp_path)
    assert run_args(env).returncode == 0
    assert installed_edition(tmp_path) == "both"


def test_bad_edition_rejected(tmp_path):
    env, _ = edition_env(tmp_path)
    r = run_args(env, "--edition", "foo")
    assert r.returncode == 1
    assert "install: --edition must be vscode, iterm or both" in r.stderr


def test_extension_warning_by_edition(tmp_path):
    env, _ = edition_env(tmp_path)
    bindir = tmp_path / "bin"
    bindir.mkdir()
    code = bindir / "code"
    code.write_text("#!/bin/sh\necho some.other-extension\n")
    code.chmod(0o755)
    env["PATH"] = f"{bindir}:{env['PATH']}"
    msg = "Live usage limits need the Claude Code Usage Status extension"
    r = run_args(env, "--edition", "vscode")
    assert r.returncode == 0, r.stderr
    assert msg in r.stdout
    r = run_args(env, "--edition", "iterm")
    assert r.returncode == 0, r.stderr
    assert msg not in r.stdout + r.stderr


def test_edition_equals_form_and_position(tmp_path):
    env, marker = edition_env(tmp_path)
    r = run_args(env, "--edition=vscode")
    assert r.returncode == 0, r.stderr
    assert installed_edition(tmp_path) == "vscode"
    assert "edition: vscode" in r.stdout
    assert not marker.exists()


def test_edition_missing_value_dies(tmp_path):
    env, _ = edition_env(tmp_path)
    r = run_args(env, "--edition")
    assert r.returncode == 1
    assert "install: --edition needs vscode, iterm or both" in r.stderr


def test_edition_equals_empty_value_dies(tmp_path):
    env, _ = edition_env(tmp_path)
    r = run_args(env, "--edition=")
    assert r.returncode == 1
    assert "install: --edition needs vscode, iterm or both" in r.stderr


def test_edition_empty_separate_value_dies(tmp_path):
    env, _ = edition_env(tmp_path)
    r = run_args(env, "--edition", "")
    assert r.returncode == 1
    assert "install: --edition needs vscode, iterm or both" in r.stderr


def test_unknown_argument_dies(tmp_path):
    env, _ = edition_env(tmp_path)
    r = run_args(env, "--bogus")
    assert r.returncode == 1
    assert "install: unknown argument: --bogus" in r.stderr
    r = run_args(env, "--edition", "vscode", "extra")
    assert r.returncode == 1
    assert "unknown argument: extra" in r.stderr


def test_corrupt_plist_no_flag_falls_back_to_both(tmp_path):
    env, marker = edition_env(tmp_path)
    la = tmp_path / "LA"
    la.mkdir()
    (la / "com.promprit.flowobserve.plist").write_text('<?xml version="1.0"?><plist><dict><key>Env')
    r = run_args(env)
    assert r.returncode == 0, r.stderr
    assert installed_edition(tmp_path) == "both"
    assert marker.exists()


def test_edition_both_builds_helper(tmp_path):
    env, marker = edition_env(tmp_path)
    r = run_args(env, "--edition", "both")
    assert r.returncode == 0, r.stderr
    assert installed_edition(tmp_path) == "both"
    assert marker.exists()


def test_extension_warning_both_and_no_code(tmp_path):
    env, _ = edition_env(tmp_path)
    bindir = tmp_path / "bin"
    bindir.mkdir()
    code = bindir / "code"
    code.write_text("#!/bin/sh\necho some.other-extension\n")
    code.chmod(0o755)
    msg = "Live usage limits need the Claude Code Usage Status extension"
    r = run_args(dict(env, PATH=f"{bindir}:{env['PATH']}"), "--edition", "both")
    assert r.returncode == 0, r.stderr
    assert msg in r.stdout
    r = run_args(dict(env, PATH="/usr/bin:/bin"), "--edition", "both")
    assert r.returncode == 0, r.stderr
    assert msg not in r.stdout + r.stderr


MARK = "/.flowobserve/bin/fo_hook.py"


def accounts(tmp_path):
    return json.loads((tmp_path / ".flowobserve" / "accounts.json").read_text())


def test_install_records_the_default_account(tmp_path):
    claude, env = sandbox(tmp_path)
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    assert accounts(tmp_path) == {"accounts": [{"dir": "~/.claude", "label": "claude"}]}
    assert "FO_ACCT" not in (claude / "settings.json").read_text()


def test_second_dir_install_and_uninstall_keep_the_server(tmp_path):
    claude, env = sandbox(tmp_path)
    assert run("install.sh", env).returncode == 0
    personal = tmp_path / ".claude-personal"
    personal.mkdir()
    (personal / "settings.json").write_text(json.dumps(SETTINGS))
    env2 = dict(env, CLAUDE_DIR=str(personal), FO_ACCOUNT_LABEL="Pro")
    r = run("install.sh", env2)
    assert r.returncode == 0, r.stderr
    assert "info chain: none (no Dryas in this dir)" in r.stdout
    assert accounts(tmp_path) == {"accounts": [{"dir": "~/.claude", "label": "claude"}, {"dir": "~/.claude-personal", "label": "Pro"}]}
    s = json.loads((personal / "settings.json").read_text())
    cmds = [h["command"] for g in s["hooks"]["Stop"] for h in g["hooks"]]
    assert any(MARK in c and 'FO_ACCT="~/.claude-personal"' in c for c in cmds)
    assert 'FO_ACCT="~/.claude-personal"' in s["statusLine"]["command"]
    u = run("uninstall.sh", env2)
    assert u.returncode == 0, u.stderr
    assert json.loads((personal / "settings.json").read_text()) == SETTINGS
    assert (tmp_path / "LA" / "com.promprit.flowobserve.plist").exists()
    assert accounts(tmp_path) == {"accounts": [{"dir": "~/.claude", "label": "claude"}]}
    assert MARK in (claude / "settings.json").read_text()


def test_install_adds_statusline_when_none_and_uninstall_removes_it(tmp_path):
    claude, env = sandbox(tmp_path)
    (claude / "settings.json").write_text(json.dumps({"hooks": {}}))
    fo = tmp_path / ".flowobserve"
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    assert (fo / "bin" / "fo_status.py").exists()
    assert "info statusline: added by flowobserve" in r.stdout and "warn" not in r.stdout
    cmd = json.loads((claude / "settings.json").read_text())["statusLine"]["command"]
    assert cmd.endswith('-S "%s"' % (fo / "bin" / "fo_status.py"))
    u = run("uninstall.sh", env)
    assert u.returncode == 0, u.stderr
    assert json.loads((claude / "settings.json").read_text()) == {"hooks": {}}


def test_install_copies_cl_and_says_how_to_reach_it(tmp_path):
    claude, env = sandbox(tmp_path)
    r = run("install.sh", env)
    assert r.returncode == 0, r.stderr
    p = tmp_path / ".flowobserve" / "bin" / "cl"
    assert p.exists() and os.stat(p).st_mode & 0o111
    assert 'export PATH="%s:$PATH"' % (tmp_path / ".flowobserve" / "bin") in r.stdout
    d = subprocess.run([str(p), "--dry-run"], capture_output=True, text=True, env=dict(env, FO_PORT="9"))
    assert d.returncode == 0 and d.stdout == "claude\n" and "cl → claude (flowobserve not reachable)" in d.stderr
