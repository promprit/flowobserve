import os, subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHECK = ROOT / "scripts" / "leakcheck.mjs"

def run(d, env=None):
    return subprocess.run(["node", str(CHECK), str(d)], capture_output=True, text=True, env={**os.environ, **(env or {})})

def test_clean_dir_passes(tmp_path):
    (tmp_path / "a.ts").write_text('const p = "/Users/dev/code/demo";\n')
    assert run(tmp_path, {"FO_LEAK_DENYLIST": ""}).returncode == 0

def test_secret_and_home_path_fail(tmp_path):
    (tmp_path / "a.ts").write_text('const k = "sk-ant-' + 'api03-abcdefghijklmnop";\nconst h = "/Users/alice/x";\n')  # leakcheck:allow
    r = run(tmp_path, {"FO_LEAK_DENYLIST": ""})
    assert r.returncode == 1
    assert "a.ts:1" in r.stdout and "a.ts:2" in r.stdout

def test_denylist_applies_but_not_to_license(tmp_path):
    deny = tmp_path / "deny.txt"
    deny.write_text("# names\nJane Q\n")
    src = tmp_path / "src"; src.mkdir()
    (src / "LICENSE").write_text("Copyright Jane Q\n")
    (src / "b.md").write_text("by Jane Q\n")
    r = run(src, {"FO_LEAK_DENYLIST": str(deny)})
    assert r.returncode == 1
    assert "b.md:1" in r.stdout and "LICENSE" not in r.stdout

def test_allow_marker_skips_line(tmp_path):
    (tmp_path / "a.ts").write_text('const h = "/Users/alice/x"; // leakcheck:allow\n')
    assert run(tmp_path, {"FO_LEAK_DENYLIST": ""}).returncode == 0

def _flagged(tmp_path, text):
    (tmp_path / "a.ts").write_text(text)
    r = run(tmp_path, {"FO_LEAK_DENYLIST": ""})
    return r.returncode == 1

def test_flags_encoded_and_linux_home_paths(tmp_path):
    for t in ['x = "/Users/dev-jane/x"\n', 'x = "/Users/p.smith/x"\n', 'x = "-Users-jane-code"\n', 'x = "/home/jane/x"\n', 'x = "/Users/jane"\n', 'x = "/Users/jane m"\n']:  # leakcheck:allow
        assert _flagged(tmp_path, t), t

def test_passes_neutral_paths(tmp_path):
    (tmp_path / "a.ts").write_text('a = "/Users/Shared/x"\nb = "/Users/dev/x"\nc = "-Users-dev-code"\nd = "/home/runner/x"\ne = "/Users/p/x"\n')
    assert run(tmp_path, {"FO_LEAK_DENYLIST": ""}).returncode == 0

def test_marker_does_not_exempt_secrets(tmp_path):
    assert _flagged(tmp_path, 'k = "AKIA' + 'ABCDEFGHIJKLMNOP" // leakcheck:allow\n')
