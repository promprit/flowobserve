import os, subprocess
import pytest
import helper_fixtures  # noqa: F401  (puts helper/ on sys.path)
import fo_iterm

ITERM = "/Applications/iTerm.app"
SCRIPTS = [n for n in dir(fo_iterm) if n.endswith("_SCRIPT")]


@pytest.mark.skipif(not os.path.isdir(ITERM), reason="needs iTerm2's AppleScript dictionary")
@pytest.mark.parametrize("name", SCRIPTS)
def test_script_compiles_against_iterm2(name, tmp_path):
    r = subprocess.run(["/usr/bin/osacompile", "-o", str(tmp_path / "s.scpt"), "-e", getattr(fo_iterm, name)],
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr


def test_open_script_handles_no_current_window():
    assert "if s is missing value then" in fo_iterm.OPEN_SCRIPT
    # iTerm2 can report windows while `current window` is missing value (hidden or not frontmost)
    assert "current window is not missing value" in fo_iterm.LIST_SCRIPT.replace("(", "").replace(")", "")


def test_list_script_uses_real_tab_separator():
    s = fo_iterm.LIST_SCRIPT
    # inside the iTerm2 tell block the bare word `tab` is iTerm's tab class and prints as "tab"
    assert "& tab &" not in s
    assert s.index("character id 9") < s.index("tell application")


@pytest.mark.skipif(not os.path.isdir(ITERM) or os.environ.get("FO_LIVE_ITERM") != "1",
                    reason="needs iTerm2 and FO_LIVE_ITERM=1")
def test_live_list_script_lines_parse():
    lines = fo_iterm.osascript(fo_iterm.LIST_SCRIPT, []).splitlines()
    assert lines and lines[0].startswith("C\t")
    for ln in lines[1:]:
        assert ln.startswith("T\t") and len(ln.split("\t")) == 5, ln
