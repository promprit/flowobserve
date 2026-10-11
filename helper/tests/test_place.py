# helper/tests/test_place.py
import os, subprocess, urllib.parse
from helper_fixtures import TOKEN, fo_home, root  # noqa: F401 (fixtures)
import fo_open as fo
from fo_open import Tab

S = ["8c1f0e2a-1111-4222-8333-44445555%04d" % i for i in range(6)]


def test_parse_listing():
    app = b"app".hex()
    text = "C\t7\nT\t7\t%s\t2\t%s:claude|%s:diff\nT\t7\t%s\t1\t\n" % (S[0], app, app, S[1])
    assert fo.parse_listing(text) == ("7", [Tab("7", S[0], 2, [(app, "claude"), (app, "diff")]), Tab("7", S[1], 1, [])])
    # a raw (pre-hex) key is not a key
    assert fo.parse_listing("T\t7\t%s\t1\tsite (old):claude\n" % S[0]) == (None, [Tab("7", S[0], 1, [])])


def test_parse_listing_garbage_is_empty():
    assert fo.parse_listing("ok") == (None, [])
    assert fo.parse_listing("C\t\n") == (None, [])
    assert fo.parse_listing("T\tx\tnot-a-uuid\t2\tapp:claude\n") == (None, [])


def test_same_project_splits_its_tab():
    tabs = [Tab("7", S[0], 1, [("other", "claude")]), Tab("7", S[1], 2, [("app", "claude")])]
    assert fo.place("7", tabs, "app") == ("split", S[1])


def test_full_project_tab_overflows_to_new_tab_in_its_window():
    assert fo.place("9", [Tab("7", S[0], 4, [("app", "claude")])], "app") == ("tab", "7")


def test_last_listed_project_tab_fills_first():
    tabs = [Tab("7", S[0], 4, [("app", "claude")]), Tab("7", S[1], 1, [("app", "claude")])]
    assert fo.place("7", tabs, "app") == ("split", S[1])


def test_other_project_always_new_tab():
    assert fo.place("7", [Tab("7", S[0], 1, [("other", "claude")])], "app") == ("tab", "7")


def test_untagged_tabs_never_receive_splits():
    assert fo.place("7", [Tab("7", S[0], 1, [])], "app") == ("tab", "7")


def test_diff_only_tab_is_not_the_project_tab():
    assert fo.place("7", [Tab("7", S[0], 1, [("app", "diff")])], "app") == ("tab", "7")


def test_diff_split_counts_toward_four():
    assert fo.place("7", [Tab("7", S[0], 4, [("app", "claude"), ("app", "diff")])], "app") == ("tab", "7")


def test_no_window_opens_window():
    assert fo.place(None, [], "app") == ("window",)


def test_project_key_worktree_and_group(root):
    proj = os.path.join(root, "flowapp")
    wt = os.path.join(proj, ".claude", "worktrees", "x")
    os.makedirs(os.path.join(proj, ".git")); os.makedirs(wt)
    with open(os.path.join(wt, ".git"), "w") as f:
        f.write("gitdir: x\n")
    grp = os.path.join(root, "dryas", "site")
    os.makedirs(os.path.join(grp, ".git"))
    assert fo.project_key(root, os.path.realpath(wt)) == b"flowapp".hex()
    assert fo.project_key(root, os.path.realpath(proj)) == b"flowapp".hex()
    assert fo.project_key(root, os.path.realpath(grp)) == b"dryas/site".hex()


def test_open_lists_then_opens_with_placement(root):
    calls = []
    def osa(script, args):
        calls.append((script, args))
        return "C\t7\n" if script is fo.fo_iterm.LIST_SCRIPT else "SID"
    ok, err = fo._execute(fo.plan(*fo.parse("flowobserve://open?path=app"), root), osa, lambda t: None)
    assert ok and err is None
    assert calls[0][0] is fo.fo_iterm.LIST_SCRIPT
    args = calls[1][1]
    assert len(args) == 8 and args[4:6] == ["tab", "7"] and args[6] == b"app".hex() and args[7] == "claude"


