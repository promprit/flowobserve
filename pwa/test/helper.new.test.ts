import { beforeEach, describe, expect, it } from "vitest";
import { helperUrl, NAME_RE, nameProblem } from "../src/helper";
import { store } from "../src/state";
import { reset } from "./helpers";

const setTokenForTest = (t: string) => { store.helperToken = t; };
beforeEach(() => { reset(); });

describe("helperUrl root label", () => {
  it("open without a root keeps today's URL", () => {
    setTokenForTest("a".repeat(64));
    expect(helperUrl.open("app")).not.toMatch(/root=/);
  });
  it("open with a root adds root=<label>", () => {
    setTokenForTest("a".repeat(64));
    expect(helperUrl.open("app", [], false, "Dev")).toMatch(/[?&]root=Dev(&|$)/);
  });
  it("run and diff accept a root label", () => {
    setTokenForTest("a".repeat(64));
    expect(helperUrl.run("app", "Dev")).toMatch(/root=Dev/);
    expect(helperUrl.diff("app", "Dev")).toMatch(/root=Dev/);
  });
});

describe("newProject", () => {
  it("builds flowobserve://new with root, name and t", () => {
    setTokenForTest("a".repeat(64));
    const u = helperUrl.newProject("Dev", "my-app")!;
    expect(u).toMatch(/^flowobserve:\/\/new\?root=Dev&name=my-app&t=/);
    expect(u.split("&").length).toBe(3);  // root, name, t — nothing else
  });
  it("returns null for an invalid name or root label", () => {
    setTokenForTest("a".repeat(64));
    expect(helperUrl.newProject("Dev", "a/b")).toBeNull();
    expect(helperUrl.newProject("/etc", "app")).toBeNull();
  });
});

describe("name rules", () => {
  it.each([".", "..", ".hidden", "dot.", "a b", "a/b", "ü", "x".repeat(65), ""])("rejects %j", (n) => {
    expect(NAME_RE.test(n)).toBe(false);
    expect(nameProblem(n)).toBe("Letters, digits, . _ - only · 1–64");
  });
  it("accepts a plain name", () => {
    expect(NAME_RE.test("rom-app_2")).toBe(true);
    expect(nameProblem("rom-app_2", false)).toBeNull();
  });
  it("reports an existing sibling", () => {
    expect(nameProblem("flowobserve", true)).toBe("Already a folder here — open it below");
  });
});
