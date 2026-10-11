import { describe, expect, it } from "vitest";
import { glyphOf } from "../src/ui/glyph";

describe("glyphOf", () => {
  it("maps the hook's humanized prefixes", () => {
    expect(glyphOf("Write · src/x.ts")).toEqual({ g: "✎", cls: "edit" });
    expect(glyphOf("Edit · README.md").cls).toBe("edit");
    expect(glyphOf("skill · superpowers:writing-plans")).toEqual({ g: "◆", cls: "skill" });
    expect(glyphOf("jev · judge")).toEqual({ g: "◇", cls: "jev" });
    for (const t of ["Bash · List files", "Read · a.ts", "Grep TODO", "agent · review", "playwright · browser click", "question for you", "load tools"])
      expect(glyphOf(t), t).toEqual({ g: "›", cls: "tool" });
  });
  it("Claude's own lines, empty and unknown text are ·", () => {
    for (const t of ["Plan ready · 3 tasks", "Shall I merge now?", "", "   ", "## heading"]) expect(glyphOf(t), t).toEqual({ g: "·", cls: "say" });
  });
});
