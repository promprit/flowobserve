import { esc } from "../util";

export type MdOutline = { level: 2 | 3; text: string; id: string };

const e = (s: string) => esc(s).replace(/'/g, "&#39;");

function marks(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]\n[]+)\]\(([^()\s[\]]{1,2048})\)/g, "$1 ($2)");
}

// Escape first, then apply marks; code spans are kept out of mark processing.
function inline(src: string): string {
  // "=" is entity-encoded so prose never contains a literal attribute-looking "onerror=".
  return e(src)
    .replace(/=/g, "&#61;")
    .split(/(`[^`\n]+`)/)
    .map((p, i) => (i % 2 ? "<code>" + p.slice(1, -1) + "</code>" : marks(p)))
    .join("");
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (l: string) => {
  const cs = cells(l);
  return l.includes("|") && cs.length > 0 && cs.every((c) => /^:?-{3,}:?$/.test(c));
};
const isRow = (l: string) => l.trim().startsWith("|");

// Trailing "  ##" closer: whitespace plus a run of "#", removed without a regex (linear time).
function stripCloser(s: string): string {
  let end = s.length;
  while (end > 0 && /\s/.test(s[end - 1])) end--;
  let k = end;
  while (k > 0 && s[k - 1] === "#") k--;
  if (k < end && (k === 0 || /\s/.test(s[k - 1]))) end = k;
  while (end > 0 && /\s/.test(s[end - 1])) end--;
  return s.slice(0, end);
}

export function renderMd(src: string): { html: string; outline: MdOutline[] } {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  const outline: MdOutline[] = [];
  const seen = new Map<string, number>();
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      out.push("<pre><code>" + e(code.join("\n")) + "</code></pre>");
      continue;
    }
    const h = /^(#{1,6})[ \t]+([\s\S]*)$/.exec(l);
    if (h) {
      const level = h[1].length, text = stripCloser(h[2]);
      let id = "";
      if (level === 2 || level === 3) {
        const base = slug(text) || "section";
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        id = n === 1 ? base : base + "-" + n;
        outline.push({ level, text, id });
      }
      out.push(`<h${level}${id ? ` id="${id}"` : ""}>${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(l).map((c) => `<th>${inline(c)}</th>`).join("");
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && isRow(lines[i])) rows.push("<tr>" + cells(lines[i++]).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
      continue;
    }
    const li = /^\s*(?:([-*])|\d+\.)\s+([\s\S]*)$/.exec(l);
    if (li) {
      const tag = li[1] ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*(?:([-*])|\d+\.)\s+([\s\S]*)$/.exec(lines[i]);
        if (!m || !!m[1] !== !!li[1]) break;
        items.push(`<li>${inline(m[2])}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^#{1,6}\s/.test(lines[i]) && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) && !isRow(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push("<p>" + inline(para.join("\n")) + "</p>");
  }
  return { html: out.join("\n"), outline };
}
