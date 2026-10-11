import { describe, expect, it } from "vitest";
import { SessionZ } from "../src/wire";

const base = { id: "a", name: "a", stage: 0, status: "active", tasksDone: 0, tasksTotal: 0, builders: ["idle", "idle", "idle"], deny: null, esc: false,
  msg: null, action: null, say: null, log: [], openUrl: null, startedAt: 0, since: 0, lastEventAt: 0, nodes: [], stageAt: [0, null, null, null, null, null, null] };
describe("Session.rc", () => {
  it("accepts absent, null and {takenOverAt}", () => {
    expect(SessionZ.safeParse(base).success).toBe(true);
    expect(SessionZ.safeParse({ ...base, rc: null }).success).toBe(true);
    expect(SessionZ.safeParse({ ...base, rc: { takenOverAt: 5 } }).success).toBe(true);
  });
  it("rejects extra keys (no ids on the wire)", () =>
    expect(SessionZ.safeParse({ ...base, rc: { takenOverAt: 5, bridgeSessionId: "cse_1" } }).success).toBe(false));
});
