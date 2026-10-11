import json, os, subprocess
import pytest
from helper_fixtures import root  # noqa: F401 (fixture)
import fo_open as fo

class Git:
    """Stands in for subprocess git: records argv, returns a fake result."""
    def __init__(self, rc=0, err=""):
        self.calls, self.rc, self.err = [], rc, err
    def __call__(self, argv):
        self.calls.append(argv)
        if isinstance(self.rc, Exception):
            raise self.rc
        return subprocess.CompletedProcess(argv, self.rc, "", self.err)

def test_create_makes_folder_and_runs_git_init(tmp_path):
    g = Git()
    ok, err = fo.create_project(str(tmp_path), "new-app", g)
    assert (ok, err) == (True, None)
    assert os.path.isdir(tmp_path / "new-app")
    assert g.calls == [["git", "-C", str(tmp_path / "new-app"), "init", "-q"]]

@pytest.mark.parametrize("bad", [".", "..", ".hidden", "a/b", "x" * 65, "sp ace", "dot.", "ünï", ""])
def test_invalid_name_rejected_by_plan(root, bad):
    with pytest.raises(fo.Rejected, match="invalid name"):
        fo.plan("new", {"root": "projects", "name": bad}, root, {"projects": root})

def test_existing_folder_is_not_touched(tmp_path):
    (tmp_path / "taken").mkdir()
    (tmp_path / "taken" / "keep.txt").write_text("x")
    g = Git()
    ok, err = fo.create_project(str(tmp_path), "taken", g)
    assert (ok, err) == (False, "Folder already exists")
    assert g.calls == []
    assert (tmp_path / "taken" / "keep.txt").read_text() == "x"

def test_existing_file_with_same_name_is_not_overwritten(tmp_path):
    (tmp_path / "projects").write_text("file")
    ok, err = fo.create_project(str(tmp_path), "projects", Git())
    assert (ok, err) == (False, "Folder already exists")
    assert (tmp_path / "projects").read_text() == "file"

def test_git_missing_keeps_folder(tmp_path):
    ok, err = fo.create_project(str(tmp_path), "app", Git(rc=FileNotFoundError()))
    assert ok is False and err.startswith("git init failed")
    assert os.path.isdir(tmp_path / "app")

def test_git_nonzero_keeps_folder_and_quotes_first_stderr_line(tmp_path):
    ok, err = fo.create_project(str(tmp_path), "app", Git(rc=128, err="fatal: nope\nmore\n"))
    assert ok is False and err == "git init failed — folder kept: fatal: nope"
    assert os.path.isdir(tmp_path / "app")

def test_unknown_root_label_rejected(root):
    with pytest.raises(fo.Rejected, match="unknown root"):
        fo.plan("new", {"root": "/tmp", "name": "app"}, root, {"projects": root})

def test_root_missing_on_disk_is_reported(tmp_path):
    gone = str(tmp_path / "Dev-unplugged")
    with pytest.raises(fo.Rejected, match="not found — SSD mounted"):
        fo.check_root_exists("Dev", gone)

def test_main_creates_then_opens_and_spools_new(root, tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": "a" * 64,
        "createRoots": [{"label": "projects", "path": root}]}))
    monkeypatch.setenv("FO_HOME", str(home))
    opened, rows, notes = [], [], []
    url = f"flowobserve://new?root=projects&name=newapp&t={'a' * 64}"
    fo.main([url], osascript=lambda s, a: opened.append(s) or "", notify=notes.append,
            spool=rows.append, now=lambda: 0, git=Git())
    assert os.path.isdir(os.path.join(root, "newapp"))
    assert opened, "a session should open in iTerm2"
    assert rows[-1]["payload"] == {"action": "new", "ok": True, "name": "newapp"}
    assert rows[-1]["event"] == "helper" and notes == []

def test_main_bad_token_creates_nothing(root, tmp_path, monkeypatch):
    home = tmp_path / "home"; home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": "a" * 64}))
    monkeypatch.setenv("FO_HOME", str(home))
    notes = []
    fo.main([f"flowobserve://new?root=projects&name=x&t={'b' * 64}"], osascript=lambda s, a: "",
            notify=notes.append, spool=lambda r: None, now=lambda: 0, git=Git())
    assert not os.path.exists(os.path.join(root, "x"))
    assert notes == ["Link not from your flowobserve board — ignored"]

def _cfg(root, tmp_path, monkeypatch):
    home = tmp_path / "home"; home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": "a" * 64,
        "createRoots": [{"label": "projects", "path": root}]}))
    monkeypatch.setenv("FO_HOME", str(home))

def test_main_bad_token_spools_one_failed_row(root, tmp_path, monkeypatch):
    _cfg(root, tmp_path, monkeypatch)
    rows = []
    fo.main([f"flowobserve://new?root=projects&name=x&t={'b' * 64}"], osascript=lambda s, a: "",
            notify=lambda t: None, spool=rows.append, now=lambda: 0, git=Git())
    assert len(rows) == 1 and rows[0]["event"] == "helper"
    assert rows[0]["payload"] == {"action": "new", "ok": False, "error": "Link not from your flowobserve board — ignored"}

def test_main_git_failure_spools_failed_row_with_name(root, tmp_path, monkeypatch):
    _cfg(root, tmp_path, monkeypatch)
    rows, notes = [], []
    fo.main([f"flowobserve://new?root=projects&name=newapp&t={'a' * 64}"], osascript=lambda s, a: "",
            notify=notes.append, spool=rows.append, now=lambda: 0, git=Git(rc=1, err="boom\nmore"))
    assert len(rows) == 1
    p = rows[0]["payload"]
    assert p["action"] == "new" and p["ok"] is False and p["name"] == "newapp" and "boom" in p["error"]
