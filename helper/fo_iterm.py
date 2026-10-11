"""iTerm2 control for the flowobserve helper: fixed AppleScripts, arguments only via `item n of argv`."""
import os
import subprocess

OSASCRIPT = "/usr/bin/osascript"

LIST_SCRIPT = """on run argv
  set sep to character id 9
  set out to ""
  tell application id "com.googlecode.iterm2"
    set cw to ""
    if (count of windows) > 0 and (current window is not missing value) then set cw to ((id of current window) as text)
    set out to "C" & sep & cw & linefeed
    repeat with w in windows
      repeat with t in tabs of w
        set ss to sessions of t
        set ks to ""
        repeat with s in ss
          set k to ""
          set kd to ""
          try
            tell s to set k to (variable named "user.fo_project")
          end try
          try
            tell s to set kd to (variable named "user.fo_kind")
          end try
          if k is missing value then set k to ""
          if kd is missing value then set kd to ""
          if k is not "" then
            if ks is not "" then set ks to ks & "|"
            set ks to ks & k & ":" & kd
          end if
        end repeat
        set out to out & "T" & sep & ((id of w) as text) & sep & (id of item 1 of ss) & sep & ((count of ss) as text) & sep & ks & linefeed
      end repeat
    end repeat
  end tell
  return out
end run"""

OPEN_SCRIPT = """on run argv
  set cmdText to item 1 of argv
  set mode to item 5 of argv
  set target to item 6 of argv
  tell application id "com.googlecode.iterm2"
    activate
    set s to missing value
    if mode is "split" then
      repeat with w in windows
        repeat with t in tabs of w
          if s is missing value and (id of item 1 of sessions of t) = target then
            set n to count of sessions of t
            if n > 3 then
              tell w to set t2 to (create tab with default profile)
              if t2 is not missing value then set s to current session of t2
            else if n = 1 then
              tell item 1 of sessions of t to set s to (split vertically with default profile)
            else if n = 2 then
              tell item 1 of sessions of t to set s to (split horizontally with default profile)
            else if n = 3 then
              tell item 2 of sessions of t to set s to (split horizontally with default profile)
            end if
          end if
        end repeat
      end repeat
    else if mode is "tab" then
      repeat with w in windows
        if s is missing value and ((id of w) as text) = target then
          tell w to set t2 to (create tab with default profile)
          if t2 is not missing value then set s to current session of t2
        end if
      end repeat
    end if
    if s is missing value then
      set w to (create window with default profile)
      set s to current session of w
    end if
    try
      tell s to set variable named "user.fo_project" to (item 7 of argv)
      tell s to set variable named "user.fo_kind" to (item 8 of argv)
    end try
    set background color of s to {(item 2 of argv) as integer, (item 3 of argv) as integer, (item 4 of argv) as integer}
    tell s to write text cmdText
    return id of s
  end tell
end run"""

# Args: session id. Returns "ok" after selecting it, else "missing".
JUMP_SCRIPT = """on run argv
  set wanted to item 1 of argv
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s) = wanted then
            select w
            select t
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run"""

# Args: session id, text. Types the text into that session; "ok" or "missing".
STEP_SCRIPT = """on run argv
  set wanted to item 1 of argv
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s) = wanted then
            tell s to write text (item 2 of argv)
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run"""

# Args: session id. Returns the session's visible contents, or "" when it is gone.
CONTENTS_SCRIPT = """on run argv
  set wanted to item 1 of argv
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s) = wanted then return contents of s
        end repeat
      end repeat
    end repeat
  end tell
  return ""
end run"""

# Args: text.
NOTIFY_SCRIPT = """on run argv
  display notification (item 1 of argv) with title "flowobserve"
end run"""


def osascript(script, args):
    """Run a fixed script with argv. `--` ends osascript's own options, so an argument
    starting with `-` (e.g. "-e ...") can never be read as another statement."""
    r = subprocess.run([OSASCRIPT, "-e", script, "--", *[str(a) for a in args]],
                       capture_output=True, text=True, check=True, timeout=30)
    return r.stdout.rstrip("\n")


def notify(text):
    if os.environ.get("FO_HELPER_QUIET") == "1":  # test-only: lets the subprocess test run without posting
        return
    osascript(NOTIFY_SCRIPT, [text])
