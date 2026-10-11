import json
import os
import shutil
import subprocess
import sys

from conftest import HOOK_DIR, PY

REPO = os.path.dirname(HOOK_DIR)
sys.path.insert(0, os.path.join(REPO, "scripts"))
import fo_install  # noqa: E402
import pytest

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX-only: /bin/sh wrapper or macOS budget (windows spec §3.6)")

HUD = "/bin/sh -c 'printf HUD:; cat'"


def copy_hook(dst):
    os.makedirs(dst)
    for n in ("fo_hook.py", "fo_derive.py", "fo_redact.py"):
        shutil.copy(os.path.join(HOOK_DIR, n), dst)
    return os.path.join(dst, "fo_hook.py")


def spool_text(home):
    d = os.path.join(home, "spool")
    return "".join(open(os.path.join(d, f)).read() for f in os.listdir(d)) if os.path.isdir(d) else ""


def test_copied_hook_writes_spool_and_nothing_on_stdout(tmp_path):
    hook = copy_hook(str(tmp_path / "bin"))
    payload = json.dumps({"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/Users/p/app", "hook_event_name": "SessionStart", "source": "startup"})
    env = dict(os.environ, FO_HOME=str(tmp_path / "home"))
    # Run the hook directly (not via hook_command, which discards stdout) to prove it is silent itself.
    p = subprocess.run([PY, "-S", hook], input=payload, capture_output=True, text=True, env=env)
    assert p.returncode == 0
    assert p.stdout == ""
    assert '"SessionStart"' in spool_text(str(tmp_path / "home"))


def test_settings_command_exits_0_when_hook_missing(tmp_path):
    p = subprocess.run(["/bin/sh", "-c", fo_install.hook_command(str(tmp_path / "nope" / "fo_hook.py"))],
                       input="{}", capture_output=True, text=True)
    assert p.returncode == 0 and p.stdout == ""


def test_wrapped_statusline_runs_hud_with_same_stdin(tmp_path):
    hook = copy_hook(str(tmp_path / "bin"))
    stdin = open(os.path.join(REPO, "fixtures", "statusline.json")).read()
    env = dict(os.environ, FO_HOME=str(tmp_path / "home"))
    p = subprocess.run(["/bin/sh", "-c", fo_install.wrap_prefix(hook) + HUD], input=stdin, capture_output=True, text=True, env=env)
    assert p.returncode == 0
    assert p.stdout == "HUD:" + stdin
    assert '"statusline"' in spool_text(str(tmp_path / "home"))


def test_wrapped_statusline_runs_hud_when_hook_missing(tmp_path):
    p = subprocess.run(["/bin/sh", "-c", fo_install.wrap_prefix(str(tmp_path / "gone" / "fo_hook.py")) + HUD],
                       input="{}", capture_output=True, text=True)
    assert p.returncode == 0 and p.stdout == "HUD:{}"
