import { describe, expect, it } from "vitest";
import { toPosix } from "../src/winpath";

describe("toPosix (windows spec §3.2)", () => {
  it("backslashes become slashes and the drive letter is upper-cased", () => {
    expect(toPosix("c:\\Users\\dev\\Desktop\\HARBOR PC\\harbor-website")).toBe("C:/Users/dev/Desktop/HARBOR PC/harbor-website");
    expect(toPosix("C:\\Users\\dev\\Desktop\\HARBOR PC\\harbor-website")).toBe("C:/Users/dev/Desktop/HARBOR PC/harbor-website");
    expect(toPosix("c:/Users/dev/app")).toBe("C:/Users/dev/app");
  });
  it("trailing slashes go, a bare drive root stays", () => {
    expect(toPosix("C:\\proj\\")).toBe("C:/proj");
    expect(toPosix("C:\\")).toBe("C:/");
    expect(toPosix("c:")).toBe("C:/");
  });
  it("UNC paths keep their leading double slash", () => {
    expect(toPosix("\\\\server\\share\\x")).toBe("//server/share/x");
  });
  it("macOS paths come back unchanged", () => {
    for (const p of ["/Users/p/app", "/", "/Users/p/my app/", "", "relative/x"]) expect(toPosix(p)).toBe(p);
  });
});
