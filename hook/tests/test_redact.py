import importlib.util
import os

import pytest

from fo_redact import redact, redact_obj

SAMPLES = [
    "export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx",
    "curl -H 'Authorization: Bearer abcdef123456' https://x",
    "git clone https://user:hunter2@github.com/x/y",
    "mysql -u root -psecret123 db",
    "token gh" + "p_abcdefghijklmnopqrstuvwxyz0123",
    "AKI" + "AABCDEFGHIJKLMNOP",
    "password: 'p@ss'",
]


def test_secrets_are_removed():
    out = [redact(s) for s in SAMPLES]
    for secret in ["sk-abcdef", "abcdef123456", "hunter2", "secret123", "ghp_abc", "AKIAABCD", "p@ss"]:
        assert all(secret not in o for o in out), secret


def test_redact_obj_walks_nested_values():
    obj = {"tool_input": {"command": "X_TOKEN=abc123 run"}, "n": 3, "l": ["Bearer zzzzzzzz"]}
    out = redact_obj(obj)
    assert "abc123" not in out["tool_input"]["command"]
    assert out["n"] == 3
    assert "zzzzzzzz" not in out["l"][0]


JEV = os.path.expanduser("~/.claude/jev/redact.py")


@pytest.mark.skipif(not os.path.exists(JEV), reason="Jev not installed")
def test_parity_with_jev_rules():
    spec = importlib.util.spec_from_file_location("jev_redact", JEV)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for s in SAMPLES:
        assert redact(s) == mod.redact(s)
