import fo_derive as d

def bash(cmd, out, event="PostToolUse"):
    return {"hook_event_name": event, "tool_name": "Bash", "tool_input": {"command": cmd},
            "tool_response": {"stdout": out, "stderr": "", "interrupted": False}}

def test_vitest_counts():
    out = "...\n Test Files  12 passed (12)\n      Tests  2 failed | 140 passed (142)\n"
    assert d.derive(bash("pnpm -r test", out))["tests"] == {"passed": 140, "failed": 2}

def test_vitest_all_pass():
    assert d.derive(bash("pnpm test", "      Tests  142 passed (142)\n"))["tests"] == {"passed": 142, "failed": 0}

def test_pytest_counts():
    assert d.derive(bash("python3 -m pytest -q", "== 3 failed, 97 passed in 2.1s ==\n", "PostToolUseFailure"))["tests"] == {"passed": 97, "failed": 3}

def test_xcodebuild_counts():
    assert d.derive(bash("xcodebuild test -scheme A", "Executed 40 tests, with 1 failure (0 unexpected)\n"))["tests"] == {"passed": 39, "failed": 1}

def test_no_counts_for_other_commands_or_no_match():
    assert "tests" not in (d.derive(bash("git status", "Tests 5 passed")) or {})
    assert "tests" not in (d.derive(bash("pnpm test", "no summary here")) or {})

def test_only_last_4kb_is_read():
    out = "Tests  999 passed (999)\n" + "x" * 5000
    assert "tests" not in (d.derive(bash("pnpm test", out)) or {})
