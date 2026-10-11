import json, os, subprocess
import pytest
from helper_fixtures import root  # noqa: F401 (fixture)
import fo_open as fo

TOK = "a" * 64

class Git:
    """Stands in for subprocess git: records argv, returns a fake result."""
    def __init__(self, rc=0, err=""):
        self.calls, self.rc, self.err = [], rc, err
    def __call__(self, argv):
        self.calls.append(argv)
        return subprocess.CompletedProcess(argv, self.rc, "", self.err)

def _open(root, tmp_path, monkeypatch, git, name="app"):
    home = tmp_path / "home"; home.mkdir(exist_ok=True)
    (home / "helper.json").write_text(json.dumps({"root": root, "token": TOK}))
    monkeypatch.setenv("FO_HOME", str(home))
    opened, rows, notes = [], [], []
    fo.main([f"flowobserve://open?path={name}&t={TOK}"], osascript=lambda s, a: opened.append(s) or "",
            notify=notes.append, spool=rows.append, now=lambda: 0, git=git)
    return opened, rows, notes

def test_open_on_plain_folder_runs_git_init_before_opening(root, tmp_path, monkeypatch):
    g = Git()
    order = []
    def git(argv):
        order.append("git"); return g(argv)
    home = tmp_path / "home"; home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": TOK}))
    monkeypatch.setenv("FO_HOME", str(home))
    fo.main([f"flowobserve://open?path=app&t={TOK}"], osascript=lambda s, a: order.append("open") or "",
            notify=lambda t: None, spool=lambda r: None, now=lambda: 0, git=git)
    assert g.calls == [["git", "-C", os.path.join(root, "app"), "init", "-q"]]
    assert order[0] == "git" and "open" in order

def test_open_on_git_folder_does_not_run_git(root, tmp_path, monkeypatch):
    os.mkdir(os.path.join(root, "app", ".git"))
    g = Git()
    opened, _, _ = _open(root, tmp_path, monkeypatch, g)
    assert g.calls == [] and opened

def test_init_failure_notifies_spools_failed_and_opens_nothing(root, tmp_path, monkeypatch):
    g = Git(rc=128, err="fatal: nope\n")
    opened, rows, notes = _open(root, tmp_path, monkeypatch, g)
    assert opened == []
    assert len(notes) == 1 and "git init failed" in notes[0]
    assert len(rows) == 1 and rows[0]["payload"]["action"] == "open" and rows[0]["payload"]["ok"] is False
    assert os.path.isdir(os.path.join(root, "app"))

def test_spool_payload_init_true_when_init_ran(root, tmp_path, monkeypatch):
    _, rows, _ = _open(root, tmp_path, monkeypatch, Git())
    assert rows[-1]["payload"]["ok"] is True and rows[-1]["payload"]["init"] is True

def test_spool_payload_init_false_when_git_present(root, tmp_path, monkeypatch):
    os.mkdir(os.path.join(root, "app", ".git"))
    _, rows, _ = _open(root, tmp_path, monkeypatch, Git())
    assert rows[-1]["payload"]["ok"] is True and rows[-1]["payload"]["init"] is False

def _iterm_fails(s, a):
    raise subprocess.CalledProcessError(1, ["osascript"], "", "boom")

def test_open_into_a_subfolder_of_a_repo_never_runs_git_init(root, tmp_path, monkeypatch):
    os.mkdir(os.path.join(root, "app", ".git"))
    os.mkdir(os.path.join(root, "app", "sub"))
    g = Git()
    opened, rows, notes = _open(root, tmp_path, monkeypatch, g, name="app/sub")
    assert g.calls == [] and opened == []
    assert notes == ["Link rejected — inside a repo"]
    assert rows[-1]["payload"]["ok"] is False and rows[-1]["payload"]["error"] == "Link rejected — inside a repo"
    assert not os.path.lexists(os.path.join(root, "app", "sub", ".git"))

def test_open_deep_inside_a_repo_never_runs_git_init(root, tmp_path, monkeypatch):
    os.mkdir(os.path.join(root, "app", ".git"))
    os.makedirs(os.path.join(root, "app", "a", "b"))
    g = Git()
    opened, _, notes = _open(root, tmp_path, monkeypatch, g, name="app/a/b")
    assert g.calls == [] and opened == [] and notes == ["Link rejected — inside a repo"]

