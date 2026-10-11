# Vendored from ~/.claude/jev/redact.py on 2026-10-03. Keep in sync:
# hook/tests/test_redact.py::test_parity_with_jev_rules fails when the rules drift.
"""Strip secret shapes from text before it leaves the Mac."""
import re
from typing import Any, List, Pattern, Tuple

_RULES: List[Tuple[Pattern[str], str]] = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S), "[REDACTED_PEM]"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[^\n]*(?:\n[^\n]*)*$", re.S | re.M), "[REDACTED_PEM]"),
    (re.compile(r"(?i)\b(authorization|proxy-authorization|cookie|x-api-key|x-auth-token|x-access-token)\s*:\s*[^\n'\"]+"), r"\1: [REDACTED]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED_AWS_KEY_ID]"),
    (re.compile(r"(?i)(aws_secret_access_key\s*[:=]\s*)\S+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{6,}"), "Bearer [REDACTED]"),
    (re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}"
                r"|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,})"), "[REDACTED_TOKEN]"),
    (re.compile(r"(?i)\b([A-Z0-9_]{0,64}(?:PASS|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Z0-9_]{0,64})\s*=\s*(\"[^\"]*\"|'[^']*'|\S+)"), r"\1=[REDACTED]"),
    (re.compile(r"(?i)(--(?:token|password|api-key|secret)[= ])\S+"), r"\1[REDACTED]"),
    (re.compile(r"(://[^/\s:@]+:)[^@\s/]+@"), r"\1[REDACTED]@"),
    (re.compile(r"(?i)[\"']?(?:password|api_?key|client_?secret|auth_?token)[\"']?\s*[:=]\s*(\"[^\"]*\"|'[^']*'|[^\s,\n]+)"), "[REDACTED]"),
    (re.compile(r"(?i)(?:curl\s+)?(?:--?u|--user|--auth)\s+[^\s:]+:(\S+)"), r"--user [REDACTED]:[REDACTED]"),
]


_DB_TOOL = re.compile(r"\b(?:mysqldump|mysqladmin|mariadb-dump|mysql|mariadb)\b")
_CMD_END = re.compile(r"[;|&\n]")
_DB_PASS = re.compile(r"""\s-p(?!\s)('[^']*'|"[^"]*"|\S+)""")
_DB_SPAN = 2000


def _redact_db_password(text: str) -> str:
    """Redact the first -pVALUE after a mysql-family tool name. Linear: each char is scanned a bounded number of times."""
    out: List[str] = []
    pos = 0   # text already emitted up to here
    skip = 0  # tool matches starting before this offset were already covered
    for m in _DB_TOOL.finditer(text):
        if m.start() < skip:
            continue
        end = m.end()
        window = text[end:end + _DB_SPAN]
        cut = _CMD_END.search(window)
        seg_len = cut.start() if cut else len(window)
        pm = _DB_PASS.search(window, 0, seg_len)
        if not pm:
            skip = end + seg_len
            continue
        out.append(text[pos:end + pm.start(1)])
        out.append("[REDACTED]")
        pos = skip = end + pm.end(1)
    if not out:
        return text
    out.append(text[pos:])
    return "".join(out)


def redact(text: str) -> str:
    text = _redact_db_password(text)
    for pattern, repl in _RULES:
        text = pattern.sub(repl, text)
    return text


def redact_obj(obj: Any) -> Any:
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, dict):
        return {k: redact_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact_obj(v) for v in obj]
    if isinstance(obj, tuple):
        return tuple(redact_obj(v) for v in obj)
    return obj
