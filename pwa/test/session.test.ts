import { describe, expect, it } from "vitest";
import { copyText, ctxLabel, nextStep, sessionLink, showRow } from "../src/ui/session";
import { safeSessionUrl } from "../src/util";

const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ctx = (pct: number, level: "ok" | "warn" | "crit") => ({ pct, tokens: 1, window: 200_000, level });

describe("session buttons", () => {
  it("context reads what is left", () => {
    expect(ctxLabel({ ctx: ctx(0.19, "ok") })!.text).toBe("81% LEFT");
    expect(ctxLabel({ ctx: ctx(0.995, "crit") })!.text).toBe("0% LEFT");
  });
  it("ctxLabel: whole percent with its level; hidden without ctx (old server)", () => {
    expect(ctxLabel({ ctx: ctx(0.421, "ok") })).toEqual({ text: "57% LEFT", level: "ok" });
    expect(ctxLabel({ ctx: ctx(0.61, "warn") })).toEqual({ text: "39% LEFT", level: "warn" });
    expect(ctxLabel({ ctx: null })).toBeNull();
    expect(ctxLabel({})).toBeNull();
  });
  it("nextStep: CLEAR once a handoff is saved, RESUME on a card started by /clear, else HANDOFF", () => {
    expect(nextStep({ handoff: { savedAt: 1 }, fromClear: false })).toBe("clear");
    expect(nextStep({ handoff: null, fromClear: true })).toBe("resume");
    expect(nextStep({ handoff: null, fromClear: false })).toBe("handoff");
    expect(nextStep({})).toBe("handoff");
  });
  it("sessionLink is focus-only for every step; bad ids give no link", () => {
    const u = `vscode://anthropic.claude-code/open?session=${ID}`;
    expect(sessionLink(ID, "handoff")).toBe(u);
    expect(sessionLink(ID, "clear")).toBe(u);
    expect(sessionLink(ID, "resume")).toBe(u);
    expect(sessionLink("x&prompt=rm", "resume")).toBeNull();
  });
  it("copyText: handoff and clear copy their command, resume copies the resume prompt", () => {
    expect(copyText("handoff")).toBe("/handoff");
    expect(copyText("clear")).toBe("/clear");
    expect(copyText("resume")).toBe("Continue from the handoff");
  });
  it("only session-open links pass the safe check", () => {
    expect(safeSessionUrl(sessionLink(ID, "handoff"))).not.toBeNull();
    expect(safeSessionUrl("vscode://anthropic.claude-code/install-plugin?plugin=x")).toBeNull();
    expect(safeSessionUrl("javascript:alert(1)")).toBeNull();
    expect(safeSessionUrl(null)).toBeNull();
  });
  it("showRow: always on the focused card and at warn or crit; otherwise only on hover (CSS)", () => {
    expect(showRow({ ctx: ctx(0.1, "ok") }, true)).toBe(true);
    expect(showRow({ ctx: ctx(0.6, "warn") }, false)).toBe(true);
    expect(showRow({ ctx: ctx(0.7, "crit") }, false)).toBe(true);
    expect(showRow({ ctx: ctx(0.1, "ok") }, false)).toBe(false);
    expect(showRow({}, false)).toBe(false);
  });
});
