from fo_derive import derive, pick_line, plan_tasks, rel_path, result, say_line, to_posix, tool_say


def test_plan_tasks_counts_task_headings_in_plan_writes():
    content = "# Plan\n### Task 1: a\nx\n## Task 2: b\n#### Task 3 is not a heading level we count\n"
    p = {"tool_name": "Write", "tool_input": {"file_path": "/r/docs/superpowers/plans/2026-x.md", "content": content}}
    assert plan_tasks(p) == 2
    p2 = {"tool_name": "Write", "tool_input": {"file_path": "/r/.orchestrate/PLAN.md", "content": "### Task 1: a"}}
    assert plan_tasks(p2) == 1
    p3 = {"tool_name": "Write", "tool_input": {"file_path": "/r/src/a.md", "content": "### Task 1"}}
    assert plan_tasks(p3) is None


def test_result_reads_done_criteria_line():
    assert result("CHANGED: a\nDONE-CRITERIA: tests pass: met; lint: met\nCONFIDENCE: 0.9") == "pass"
    assert result("DONE-CRITERIA: tests pass: met; lint: not met") == "fail"
    assert result("no report here") == "unknown"
    assert result(None) == "unknown"


def test_say_line_first_line_collapsed_and_clipped():
    assert say_line("\n\n  hello   world \nsecond") == "hello world"
    assert say_line("x" * 200) == "x" * 139 + "…"
    assert say_line(None) == ""


def test_derive_per_event():
    assert derive({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "git status"}}) == {"say": "Bash · git status"}
    assert derive({"hook_event_name": "PreToolUse", "tool_name": "Skill", "tool_input": {"skill": "superpowers:writing-plans"}}) == {"say": "skill · superpowers:writing-plans"}
    d = derive({"hook_event_name": "SubagentStop", "last_assistant_message": "Done.\nDONE-CRITERIA: a: met"})
    assert d == {"result": "pass", "say": "Done."}
    assert derive({"hook_event_name": "Stop", "last_assistant_message": "All set"}) == {"say": "All set"}
    assert derive({"hook_event_name": "UserPromptSubmit", "prompt": "hi"}) == {}


