# helper/tests/test_diff.py
import os, re, subprocess
import pytest
from helper_fixtures import TOKEN, fo_home, root  # noqa: F401 (fixtures)
import fo_open as fo

ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
# DIFF_BASE runs in the user's login shell inside iTerm2: zsh by default on macOS, bash for some.
SHELLS = ["/bin/bash", "/bin/zsh"]


def _git(d, *a):
    subprocess.run(["git", "-C", d, "-c", "commit.gpgsign=false", *a], check=True, capture_output=True, env=ENV)


def _repo(path, branch):
    os.makedirs(path)
    _git(path, "init", "-q", "-b", branch)
    with open(os.path.join(path, "f"), "w") as f:
        f.write("x\n")
    _git(path, "add", "f"); _git(path, "commit", "-qm", "init")
    return path


def _default(shell, d):
    r = subprocess.run([shell, "-c", fo.DIFF_BASE + '; printf "%s" "$d"'], cwd=d, capture_output=True, text=True)
    return r.stdout


@pytest.mark.parametrize("shell", SHELLS)
def test_base_prefers_origin_head(tmp_path, shell):
    up = _repo(str(tmp_path / "up"), "trunk")
    clone = str(tmp_path / "clone")
    subprocess.run(["git", "clone", "-q", up, clone], check=True, capture_output=True, env=ENV)
    assert _default(shell, clone) == "trunk"


@pytest.mark.parametrize("shell", SHELLS)
def test_base_falls_back_to_main_then_master(tmp_path, shell):
    assert _default(shell, _repo(str(tmp_path / "a"), "main")) == "main"
    assert _default(shell, _repo(str(tmp_path / "b"), "master")) == "master"


def test_diff_parses_and_checks_path_like_run(root):
    acts = fo.plan(*fo.parse("flowobserve://diff?path=app"), root)
    assert acts[0][0] == "diff_session" and acts[0][1] == os.path.realpath(os.path.join(root, "app"))
    assert acts[0][2].endswith(fo.DIFF_TAIL)
    for bad in ("flowobserve://diff?path=../x", "flowobserve://diff?path=/etc", "flowobserve://diff?path=app&cmd=x"):
        with pytest.raises(fo.Rejected):
            fo.plan(*fo.parse(bad), root)


def test_diff_split_is_tagged_diff_and_spooled(fo_home):
    calls, rows = [], []
    def osa(s, a):
        calls.append((s, a))
        return "C\t7\n" if s is fo.fo_iterm.LIST_SCRIPT else "SID"
    fo.main([f"flowobserve://diff?path=app&t={TOKEN}"], osascript=osa, notify=lambda t: None, spool=rows.append, now=lambda: 1.0)
    assert calls[0][0] is fo.fo_iterm.LIST_SCRIPT and calls[1][0] is fo.fo_iterm.OPEN_SCRIPT
    assert calls[1][1][6] == b"app".hex() and calls[1][1][7] == "diff"
    assert rows[0]["payload"]["action"] == "diff" and rows[0]["payload"]["ok"] is True


def _paged(shell, d):
    r = subprocess.run([shell, "-c", "less() { sed 's/^/|/'; }; " + fo.DIFF_TAIL], cwd=d, capture_output=True, text=True, env=ENV, timeout=30)
    return re.sub(r"\x1b\[[0-9;]*m", "", r.stdout)


@pytest.mark.parametrize("shell", SHELLS)
def test_tail_pages_status_stat_and_diff(tmp_path, shell):
    d = _repo(str(tmp_path / "a"), "main")
    _git(d, "checkout", "-qb", "feat")
    with open(os.path.join(d, "f"), "a") as f:
        f.write("changed\n")
    open(os.path.join(d, "brand-new.txt"), "w").close()
    out = _paged(shell, d)
    assert all(l.startswith("|") for l in out.splitlines())
    assert "|?? brand-new.txt" in out and "1 file changed" in out and "|+changed" in out
    assert fo.NO_BASE not in out


@pytest.mark.parametrize("shell", SHELLS)
def test_tail_without_base_says_so_and_diffs_head(tmp_path, shell):
    d = _repo(str(tmp_path / "a"), "trunk")
    with open(os.path.join(d, "f"), "a") as f:
        f.write("changed\n")
    out = _paged(shell, d)
    assert out.startswith("|" + fo.NO_BASE + "\n") and "|+changed" in out
    assert "fatal" not in out
