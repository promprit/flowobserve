import json, os, shlex
import pytest
from helper_fixtures import root  # noqa: F401 (fixture)
import fo_open as fo

U1 = "8c1f0e2a-1111-4222-8333-444455556666"
U2 = "8c1f0e2a-1111-4222-8333-444455557777"
U3 = "8c1f0e2a-1111-4222-8333-444455558888"
# Same literal as server nameColor("ember") (shared/test/palette.test.ts)
EMBER = "#698cd3"


def test_open_with_three_resume_ids(root):
    acts = fo.plan(*fo.parse(f"flowobserve://open?path=app&resume={U1},{U2},{U3}"), root)
    assert [a[0] for a in acts] == ["open_session"] * 3
    d = os.path.realpath(os.path.join(root, "app"))
    for a, u in zip(acts, [U1, U2, U3]):
        assert a[1] == d
        assert a[2].endswith(f"cd {shlex.quote(d)} && claude --resume {u}")


def test_open_without_resume_and_spaces(root):
    acts = fo.plan(*fo.parse("flowobserve://open?path=my%20app"), root)
    assert len(acts) == 1 and acts[0][0] == "open_session"
    d = os.path.realpath(os.path.join(root, "my app"))
    assert acts[0][2].endswith(f"cd {shlex.quote(d)} && claude")
    assert "'" in shlex.quote(d)


def test_open_with_wt_plans_claude_worktree(root):
    os.mkdir(os.path.join(root, "app", ".git"))
    acts = fo.plan(*fo.parse("flowobserve://open?path=app&wt=1"), root)
    assert len(acts) == 1 and acts[0][0] == "open_session"
    d = os.path.realpath(os.path.join(root, "app"))
    assert acts[0][1] == d
    assert acts[0][2].endswith(f"cd {shlex.quote(d)} && claude --worktree")


def test_open_without_wt_is_plain_claude(root):
    acts = fo.plan(*fo.parse("flowobserve://open?path=app"), root)
    assert len(acts) == 1 and acts[0][2].endswith(" && claude")


def test_open_wt_on_linked_worktree_rejected(root):
    with open(os.path.join(root, "app", ".git"), "w") as f:
        f.write("gitdir: /elsewhere/.git/worktrees/app\n")
    with pytest.raises(fo.Rejected, match="not a main folder"):
        fo.plan(*fo.parse("flowobserve://open?path=app&wt=1"), root)


def test_open_wt_on_folder_without_git_is_rejected(root):
    with pytest.raises(fo.Rejected, match="not a main folder"):
        fo.plan(*fo.parse("flowobserve://open?path=app&wt=1"), root)


def test_open_wt_on_group_folder_is_rejected(root):
    os.mkdir(os.path.join(root, "dryas", "site", ".git"))
    with pytest.raises(fo.Rejected, match="not a main folder"):
        fo.plan(*fo.parse("flowobserve://open?path=dryas&wt=1"), root)


def test_open_wt_on_dangling_git_symlink_is_rejected(root):
    os.symlink(os.path.join(root, "nowhere"), os.path.join(root, "app", ".git"))
    with pytest.raises(fo.Rejected, match="not a main folder"):
        fo.plan(*fo.parse("flowobserve://open?path=app&wt=1"), root)


def test_open_wt_on_git_symlink_to_dir_plans(root):
    os.mkdir(os.path.join(root, "realgit"))
    os.symlink(os.path.join(root, "realgit"), os.path.join(root, "app", ".git"))
    acts = fo.plan(*fo.parse("flowobserve://open?path=app&wt=1"), root)
    assert acts[0][2].endswith("&& claude --worktree")


def test_plan_rejects_wt_not_one_without_parse(root):
    os.mkdir(os.path.join(root, "app", ".git"))
    with pytest.raises(fo.Rejected, match="bad parameter"):
        fo.plan("open", {"path": "app", "wt": "0"}, root)


def test_plan_rejects_wt_with_resume_without_parse(root):
    os.mkdir(os.path.join(root, "app", ".git"))
    with pytest.raises(fo.Rejected, match="bad parameter"):
        fo.plan("open", {"path": "app", "wt": "1", "resume": U1}, root)


