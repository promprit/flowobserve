import { describe, expect, it } from "vitest";
import { parseSpoolLine, toEvents } from "../src/ingest";
import { mk } from "./helpers";

const a = mk();
const ev = (raw: string) => toEvents(parseSpoolLine(raw)!)!;

describe("log_dispatch", () => {
  it("emits TaskDispatch with task and role, besides ToolPre", () => {
    const es = ev(a.pre(1, "mcp__jev__log_dispatch", { task: "worktree-klum-m0:3", role: "coder", tier: "sonnet" }));
    expect(es.map((e) => e.k)).toEqual(["ToolPre", "TaskDispatch"]);
    expect(es[1]).toMatchObject({ k: "TaskDispatch", task: "worktree-klum-m0:3", role: "coder", tier: "sonnet" });
  });
  it("emits nothing extra when task is empty", () => {
    expect(ev(a.pre(1, "mcp__jev__log_dispatch", { task: "", role: "coder" })).map((e) => e.k)).toEqual(["ToolPre"]);
  });
});
