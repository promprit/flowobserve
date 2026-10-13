import json
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


def jev_src():
    """FO_JEV_SRC, else the Dryas plugin root in <CLAUDE_CONFIG_DIR or ~/.claude>/.dryas-plugin.json + /jev, else ~/.claude/jev."""
    if os.environ.get("FO_JEV_SRC"):
        return os.environ["FO_JEV_SRC"]
    cfg = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    try:
        with open(os.path.join(cfg, ".dryas-plugin.json"), encoding="utf-8") as f:
            root = json.load(f).get("plugin_root")
        if isinstance(root, str) and os.path.isdir(os.path.join(root, "jev")):
            return os.path.join(root, "jev")
    except (OSError, ValueError, AttributeError):
        pass
    return os.path.expanduser("~/.claude/jev")


JEV = os.path.join(jev_src(), "redact.py")


@pytest.mark.skipif(not os.path.exists(JEV), reason="Jev not installed")
def test_parity_with_jev_rules():
    spec = importlib.util.spec_from_file_location("jev_redact", JEV)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for s in SAMPLES:
        assert redact(s) == mod.redact(s)
