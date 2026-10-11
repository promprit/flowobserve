import os, pytest
from helper_fixtures import REPO, root  # noqa: F401 (fixture)
import fo_open as fo

U = "8c1f0e2a-1111-4222-8333-444455556666"

def test_rejects_path_traversal(root):
    for rel in ["../etc", "app/../../etc", "/etc", "escape", "app\x00", "", ".", "app;rm -rf ~"]:
        with pytest.raises(fo.Rejected):
            fo.resolve_path(root, rel)

def test_accepts_project_group_member_and_spaces(root):
    assert fo.resolve_path(root, "app").endswith("/app")
    assert fo.resolve_path(root, "dryas/site").endswith("/dryas/site")
    assert fo.resolve_path(root, "my app").endswith("/my app")

def test_resume_ids():
    assert fo.parse_resume(None) == []
    assert fo.parse_resume(U) == [U]
    for bad in ["x", U + ",x", ",".join([U] * 13)]:
        with pytest.raises(fo.Rejected):
            fo.parse_resume(bad)

def test_iterm_ids():
    assert fo.parse_iterm("w0t1p2:" + U.upper()) == U.upper()
    for bad in ["w0t1p2", "x:" + U, "w0t1p2:" + U + ";x"]:
        with pytest.raises(fo.Rejected):
            fo.parse_iterm(bad)

def test_unknown_command_and_scheme():
    for bad in ["http://x/open?path=app", "flowobserve://exec?cmd=ls", "flowobserve://open"]:
        with pytest.raises(fo.Rejected):
            cmd, args = fo.parse(bad)
            fo.plan(cmd, args, "/tmp")

def test_step_do_whitelist(root):
    with pytest.raises(fo.Rejected):
        fo.plan(*fo.parse(f"flowobserve://step?iterm=w0t0p0:{U}&do=rm"), root)

def test_token_required():
    fo.check_token("a" * 64, "a" * 64)
    for bad in [None, "", "a" * 63, "b" * 64]:
        with pytest.raises(fo.Rejected):
            fo.check_token(bad, "a" * 64)
    with pytest.raises(fo.Rejected):
        fo.check_token("a" * 64, None)

def test_wt_only_value_one(root):
    for bad in ["0", "true", "", "2", "%201"]:
        with pytest.raises(fo.Rejected, match="bad parameter"):
            fo.plan(*fo.parse("flowobserve://open?path=app&wt=" + bad), root)

def test_wt_with_resume_rejected(root):
    with pytest.raises(fo.Rejected, match="bad parameter"):
        fo.plan(*fo.parse(f"flowobserve://open?path=app&resume={U}&wt=1"), root)

def test_duplicate_wt_rejected():
    with pytest.raises(fo.Rejected, match="bad parameter"):
        fo.parse("flowobserve://open?path=app&wt=1&wt=1")

def test_wt_not_allowed_on_other_commands():
    with pytest.raises(fo.Rejected, match="bad parameter"):
        fo.parse("flowobserve://run?path=app&wt=1")

def test_reply_command_is_gone(root):
    with pytest.raises(fo.Rejected):
        fo.plan(*fo.parse(f"flowobserve://reply?iterm=w0t0p0:{U}&text=approved"), root)
    assert not hasattr(fo, "parse_reply")


def test_step_texts_match_the_board():
    src = open(os.path.join(REPO, "pwa/src/ui/session.ts")).read()
    assert 'RESUME_TEXT = "Continue from the handoff"' in src
    assert fo.STEP_TEXT == {"handoff": "/handoff", "clear": "/clear", "resume": "Continue from the handoff"}