@pytest.mark.parametrize("rel", ["app/.git", "app/.git/objects"])
def test_open_of_a_path_with_a_git_component_never_runs_git_init(root, tmp_path, monkeypatch, rel):
    os.makedirs(os.path.join(root, "app", ".git", "objects"))
    g = Git()
    opened, rows, notes = _open(root, tmp_path, monkeypatch, g, name=rel)
    assert g.calls == [] and opened == [] and notes == ["Link rejected — inside a repo"]
    assert rows[-1]["payload"]["ok"] is False

def test_git_component_without_a_parent_repo_is_still_rejected(root, tmp_path, monkeypatch):
    os.makedirs(os.path.join(root, "dryas", ".git", "x"))  # a stray .git folder, no repo marker above
    g = Git()
    opened, _, notes = _open(root, tmp_path, monkeypatch, g, name="dryas/.git/x")
    assert g.calls == [] and opened == [] and notes == ["Link rejected — inside a repo"]

def test_repo_inside_a_group_folder_and_its_worktree_still_open_without_init(root, tmp_path, monkeypatch):
    os.mkdir(os.path.join(root, "dryas", "site", ".git"))
    g = Git()
    opened, rows, _ = _open(root, tmp_path, monkeypatch, g, name="dryas/site")
    assert g.calls == [] and opened and rows[-1]["payload"]["ok"] is True
    wt = os.path.join(root, "dryas", "site", ".worktrees", "x")
    os.makedirs(wt)
    open(os.path.join(wt, ".git"), "w").write("gitdir: ../../.git/worktrees/x\n")
    opened, rows, _ = _open(root, tmp_path, monkeypatch, g, name="dryas/site/.worktrees/x")
    assert g.calls == [] and opened and rows[-1]["payload"]["ok"] is True

def test_open_of_a_container_folder_with_a_repo_below_never_runs_git_init(root, tmp_path, monkeypatch):
    os.mkdir(os.path.join(root, "dryas", "site", ".git"))
    assert not os.path.lexists(os.path.join(root, "dryas", ".git"))
    g = Git()
    opened, rows, notes = _open(root, tmp_path, monkeypatch, g, name="dryas")
    assert g.calls == [] and opened == []
    assert notes == ["Link rejected — inside a repo"]
    assert rows[-1]["payload"]["ok"] is False
    assert not os.path.lexists(os.path.join(root, "dryas", ".git"))

def test_init_recorded_when_it_ran_even_if_iterm_open_fails(root, tmp_path, monkeypatch):
    home = tmp_path / "home"; home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": TOK}))
    monkeypatch.setenv("FO_HOME", str(home))
    rows, g = [], Git()
    fo.main([f"flowobserve://open?path=app&t={TOK}"], osascript=_iterm_fails, notify=lambda t: None,
            spool=rows.append, now=lambda: 0, git=g)
    assert len(g.calls) == 1
    assert rows[-1]["payload"]["ok"] is False and rows[-1]["payload"]["init"] is True

def test_wt_never_runs_git_init(root, tmp_path, monkeypatch):
    g = Git()
    home = tmp_path / "home"; home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": TOK}))
    monkeypatch.setenv("FO_HOME", str(home))
    fo.main([f"flowobserve://open?path=app&wt=1&t={TOK}"], osascript=lambda s, a: "", notify=lambda t: None,
            spool=lambda r: None, now=lambda: 0, git=g)
    assert g.calls == [] and not os.path.lexists(os.path.join(root, "app", ".git"))

@pytest.mark.parametrize("resume", ["", "12345678-1234-1234-1234-123456789abc"])
def test_resume_never_runs_git_init(root, tmp_path, monkeypatch, resume):
    g = Git()
    home = tmp_path / "home"; home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": TOK}))
    monkeypatch.setenv("FO_HOME", str(home))
    fo.main([f"flowobserve://open?path=app&resume={resume}&t={TOK}"], osascript=lambda s, a: "",
            notify=lambda t: None, spool=lambda r: None, now=lambda: 0, git=g)
    assert g.calls == []
