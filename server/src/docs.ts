import fs from "node:fs";
import path from "node:path";

/** Read-only spec/plan route (spec §5.7). The path comes only from session state, never from the request. */
export type DocResult = { status: 200; body: { path: string; markdown: string; mtime: number } } | { status: 404 | 413 };

export const DOC_MAX_BYTES = 512 * 1024;
const DIRS = [path.join("docs", "superpowers") + path.sep, ".orchestrate" + path.sep];

/** Session folder plus every worktree of its git repo: a session may write its spec into a sibling worktree. */
function roots(folder: string): string[] {
  const project = fs.realpathSync(folder);
  const out = [project];
  try {
    const dotgit = path.join(project, ".git");
    let common = dotgit;
    if (fs.statSync(dotgit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, "utf8"));
      if (!m) return out;
      common = path.resolve(path.resolve(project, m[1].trim()), "..", "..");
      out.push(path.dirname(fs.realpathSync(common)));
    }
    const wts = path.join(common, "worktrees");
    for (const name of fs.readdirSync(wts)) {
      try {
        const gitdir = fs.readFileSync(path.join(wts, name, "gitdir"), "utf8").trim();
        out.push(fs.realpathSync(path.dirname(gitdir)));
      } catch { /* stale worktree entry */ }
    }
  } catch { /* not a git repo, or no worktrees */ }
  return [...new Set(out)];
}

export function readDoc(s: { cwd: string; folderAbs?: string; specPath?: string | null; planPath?: string | null }, kind: string): DocResult {
  const folder = s.folderAbs ?? s.cwd;
  let want: string | null | undefined;
  if (kind === "spec") want = s.specPath;
  else if (kind === "plan") want = s.planPath || path.join(folder, ".orchestrate", "PLAN.md");
  if (!want) return { status: 404 };
  let fd: number | null = null;
  try {
    const all = roots(folder);
    const file = fs.realpathSync(path.resolve(all[0], want));
    const project = all.find((r) => file.startsWith(r + path.sep));
    if (!project || path.extname(file) !== ".md") return { status: 404 };
    const rel = path.relative(project, file);
    if (!DIRS.some((d) => rel.startsWith(d))) return { status: 404 };
    if (!fs.statSync(file).isFile()) return { status: 404 };
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { status: 404 };
    if (st.size > DOC_MAX_BYTES) return { status: 413 };
    const buf = Buffer.alloc(DOC_MAX_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const r = fs.readSync(fd, buf, n, buf.length - n, n);
      if (r === 0) break;
      n += r;
    }
    if (n > DOC_MAX_BYTES) return { status: 413 };
    const markdown = buf.toString("utf8", 0, n);
    return { status: 200, body: { path: rel.split(path.sep).join("/"), markdown, mtime: st.mtimeMs } };
  } catch {
    return { status: 404 };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
