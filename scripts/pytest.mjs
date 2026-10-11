// Runs the Python suites with the platform's interpreter (windows spec §3.6). Extra args go to pytest.
import { spawnSync } from "node:child_process";

const win = process.platform === "win32";
// The iTerm2 helper is macOS-only; its tests are not collected on Windows.
const dirs = win ? ["hook/tests", "scripts/tests"] : ["hook/tests", "scripts/tests", "helper/tests"];
const args = ["-m", "pytest", ...dirs, "-q", ...process.argv.slice(2)];
const cands = process.env.FO_TEST_PYTHON ? [[process.env.FO_TEST_PYTHON]]
  : process.platform === "darwin" ? [["/usr/bin/python3"]]
  : win ? [["py", "-3"], ["python"]] : [["python3"]];
for (const [cmd, ...pre] of cands) {
  const r = spawnSync(cmd, [...pre, ...args], { stdio: "inherit" });
  if (r.error && r.error.code === "ENOENT") continue;
  process.exit(r.status ?? 1);
}
console.error("pytest.mjs: no Python found (set FO_TEST_PYTHON)");
process.exit(1);
