import { describe, expect, it } from "vitest";
import { parseRcLine } from "../src/transcript";

const TAKE = JSON.stringify({ type: "system", subtype: "informational", timestamp: "2026-10-07T05:00:00.000Z",
  content: "Remote Control disconnected — another connection took over this session (code 4090)" });
const BRIDGE = (id: string) => JSON.stringify({ type: "bridge-session", sessionId: "x", bridgeSessionId: id, lastSequenceNum: 0 });

describe("parseRcLine", () => {
  it("takeover → its timestamp", () => expect(parseRcLine(TAKE)).toEqual({ kind: "takeover", ts: Date.parse("2026-10-07T05:00:00.000Z") }));
  it("non-empty bridge → bridge", () => expect(parseRcLine(BRIDGE("cse_01A"))).toEqual({ kind: "bridge" }));
  it("empty bridge id → null", () => expect(parseRcLine(BRIDGE(""))).toBeNull());
  it("other informational text → null", () =>
    expect(parseRcLine(JSON.stringify({ type: "system", subtype: "informational", content: "Compacted", timestamp: "2026-10-07T05:00:00Z" }))).toBeNull());
  it("takeover without a valid timestamp → null", () =>
    expect(parseRcLine(JSON.stringify({ type: "system", subtype: "informational", content: "Remote Control disconnected — x" }))).toBeNull());
  it("garbage → null", () => expect(parseRcLine("{nope Remote Control disconnected")).toBeNull());
  it("never returns ids or text", () => expect(JSON.stringify(parseRcLine(TAKE))).not.toMatch(/4090|cse_|disconnected/));
});
