import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@fo/shared";
import { go, helperUrl, itermOf, relOf, safeHelperUrl } from "../src/helper";
import { store } from "../src/state";
import { nav } from "../src/util";
import { reset } from "./helpers";

const U = "0123abcd-4567-89ab-cdef-0123456789ab";
const U2 = "ffffffff-4567-89ab-cdef-0123456789ab";
const TOKEN = "a".repeat(64);
const T = `&t=${TOKEN}`;
const ITERM = `w0t1p2:${U}`;
const ENC = `w0t1p2%3A${U}`;

beforeEach(() => { reset(); store.helperToken = TOKEN; });

describe("helperUrl", () => {
  it("builds only valid helper URLs", () => {
    expect(helperUrl.open("meadow")).toBe(`flowobserve://open?path=meadow${T}`);
    expect(helperUrl.open("dryas/site", [U])).toBe(`flowobserve://open?path=dryas%2Fsite&resume=${U}${T}`);
    expect(helperUrl.open("my app")).toBe(`flowobserve://open?path=my%20app${T}`);
    expect(helperUrl.run("meadow")).toBe(`flowobserve://run?path=meadow${T}`);
    expect(helperUrl.step(ITERM, "handoff")).toBe(`flowobserve://step?iterm=${ENC}&do=handoff${T}`);
  });

  it("joins several resume ids and allows exactly 12", () => {
    expect(helperUrl.open("a", [U, U2])).toBe(`flowobserve://open?path=a&resume=${U}%2C${U2}${T}`);
    expect(helperUrl.open("a", Array(12).fill(U))).not.toBeNull();
  });

  it("rejects bad paths", () => {
    for (const rel of ["../x", "/abs", "a;b", "a/./b", "a/../b", "", "a//b", "a\nb", "a/.."]) {
      expect(helperUrl.open(rel), rel).toBeNull();
      expect(helperUrl.run(rel), rel).toBeNull();
    }
  });

  it("rejects too many or malformed resume ids", () => {
    expect(helperUrl.open("a", Array(13).fill(U))).toBeNull();
    expect(helperUrl.open("a", ["nope"])).toBeNull();
    expect(helperUrl.open("a", [U + "x"])).toBeNull();
    expect(helperUrl.open("a", [`${U.slice(0, 35)},`])).toBeNull();
  });

  it("rejects bad iTerm ids and step names", () => {
    expect(helperUrl.step("w0t1p2", "clear")).toBeNull();
    expect(helperUrl.step(`w0t1:${U}`, "clear")).toBeNull();
    expect(helperUrl.step(`w0t1p2:${U}x`, "clear")).toBeNull();
    expect(helperUrl.step(ENC, "clear")).toBeNull();
    expect(helperUrl.step(ITERM, "exec" as never)).toBeNull();
  });


  it("builds the wt link, and refuses wt together with resume", () => {
    expect(helperUrl.open("meadow", [], true)).toBe(`flowobserve://open?path=meadow&wt=1${T}`);
    expect(helperUrl.open("meadow", [U], true)).toBeNull();
    expect(helperUrl.open("meadow", [], false)).toBe(`flowobserve://open?path=meadow${T}`);
  });

  it("every builder returns null without a token", () => {
    store.helperToken = null;
    expect(helperUrl.open("meadow")).toBeNull();
    expect(helperUrl.run("meadow")).toBeNull();
    expect(helperUrl.step(ITERM, "handoff")).toBeNull();
  });
});

