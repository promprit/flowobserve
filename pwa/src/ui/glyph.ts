/** One glyph per terminal line from the hook's humanized prefix (spec §10). Unknown text is Claude's own line: ·. */
export type GlyphCls = "tool" | "edit" | "skill" | "jev" | "say";
const EDIT = /^(Edit|Write|MultiEdit|NotebookEdit) · /;
const TOOL = /^(Bash · |Read · |Grep\b|Glob\b|WebFetch\b|WebSearch\b|agent · |agent report$|question for you$|load tools$|[\w.-]+ · )/;

export function glyphOf(text: string): { g: string; cls: GlyphCls } {
  const t = (text ?? "").trim();
  if (EDIT.test(t)) return { g: "✎", cls: "edit" };
  if (t.startsWith("skill · ")) return { g: "◆", cls: "skill" };
  if (t.startsWith("jev · ")) return { g: "◇", cls: "jev" };
  if (TOOL.test(t)) return { g: "›", cls: "tool" };
  return { g: "·", cls: "say" };
}
