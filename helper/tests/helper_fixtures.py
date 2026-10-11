"""Shared helper-test fixtures and constants. Not named conftest: hook/tests/conftest.py owns the
`conftest` module name when both suites run in one pytest call. Test modules import the fixtures they use."""
import json
import os
import sys

import pytest

HELPER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(HELPER)
sys.path.insert(0, HELPER)

TOKEN = "ab" * 32


@pytest.fixture
def root(tmp_path):
    r = tmp_path / "projects"
    for d in ("app", "dryas/site", "my app"):
        (r / d).mkdir(parents=True)
    os.symlink("/etc", r / "escape")
    return str(r)


@pytest.fixture
def fo_home(tmp_path, monkeypatch, root):
    home = tmp_path / "fohome"
    home.mkdir()
    (home / "helper.json").write_text(json.dumps({"root": root, "token": TOKEN}))
    monkeypatch.setenv("FO_HOME", str(home))
    return str(home)
