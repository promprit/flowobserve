import { describe, expect, it } from "vitest";
import { STAGES, cardLabel } from "../src/status";
import { MsgZ } from "../src/wire";

const s = (stage: number, tasksDone = 0, tasksTotal = 0) => ({ stage, tasksDone, tasksTotal });

describe("cardLabel", () => {
  it("names the stage and task progress for each status", () => {
    expect(STAGES).toEqual(["BRAINSTORM", "PLAN", "JUDGE", "BUILD", "ESCALATE", "REVIEW", "SHIP"]);
    expect(cardLabel(s(3, 1, 4), "active")).toBe("BUILD · TASK 1/4");
    expect(cardLabel(s(1), "active")).toBe("PLAN");
    expect(cardLabel(s(1, 0, 3), "waiting")).toBe("PLAN · NEEDS YOU");
    expect(cardLabel(s(4, 2, 5), "escalated")).toBe("ESCALATE · TASK 2/5");
    expect(cardLabel(s(4, 2, 5), "handoff")).toBe("ESCALATE · FABLE ✗");
    expect(cardLabel(s(3, 0, 3), "deny")).toBe("BUILD · JEV DENY · TASK 0/3");
    expect(cardLabel(s(6, 3, 3), "shipped")).toBe("SHIPPED · MERGED");
    expect(cardLabel(s(0), "idle")).toBe("BRAINSTORM · IDLE");
  });

  it("never renders TASK x/y with x > y, no suffix when total is 0", () => {
    expect(cardLabel(s(3, 5, 3), "active")).toBe("BUILD · TASK 3/3");
    expect(cardLabel(s(4, 5, 3), "escalated")).toBe("ESCALATE · TASK 3/3");
    expect(cardLabel(s(3, 5, 3), "deny")).toBe("BUILD · JEV DENY · TASK 3/3");
    expect(cardLabel(s(3, 1, 0), "active")).toBe("BUILD");
  });

  it("never throws on an out-of-range stage", () => {
    expect(cardLabel(s(9), "active")).toBe("BRAINSTORM");
  });
});

describe("hb message", () => {
  it("is part of the wire contract", () => {
    expect(MsgZ.parse({ type: "hb", at: 1 })).toEqual({ type: "hb", at: 1 });
    expect(() => MsgZ.parse({ type: "hb" })).toThrow();
  });
});
