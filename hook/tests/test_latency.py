import json
import os
import subprocess
import time
import sys
import pytest

from conftest import HOOK, PY

pytestmark = [
    pytest.mark.skipif(sys.platform == "win32", reason="POSIX-only: /bin/sh wrapper or macOS budget (windows spec §3.6)"),
    pytest.mark.skipif(bool(os.environ.get("CI")), reason="timing budget is for a real machine; shared CI runners are too noisy"),
]

PAYLOAD = json.dumps({"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/a", "hook_event_name": "PreToolUse",
                      "tool_name": "Bash", "tool_input": {"command": "git status"}}).encode()

BIG_TEST = json.dumps({"session_id": "0f8e2c3a-6b1d-4e5f-9a7b-2c4d6e8f0a1b", "cwd": "/a", "hook_event_name": "PostToolUse",
                       "tool_name": "Bash", "tool_input": {"command": "pnpm -r test"},
                       "tool_response": {"stdout": "x" * 1_000_000 + "\n      Tests  142 passed (142)\n",
                                         "stderr": "", "interrupted": False}}).encode()
PAYLOADS = [PAYLOAD] * 4 + [BIG_TEST]  # a 1 MB test log is the rare case

N = 200


def _run(argv, env, payload=None):
    t = time.perf_counter()
    subprocess.run(argv, input=payload, env=env, capture_output=True)
    return (time.perf_counter() - t) * 1000


def test_hook_latency_vs_bare_interpreter(tmp_path):
    """Hook runs interleaved with bare interpreter runs, so machine load hits both equally."""
    env = dict(os.environ, FO_HOME=str(tmp_path))
    hook, bare = [], []
    for i in range(N):
        hook.append(_run([PY, "-S", HOOK], env, PAYLOADS[i % len(PAYLOADS)]))
        bare.append(_run([PY, "-S", "-c", "pass"], env))
    hook.sort()
    bare.sort()
    p95 = int(N * 0.95) - 1
    hook_med, bare_med = hook[N // 2], bare[N // 2]
    delta = hook_med - bare_med
    msg = ("hook median %.1f p95 %.1f ms, bare median %.1f p95 %.1f ms, median delta %.1f ms"
           % (hook_med, hook[p95], bare_med, bare[p95], delta))
    print(msg)
    assert hook_med < 30, msg
    assert delta < 15, msg
