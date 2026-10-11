import { describe, expect, it } from "vitest";
import { renderMd } from "../src/ui/md";

describe("renderMd", () => {
  it("escapes raw html and scripts", () => {
    const { html } = renderMd('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))');
    expect(html).not.toMatch(/<script|<img|onerror=|href=/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("javascript:alert(1)");
  });
  it("renders headings, lists, tables, code and inline marks", () => {
    const { html, outline } = renderMd("## Goal\n\nText **b** _i_ `c`\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = '<b>';\n```\n\n### Task 1: X");
    expect(html).toContain('<h2 id="goal">Goal</h2>');
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<code>c</code>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("const x = &#39;&lt;b&gt;&#39;;");
    expect(outline).toEqual([{ level: 2, text: "Goal", id: "goal" }, { level: 3, text: "Task 1: X", id: "task-1-x" }]);
  });
  it("shows links as text with the url", () => {
    expect(renderMd("[docs](https://a.b/c)").html).toContain("docs (https://a.b/c)");
  });
  it("dedupes heading ids", () => {
    expect(renderMd("## A\n\n## A").outline.map((o) => o.id)).toEqual(["a", "a-2"]);
  });
  it("handles a 500 KB document quickly", () => {
    const big = "## H\n\n" + "line of **text** and `code`\n".repeat(18_000);
    const t = performance.now(); renderMd(big); expect(performance.now() - t).toBeLessThan(300);
  });
  it("long space-and-hash heading renders fast", () => {
    const t = performance.now(); renderMd("# a" + " ".repeat(5000) + "#".repeat(5000) + "x"); expect(performance.now() - t).toBeLessThan(200);
  });
  it("long run of [ renders fast", () => {
    const t = performance.now(); renderMd("[".repeat(100000)); expect(performance.now() - t).toBeLessThan(200);
  });
  it("strips a heading closer but keeps a trailing hash in a word", () => {
    expect(renderMd("## Title ##").outline[0].text).toBe("Title");
    expect(renderMd("# a#").html).toContain("<h1>a#</h1>");
  });
  describe("linear time on hostile lines", () => {
    const fast = (src: string) => { const t = performance.now(); renderMd(src); return performance.now() - t; };
    it("table separator with long spaces renders fast", () => {
      expect(fast("|a\n" + " ".repeat(100000) + "x")).toBeLessThan(200);
      expect(fast("| --- " + " ".repeat(100000) + "x")).toBeLessThan(200);
      expect(fast("|a\n| --- " + " ".repeat(100000) + "x")).toBeLessThan(200);
    });
    const N = Number(process.env.FO_MD_N ?? 100000);
    it("heading with CR after long spaces renders fast", () => {
      for (const sep of ["\r", "\u2028", "\u2029"]) {
        expect(fast("# " + " ".repeat(N) + "x" + sep + "y")).toBeLessThan(200);
      }
    });
    it("list item with CR after long spaces renders fast", () => {
      for (const sep of ["\r", "\u2028", "\u2029"]) {
        expect(fast("- " + " ".repeat(N) + "x" + sep + "y")).toBeLessThan(200);
        expect(fast("1. " + " ".repeat(N) + "x" + sep + "y")).toBeLessThan(200);
      }
    });
    it("a header row without a pipe in the next line is not a table", () => {
      expect(renderMd("| x\n---").html).not.toContain("<table>");
    });
    it("unclosed link openers render fast", () => {
      expect(fast("[a](".repeat(25000))).toBeLessThan(200);
    });
    it("512 KB mixed line renders fast", () => {
      const unit = "#|-[( ";
      expect(fast(unit.repeat(Math.ceil(524288 / unit.length)))).toBeLessThan(200);
      expect(fast("|a\n" + unit.repeat(Math.ceil(524288 / unit.length)))).toBeLessThan(200);
    });
  });
});