def test_run_with_spec(root):
    d = os.path.join(root, "app")
    os.mkdir(os.path.join(d, ".flowobserve"))
    spec = {"cmd": ["pnpm", "dev", "--port", "8080"], "url": "http://localhost:8080"}
    with open(os.path.join(d, ".flowobserve", "run"), "w") as f:
        json.dump(spec, f)
    acts = fo.plan(*fo.parse("flowobserve://run?path=app"), root)
    assert len(acts) == 1 and acts[0][0] == "run_session"
    assert acts[0][2].endswith(shlex.join(spec["cmd"]))
    assert acts[0][5] == "http://localhost:8080"


def test_run_without_spec_only_notifies(root):
    acts = fo.plan(*fo.parse("flowobserve://run?path=app"), root)
    assert [a[0] for a in acts] == ["notify"]


def test_jump_step(root):
    iterm = f"w0t1p2:{U1}"
    assert fo.plan(*fo.parse(f"flowobserve://jump?iterm={iterm}"), root) == [("jump", U1)]
    assert fo.plan(*fo.parse(f"flowobserve://step?iterm={iterm}&do=handoff"), root) == [("step", U1, "/handoff")]


def test_colour_reads_peacock_with_comments_else_name_hash(tmp_path):
    p = tmp_path / "proj"
    (p / ".vscode").mkdir(parents=True)
    (p / ".vscode" / "settings.json").write_text('{\n  // c\n  "peacock.color": "#D7DCC5", /* x */\n}\n')
    assert fo.colour(str(p), "ember").lower() == "#d7dcc5"
    q = tmp_path / "bare"
    q.mkdir()
    assert fo.colour(str(q), "ember") == EMBER


def _tab_rgb(shell_text):
    return tuple(int(shell_text.split(f"bg;{c};brightness;")[1].split("\\a")[0]) for c in ("red", "green", "blue"))


def _hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def test_worktree_without_peacock_takes_project_name_colour(root):
    # Server projects.ts colours a worktree with its project's colour: nameColor(project basename).
    proj = os.path.join(root, "flowapp")
    wt = os.path.join(proj, ".claude", "worktrees", "fix-s2")
    os.makedirs(os.path.join(proj, ".git"))
    os.makedirs(wt)
    with open(os.path.join(wt, ".git"), "w") as f:
        f.write(f"gitdir: {proj}/.git/worktrees/fix-s2\n")
    a = fo.plan(*fo.parse("flowobserve://open?path=flowapp/.claude/worktrees/fix-s2"), root)[0]
    assert _tab_rgb(a[2]) == _hex_rgb(fo.name_color("flowapp")) != _hex_rgb(fo.name_color("fix-s2"))
    assert a[4] == "fix-s2"


def test_group_member_and_worktree_inherit_group_peacock(root):
    # dryas = group (no .git), dryas/site = project; its colour comes from the group's settings.
    site = os.path.join(root, "dryas", "site")
    os.makedirs(os.path.join(site, ".git"))
    os.makedirs(os.path.join(root, "dryas", ".vscode"))
    with open(os.path.join(root, "dryas", ".vscode", "settings.json"), "w") as f:
        f.write('{"peacock.color": "#151a60"}')
    wt = os.path.join(site, ".claude", "worktrees", "w1")
    os.makedirs(wt)
    for rel in ("dryas/site", "dryas/site/.claude/worktrees/w1"):
        a = fo.plan(*fo.parse(f"flowobserve://open?path={rel}"), root)[0]
        assert _tab_rgb(a[2]) == (0x15, 0x1A, 0x60)
    os.makedirs(os.path.join(site, ".vscode"))
    with open(os.path.join(site, ".vscode", "settings.json"), "w") as f:
        f.write('{"peacock.color": "#D7DCC5"}')
    a = fo.plan(*fo.parse("flowobserve://open?path=dryas/site/.claude/worktrees/w1"), root)[0]
    assert _tab_rgb(a[2]) == (0xD7, 0xDC, 0xC5)


def test_peacock_keeps_comment_markers_inside_strings(tmp_path):
    p = tmp_path / "proj"
    (p / ".vscode").mkdir(parents=True)
    (p / ".vscode" / "settings.json").write_text(
        '{\n  "search.exclude": {"**/*.map": true}, // maps\n'
        '  "peacock.color": "#ff0000",\n'
        '  /* watcher */ "files.watcherExclude": {"**/.git/objects/**": true},\n'
        '  "u": "http://x//y",\n}\n')
    assert fo.peacock(str(p)) == "#ff0000"


