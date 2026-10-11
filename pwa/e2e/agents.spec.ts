import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { AG, AG_PORT, AG_SPOOL, line } from "./env";
import { probe } from "./probe";

type Pt = { x: number; y: number; r: number };
const SID = "s-ag";
const add = (...ls: string[]) => fs.appendFileSync(AG_SPOOL, ls.join(""));
const pre = (tool: string, input: Record<string, unknown>, agent?: string, useId?: string) =>
  line(SID, AG, "PreToolUse", { tool_name: tool, tool_input: input, ...(agent ? { agent_id: agent } : {}), ...(useId ? { tool_use_id: useId } : {}) });
const dispatch = (useId: string, description: string, extra: Record<string, unknown> = {}) => pre("Agent", { subagent_type: "executor", description, ...extra }, undefined, useId);
const start = (id: string, type = "executor") => line(SID, AG, "SubagentStart", { agent_id: id, agent_type: type });
const stop = (id: string, result: "pass" | "fail") => line(SID, AG, "SubagentStop", { agent_id: id, agent_type: "executor", fo: { result } });
const card = (page: Page) => page.locator(".card").first();
const lane = (page: Page, id: string) => page.locator(`.card .lane[data-aid="${id}"]`);

test.describe.serial("agents through the real server", () => {
  test.use({ baseURL: `http://127.0.0.1:${AG_PORT}` });
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "one spool, appended once"); });

  test("fan-out: three executors get three lanes and three orbs", async ({ page }) => {
    add(dispatch("u1", "T1 hook"), dispatch("u2", "T2 ingest"), dispatch("u3", "T3 ledger"), start("e1"), start("e2"), start("e3"), pre("Edit", { file_path: "/x" }, "e1"));
    await page.goto("/?probe=1");
    await expect(card(page)).toHaveClass(/has-ag/);
    await expect(card(page).locator(".lane")).toHaveCount(3);
    await expect(lane(page, "e1").locator(".t")).toHaveText("T1 hook");
    await expect(lane(page, "e1").locator(".r")).toHaveText(/^EDIT \d+:\d\d$/);
    await expect(card(page).locator(".ag .as")).toContainText("3 AGENTS");
    await expect(page.locator("#meta")).toContainText("3 AGENTS");
    await expect.poll(() => probe<Pt | null>(page, "agent", "e1"), { timeout: 10_000 }).not.toBeNull();
  });

  test("a waiting agent is the one amber lane", async ({ page }) => {
    add(line(SID, AG, "PermissionRequest", { tool_name: "Bash", agent_id: "e2" }));
    await page.goto("/?probe=1");
    await expect(lane(page, "e2")).toHaveClass(/waiting/);
    await expect(lane(page, "e2").locator(".r")).toHaveText(/^NEEDS YOU/);
    await expect(card(page).locator(".lane.waiting")).toHaveCount(1);
    await expect(card(page).locator(".ag .as")).toContainText("1 WAITING");
  });

  test("an escalation joins the failed run and its re-dispatch into one lane", async ({ page }) => {
    add(stop("e3", "fail"), pre("mcp__jev__log_escalation", { from_model: "sonnet", to_model: "opus", task: "T3 ledger" }),
      dispatch("u4", "T3 ledger", { model: "opus" }), start("e4"), pre("Read", { file_path: "/y" }, "e4"));
    await page.goto("/?probe=1");
    await expect(lane(page, "e3").locator(".r")).toHaveText(/^SONNET → OPUS · READ/);
    await expect(lane(page, "e3").locator(".pip")).toHaveClass(/\bln\b/);
    await expect(card(page).locator(".lane")).toHaveCount(3);
  });

  test("review shows the cycle tally; the escalated lane keeps its pill", async ({ page }) => {
    add(pre("Skill", { skill: "wreview" }), pre("Agent", { subagent_type: "ecc:code-reviewer", description: "review T1" }, undefined, "u5"), start("r1", "ecc:code-reviewer"));
    await page.goto("/?probe=1");
    await expect(card(page).locator(".ag .atl")).toContainText(/THIS CYCLE · 5 SPAWNED/);
    await expect(lane(page, "r1").locator(".n")).toHaveText("REVIEWER");
    await expect(lane(page, "e3").locator(".pip")).toHaveClass(/\bln\b/); // the lane is keyed by the first run (e3); the re-dispatch e4 is its head
  });
});