def test_restore_three_fills_the_tab_in_turn(root):
    key = b"app".hex()  # the root fixture's app has no .git, so its key is the folder itself
    seen = []
    def osa(script, args):
        if script is fo.fo_iterm.LIST_SCRIPT:
            n = len(seen)
            return "C\t7\n" + ("T\t7\t%s\t%d\t%s:claude\n" % (S[0], n, key) if n else "")
        seen.append(args[4:6]); return "SID"
    fo._execute(fo.plan(*fo.parse("flowobserve://open?path=app&resume=%s,%s,%s" % (S[1], S[2], S[3])), root), osa, lambda t: None)
    assert seen == [["tab", "7"], ["split", S[0]], ["split", S[0]]]


def test_unusual_folder_name_reuses_tab(root):
    # A real folder name with parens, `+` and a non-ASCII letter must still find its own tab:
    # the tag written by the first open has to survive the listing round-trip and match again.
    os.makedirs(os.path.join(root, "site (old)+café"))
    url = "flowobserve://open?path=" + urllib.parse.quote("site (old)+café")
    tags, seen = [], []
    def osa(script, args):
        if script is fo.fo_iterm.LIST_SCRIPT:
            return "C\t7\n" + "".join("T\t7\t%s\t%d\t%s\n" % (S[0], len(tags), "|".join(tags)) for _ in tags[:1])
        seen.append(args[4:6]); tags.append("%s:%s" % (args[6], args[7])); return "SID"
    for _ in range(2):
        fo._execute(fo.plan(*fo.parse(url), root), osa, lambda t: None)
    assert seen == [["tab", "7"], ["split", S[0]]]
    assert all(fo.KEY_RE.fullmatch(t.rsplit(":", 1)[0]) for t in tags)


def _main(osa):
    calls, notes, rows = [], [], []
    def rec(script, args):
        calls.append((script, args))
        return osa(script, args)
    assert fo.main(["flowobserve://open?path=app&t=" + TOKEN], osascript=rec, notify=notes.append,
                   spool=rows.append, now=lambda: 1.0) == 0
    return calls, notes, rows


def test_listing_failure_falls_back_to_window(fo_home):
    def osa(script, args):
        if script is fo.fo_iterm.LIST_SCRIPT:
            raise subprocess.CalledProcessError(1, "osascript", stderr="execution error: timeout (-1712)")
        return "SID"
    calls, notes, rows = _main(osa)
    opens = [a for s, a in calls if s is fo.fo_iterm.OPEN_SCRIPT]
    assert len(opens) == 1 and opens[0][4:6] == ["window", ""]
    assert notes == [] and len(rows) == 1 and rows[0]["payload"]["ok"] is True


def test_listing_without_iterm_still_says_install(fo_home):
    def osa(script, args):
        if script is fo.fo_iterm.LIST_SCRIPT:
            raise FileNotFoundError("osascript")
        return "SID"
    calls, notes, rows = _main(osa)
    assert all(s is not fo.fo_iterm.OPEN_SCRIPT for s, _ in calls)
    assert notes == ["Install iTerm2 to open sessions here"] and rows[0]["payload"]["ok"] is False


def test_same_relative_name_under_two_roots_gets_separate_tabs(root, tmp_path):
    other = str(tmp_path / "dev")
    for r in (root, other):
        os.makedirs(os.path.join(r, "tool", ".git"))
    a, b = fo.project_key(root, os.path.join(root, "tool")), fo.project_key(other, os.path.join(other, "tool"), "Dev")
    assert a == b"tool".hex() and a != b
    tabs = [Tab("7", S[0], 1, [(a, "claude")])]
    assert fo.place("7", tabs, b) == ("tab", "7")