describe("safeHelperUrl, itermOf, go", () => {
  const jump = `flowobserve://jump?iterm=${ENC}`;

  it("accepts open/run/step/jump shapes, nothing else", () => {
    expect(safeHelperUrl(helperUrl.open("meadow"))).not.toBeNull();
    expect(safeHelperUrl(helperUrl.run("meadow"))).not.toBeNull();
    expect(safeHelperUrl(helperUrl.step(ITERM, "clear"))).not.toBeNull();
    expect(safeHelperUrl(jump)).toBe(jump);
    expect(safeHelperUrl(helperUrl.open("meadow", [], true))).not.toBeNull();
    expect(safeHelperUrl("flowobserve://open?path=a&wt=1")).not.toBeNull();
    expect(safeHelperUrl(`flowobserve://open?path=a&resume=${U}&wt=1${T}`)).toBeNull();
    expect(safeHelperUrl(`flowobserve://open?path=a&wt=0${T}`)).toBeNull();
    expect(safeHelperUrl(`flowobserve://open?path=a&wt=1&resume=${U}${T}`)).toBeNull();
    expect(safeHelperUrl(`flowobserve://open?path=a${T}&wt=1`)).toBeNull();
    expect(safeHelperUrl("flowobserve://exec?x")).toBeNull();
    expect(safeHelperUrl(`flowobserve://reply?iterm=${ENC}&text=approved${T}`)).toBeNull();
    expect(safeHelperUrl("javascript:alert(1)")).toBeNull();
    expect(safeHelperUrl("https://evil.example/")).toBeNull();
    expect(safeHelperUrl("flowobserve://open?path=../x")).toBeNull();
    expect(safeHelperUrl("flowobserve://jump?iterm=bad")).toBeNull();
    expect(safeHelperUrl(null)).toBeNull();
    expect(safeHelperUrl(undefined)).toBeNull();
  });

  it("itermOf decodes a jump url or gives null", () => {
    expect(itermOf(jump)).toBe(ITERM);
    expect(itermOf("flowobserve://jump?iterm=bad")).toBeNull();
    expect(itermOf("javascript:alert(1)")).toBeNull();
    expect(itermOf(null)).toBeNull();
  });

  it("go navigates only for safe helper or vscode urls", () => {
    const spy = vi.spyOn(nav, "go").mockImplementation(() => {});
    expect(go("javascript:alert(1)")).toBe(false);
    expect(go(null)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(go(jump)).toBe(true);
    expect(spy).toHaveBeenLastCalledWith(`${jump}${T}`);   // a jump url arrives without a token; go appends the store token
    expect(go(`${jump}&t=${"b".repeat(64)}`)).toBe(false);  // a foreign token is never forwarded
    spy.mockClear();
    expect(go("vscode://file/Volumes/x")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("go refuses a helper url when there is no token", () => {
    const spy = vi.spyOn(nav, "go").mockImplementation(() => {});
    store.helperToken = null;
    expect(go(jump)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("relOf", () => {
  it("finds the folder whose live session is the id", () => {
    const p = (key: string, folders: Project["folders"]): Project => ({ key, name: key, group: null, color: "#aabbcc", folders });
    store.projects = [
      p("a", [{ rel: "a", worktree: null, live: "s1", restore: [] }]),
      p("dryas", [{ rel: "dryas/site", worktree: null, live: null, restore: [] }, { rel: "dryas/os", worktree: "wt", live: "s2", restore: [] }]),
    ];
    expect(relOf("s1")).toBe("a");
    expect(relOf("s2")).toBe("dryas/os");
    expect(relOf("nope")).toBeNull();
  });
});

describe("helperUrl colour", () => {
  it("adds c before the token, lower-cased, without #", () => {
    expect(helperUrl.open("app", [], false, null, "#E06C75")).toBe(`flowobserve://open?path=app&c=e06c75${T}`);
    expect(helperUrl.open("app", [], true, "Dev", "#e06c75")).toBe(`flowobserve://open?path=app&wt=1&root=Dev&c=e06c75${T}`);
    expect(helperUrl.run("app", null, "#61afef")).toBe(`flowobserve://run?path=app&c=61afef${T}`);
    expect(helperUrl.diff("app", null, "#61afef")).toBe(`flowobserve://diff?path=app&c=61afef${T}`);
  });
  it("omits c for null or malformed colours", () => {
    expect(helperUrl.open("app", [], false, null, null)).toBe(`flowobserve://open?path=app${T}`);
    expect(helperUrl.open("app", [], false, null, "red")).toBe(`flowobserve://open?path=app${T}`);
    expect(helperUrl.run("app", null, "#12345")).toBe(`flowobserve://run?path=app${T}`);
  });
  it("safeHelperUrl accepts c only as 6 lower-case hex", () => {
    expect(safeHelperUrl(`flowobserve://open?path=app&c=e06c75${T}`)).not.toBeNull();
    expect(safeHelperUrl(`flowobserve://run?path=app&root=Dev&c=e06c75${T}`)).not.toBeNull();
    expect(safeHelperUrl(`flowobserve://open?path=app&c=E06C75${T}`)).toBeNull();
    expect(safeHelperUrl(`flowobserve://open?path=app&c=%23e06c75${T}`)).toBeNull();
  });
});
