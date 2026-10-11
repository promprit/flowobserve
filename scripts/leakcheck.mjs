#!/usr/bin/env node
// Fails (exit 1) if any file under [dir] holds a secret-shaped string, a real home path, or a denylisted string.
// Extra rules: $FO_LEAK_DENYLIST, else scripts/private/leak-denylist.txt if present (private repo only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(process.argv[2] ?? ".");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".worktrees", "test-results", "playwright-report", "private"]);
const BASE = [
  ["secret: anthropic", /sk-ant-[A-Za-z0-9_-]{10,}/],
  ["secret: github", /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
  ["secret: aws", /\bAKIA[0-9A-Z]{16}\b/],
  ["secret: private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["secret: assignment", /\b(?:api[_-]?key|secret|password|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\/+=-]{20,}["']/i],
];
// Home-path rules: a line marked leakcheck:allow skips only these, never the secret rules.
const N = "(?![A-Za-z0-9._-])"; // end of a name segment
const HOME = [
  ["home path", new RegExp(`/Users/(?!(?:dev|p|Shared)${N})[A-Za-z0-9._-]+`)],
  ["home path", new RegExp(`[A-Za-z]:\\\\\\\\?Users\\\\\\\\?(?!dev${N})[A-Za-z0-9._-]+`)],
  ["home path: encoded", /-Users-(?!(?:dev|p)-)[A-Za-z0-9._]+-/],
  ["home path: linux", /\/home\/(?!(?:dev|runner)\/)[A-Za-z0-9._-]+\//],
];
const denyFile = process.env.FO_LEAK_DENYLIST ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "private", "leak-denylist.txt");
const DENY = denyFile && fs.existsSync(denyFile)
  ? fs.readFileSync(denyFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => [`denylist: ${l}`, new RegExp(l)])
  : [];

const hits = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) continue; // binary
    const rules = e.name === "LICENSE" ? BASE : [...BASE, ...DENY];
    buf.toString("utf8").split("\n").forEach((line, i) => {
      const allowed = line.includes("leakcheck:allow");
      for (const [name, re] of [...rules, ...(allowed ? [] : HOME)]) if (re.test(line)) hits.push(`${path.relative(dir, p)}:${i + 1}: ${name}`);
    });
  }
};
walk(dir);
if (hits.length) { console.log(hits.join("\n")); process.exit(1); }
console.log(`leakcheck: clean (${DENY.length} denylist rules)`);
