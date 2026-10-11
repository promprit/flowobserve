import { describe, expect, it } from "vitest";
import { MsgZ, SessionZ } from "../src/wire";
import { hostOf, jumpUrl } from "../src/towire";

const ID = "w0t1p2:1B2C3D4E-0000-4000-8000-00000000ABCD";
const base = { id: "s1", name: "app", stage: 0, status: "active", tasksDone: 0, tasksTotal: 0,
  builders: ["idle", "idle", "idle"], deny: null, esc: false, msg: null, action: null, say: null, log: [],
  openUrl: null, startedAt: 1, since: 1, lastEventAt: 1, nodes: [], stageAt: [1, null, null, null, null, null, null] };

describe("v2 wire", () => {
  it("accepts a v2 session and a projects message", () => {
    const s = SessionZ.parse({ ...base, host: "iterm", jumpUrl: `flowobserve://jump?iterm=${encodeURIComponent(ID)}`,
      color: "#151a60", ready: { tests: true, build: null, review: true }, runnable: true });
    expect(s.host).toBe("iterm");
    const m = MsgZ.parse({ type: "projects", rootMissing: false, token: "a".repeat(64), projects: [{ key: "meadow", name: "meadow", group: null,
      color: "#D7DCC5", folders: [{ rel: "meadow", worktree: null, live: null,
      restore: [{ id: "8c1f0e2a-1111-4222-8333-444455556666", title: null, endedAt: 5 }] }] }] });
    expect(m.type).toBe("projects");
  });
  it("still accepts a v1 session", () => { expect(() => SessionZ.parse(base)).not.toThrow(); });
  it("ready carries optional counts; token must be 64 hex or null", () => {
    expect(SessionZ.parse({ ...base, ready: { tests: false, build: null, review: null, passed: 140, failed: 2 } }).ready?.failed).toBe(2);
    expect(() => MsgZ.parse({ type: "projects", rootMissing: false, token: "short", projects: [] })).toThrow();
    expect(MsgZ.parse({ type: "projects", rootMissing: true, token: null, projects: [] }).type).toBe("projects");
  });
  it("rejects a bad host and a non-hex colour", () => {
    expect(() => SessionZ.parse({ ...base, host: "kitty" })).toThrow();
    expect(() => SessionZ.parse({ ...base, color: "red" })).toThrow();
  });
  it("hostOf follows spec §5.1", () => {
    expect(hostOf(undefined)).toBe("vscode");
    expect(hostOf({ entry: "claude-vscode", program: "iTerm.app", iterm: ID })).toBe("vscode");
    expect(hostOf({ entry: "cli", program: "iTerm.app", iterm: ID })).toBe("iterm");
    expect(hostOf({ entry: "cli", program: "iTerm.app", iterm: "garbage" })).toBe("terminal");
    expect(hostOf({ entry: "cli", program: "Apple_Terminal", iterm: null })).toBe("terminal");
  });
  it("jumpUrl only for iterm", () => {
    expect(jumpUrl({ entry: "cli", program: "iTerm.app", iterm: ID })).toBe(`flowobserve://jump?iterm=${encodeURIComponent(ID)}`);
    expect(jumpUrl({ entry: "claude-vscode", program: null, iterm: null })).toBeNull();
  });
});