def test_say_redacts_before_clipping():
    cmd = "x" * 120 + " sk-ant-api03-" + "A" * 40
    d = derive({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": cmd}})
    assert "sk-ant" not in d["say"]
    for ev in ("Stop", "SubagentStop"):
        d = derive({"hook_event_name": ev, "last_assistant_message": "y" * 125 + " sk-ant-api03-" + "B" * 40})
        assert "sk-ant" not in d["say"]


def test_result_partial_is_fail():
    assert result("DONE-CRITERIA: tests: partially met") == "fail"
    assert result("DONE-CRITERIA: tests: Partial") == "fail"
    assert result("DONE-CRITERIA: tests: NOT MET") == "fail"
    assert result("DONE-CRITERIA: tests: met") == "pass"


def _pre(name, **ti):
    return {"hook_event_name": "PreToolUse", "tool_name": name, "tool_input": ti}


def test_tool_say_humanizes_mcp_names():
    assert tool_say(_pre("mcp__plugin_playwright_playwright__browser_navigate", url="https://x.dev")) .startswith("playwright · browser navigate")
    assert tool_say(_pre("mcp__jev__jev_judge")) == "jev · judge"
    assert tool_say(_pre("mcp__ruflo__memory_search")) == "ruflo · memory search"
    assert "mcp__" not in tool_say(_pre("mcp__jev__log_escalation"))


def test_tool_say_internal_tools():
    assert tool_say(_pre("SubagentHandback", message="x")) == "agent report"
    assert tool_say(_pre("AskUserQuestion", questions=[])) == "question for you"
    assert tool_say(_pre("Skill", skill="superpowers:writing-plans")) == "skill · superpowers:writing-plans"
    assert tool_say(_pre("Agent", description="Explore the repo", prompt="p")) == "agent · Explore the repo"
    assert tool_say(_pre("ToolSearch", query="select:Foo")) == "load tools"


def test_tool_say_builtins_keep_name_and_bash_description():
    assert tool_say(_pre("Read", file_path="/a/b.py")) == "Read · /a/b.py"
    assert tool_say(_pre("Bash", command="git status", description="Show status")) == "Bash · Show status"
    assert tool_say(_pre("Bash", command="git status", description="")) == "Bash · git status"
    assert tool_say(_pre("Bash", command="git status", description=5)) == "Bash · git status"
    assert tool_say(_pre("Bash", command="git status")) == "Bash · git status"


def test_bash_without_description_says_verb():
    def say(c):
        return tool_say(_pre("Bash", command=c))
    assert say("git status") == "Bash · git status"
    assert say("cd /x; pnpm -r typecheck 2>&1 | tail") == "Bash · pnpm typecheck"
    assert say('P=(a b c); git add "${P[@]}" && git commit -q -m x -- "${P[@]}"') == "Bash · git add"
    assert say("API_TOKEN=abc123 make") == "Bash · make"
    assert say("until mkdir /tmp/l 2>/dev/null; do sleep 5; done") == "Bash · until"
    assert say("/usr/bin/python3 -m pytest") == "Bash · python3 pytest"
    assert say("") == "Bash" and say("  \n ") == "Bash"


def test_derive_pre_tool_use_uses_humanized_say():
    assert derive(_pre("mcp__jev__jev_judge"))["say"] == "jev · judge"
    assert derive({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "ls", "description": "List files"}}) == {"say": "Bash · List files"}


def test_pick_line_prefers_last_question():
    msg = "Here is the plan.\nShould I use A?\nSome detail.\nWhich option do you want?\nThanks"
    assert pick_line(msg) == "Which option do you want?"


def test_pick_line_first_substantive_line():
    assert pick_line("Done:\nok\nAll four tasks are merged and green.\nmore text here too") == "All four tasks are merged and green."
    assert pick_line("Summary:\nThree files changed in total.") == "Three files changed in total."


def test_pick_line_falls_back_to_first_line():
    assert pick_line("Done.\nok") == "Done."
    assert pick_line("All set") == "All set"


def test_pick_line_strips_markdown():
    assert pick_line("## Heading\n**Bold** and `code` words here today") == "Bold and code words here today"
    assert pick_line("- see [the docs](http://x.dev/a) for more info") == "see the docs for more info"
    assert pick_line("> **Ready to merge?**") == "Ready to merge?"
    assert pick_line("* item one two three four") == "item one two three four"


def test_pick_line_odd_inputs_never_raise():
    for v in (None, "", "   \n ", 5, [], {}, b"x"):
        assert isinstance(pick_line(v), (str, type(v)))
    assert pick_line("") in ("", None)


def test_derive_stop_uses_pick_line_and_redacts():
    d = derive({"hook_event_name": "Stop", "last_assistant_message": "Working on it.\nShall I merge now?\nbye"})
    assert d == {"say": "Shall I merge now?"}
    d = derive({"hook_event_name": "SubagentStop", "last_assistant_message": "Report:\nAll criteria were checked and passed.\nDONE-CRITERIA: a: met"})
    assert d == {"result": "pass", "say": "All criteria were checked and passed."}
    d = derive({"hook_event_name": "Stop", "last_assistant_message": "Is this key sk-ant-api03-" + "A" * 40 + " ok?"})
    assert "sk-ant" not in d["say"]
    assert derive({"hook_event_name": "Stop", "last_assistant_message": None}) == {}


def test_pick_line_skips_headings_and_tables_when_picking_the_question():
    msg = "## Jobs: what must this screen tell me?\n| a | b |\n|---|---|\nShould I apply all seven, or a subset? I'd like N1 now.\nGo with A?"
    assert pick_line(msg) == "Go with A?"
    assert pick_line("# Title?\nWhich option do you want?\nbye") == "Which option do you want?"


def test_pick_line_headings_only_still_returns_something():
    assert pick_line("## Only a heading?") == "Only a heading?"


def test_rel_path_is_project_relative_and_collapses_long_middles():
    cwd = "/Users/dev/code/flowobserve"
    assert rel_path(cwd + "/server/src/a.ts", cwd) == "server/src/a.ts"
    assert rel_path(cwd + "/docs/superpowers/plans/2026-10-04-perf-host-health.md", cwd) == "docs/…/2026-10-04-perf-host-health.md"
    assert rel_path("/etc/hosts", cwd) == "/etc/hosts"
    assert rel_path("/a/b", None) == "/a/b"


def test_tool_say_file_tools_use_relative_paths():
    p = {"tool_name": "Write", "cwd": "/r/app", "tool_input": {"file_path": "/r/app/src/x.ts", "content": "x"}}
    assert tool_say(p) == "Write · src/x.ts"
    p = {"tool_name": "Read", "cwd": "/r/app", "tool_input": {"file_path": "/r/app/README.md"}}
    assert tool_say(p) == "Read · README.md"


def test_bash_verb_skips_flag_values():
    from fo_derive import bash_verb
    assert bash_verb("git -C /repo status") == "Bash · git status"
    assert bash_verb("sudo make install") == "Bash · make install"
    assert bash_verb("sudo git status") == "Bash · git status"
    assert bash_verb("env FOO=1 BAR=2 node build.js") == "Bash · node build.js"
    assert bash_verb("time nohup exec pnpm test") == "Bash · pnpm test"
    assert bash_verb('python3 -c "print(1)"') == "Bash · python3"
    assert bash_verb("python3 -m pytest -q") == "Bash · python3 pytest"
    assert bash_verb("node -e 'x'") == "Bash · node"
    assert bash_verb("(cd /x && git --git-dir /g status") == "Bash · git status"
    assert bash_verb("(cd x && make)") == "Bash · make"
    assert bash_verb("(git status)") == "Bash · git status"


def test_to_posix_windows_and_posix():
    assert to_posix("c:\\proj\\src\\a.ts") == "C:/proj/src/a.ts"
    assert to_posix("/Users/p/app") == "/Users/p/app"


def test_rel_path_windows():
    assert rel_path("C:\\proj\\src\\a.ts", "c:\\proj") == "src/a.ts"


def test_plan_tasks_counts_a_windows_plan_path():
    p = {"tool_name": "Write", "tool_input": {"file_path": "C:\\p\\docs\\superpowers\\plans\\x.md",
                                               "content": "## Task 1: a\n\n### Task 2: b\n"}}
    assert plan_tasks(p) == 2