def test_open_with_root_label_uses_that_root(root, tmp_path):
    dev = tmp_path / "Dev"
    (dev / "app").mkdir(parents=True)
    roots = {"projects": root, "Dev": str(dev)}
    acts = fo.plan(*fo.parse("flowobserve://open?path=app&root=Dev"), root, roots)
    assert acts[0][1] == os.path.realpath(dev / "app")


def test_open_without_root_label_uses_projects_root(root):
    acts = fo.plan(*fo.parse("flowobserve://open?path=app"), root, {"projects": root})
    assert acts[0][1] == os.path.realpath(os.path.join(root, "app"))


def test_unknown_root_label_is_rejected(root):
    with pytest.raises(fo.Rejected, match="unknown root"):
        fo.plan(*fo.parse("flowobserve://open?path=app&root=/etc"), root, {"projects": root})


def test_run_and_diff_accept_root_label(root, tmp_path):
    dev = tmp_path / "Dev"
    (dev / "app").mkdir(parents=True)
    roots = {"projects": root, "Dev": str(dev)}
    assert fo.plan(*fo.parse("flowobserve://diff?path=app&root=Dev"), root, roots)[0][0] == "diff_session"
    assert fo.plan(*fo.parse("flowobserve://run?path=app&root=Dev"), root, roots)[0][0] == "notify"  # no .flowobserve/run


def test_open_c_sets_tab_colour(root):
    os.makedirs(os.path.join(root, "capp", ".git"))
    a = fo.plan(*fo.parse("flowobserve://open?path=capp&c=e06c75"), root)[0]
    assert _tab_rgb(a[2]) == _hex_rgb("#e06c75")


def test_run_and_diff_accept_c(root):
    os.makedirs(os.path.join(root, "capp", ".git"))
    d = fo.plan(*fo.parse("flowobserve://diff?path=capp&c=61afef"), root)[0]
    assert _tab_rgb(d[2]) == _hex_rgb("#61afef")
    cmd, args = fo.parse("flowobserve://run?path=capp&c=61afef")
    assert args["c"] == "61afef"


@pytest.mark.parametrize("bad", ["E06C75", "%23e06c75", "e06c7", "zzzzzz", ""])
def test_bad_c_is_ignored_not_rejected(root, bad):
    os.makedirs(os.path.join(root, "capp", ".git"))
    a = fo.plan(*fo.parse("flowobserve://open?path=capp&c=" + bad), root)[0]
    assert _tab_rgb(a[2]) == _hex_rgb(fo.name_color("capp"))


def test_c_not_allowed_on_jump(root):
    with pytest.raises(fo.Rejected):
        fo.parse("flowobserve://jump?iterm=w0t1p2:0123abcd-4567-89ab-cdef-0123456789ab&c=e06c75")


def _osc(shell_text, tmp_path):
    """Run the helper's shell line for real and return its iTerm2 OSC 1337 payloads."""
    import base64 as b64, subprocess
    out = subprocess.run(["/bin/sh", "-c", shell_text], capture_output=True, cwd=tmp_path).stdout.decode("utf-8")
    return [p.split("\a")[0] for p in out.split("\x1b]1337;")[1:]], b64


def test_badge_shows_name_over_mod_status_and_keeps_tab_key(tmp_path):
    name = "my app-1.0"
    payloads, b64 = _osc(fo._shell(str(tmp_path), "true", (1, 2, 3), name), tmp_path)
    assert payloads[0] == "SetUserVar=fo_name=" + b64.b64encode(name.encode("utf-8")).decode("ascii")
    assert not any(p.startswith("SetUserVar=fo_project=") for p in payloads)  # fo_project is the hex tab key
    k, v = payloads[1].split("=", 1)
    assert k == "SetBadgeFormat"
    assert b64.b64decode(v).decode("utf-8") == "\\(user.fo_name)\n\\(user.fo_badge)"


def test_no_badge_sends_no_badge_escapes(tmp_path):
    payloads, _ = _osc(fo._shell(str(tmp_path), "true", (1, 2, 3), None), tmp_path)
    assert payloads == []
