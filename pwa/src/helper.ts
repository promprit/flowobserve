import { canHelper } from "./edition";
import { store } from "./state";
import { nav, safeOpenUrl } from "./util";

/** Builders and checker for every flowobserve:// link. Rules mirror helper/fo_open.py. */
export type Step = "handoff" | "clear" | "resume";

export const REL_RE = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._ -]+(?:\/[A-Za-z0-9._ -]+)*$/;
const UUID = "[0-9a-fA-F-]{36}";
const UUID_RE = new RegExp(`^${UUID}$`);
const ITERM_RE = new RegExp(`^w\\d+t\\d+p\\d+:${UUID}$`);
const MAX_RESUME = 12;
const STEPS = new Set<string>(["handoff", "clear", "resume"]);
const TOKEN_RE = /^[0-9a-f]{64}$/;

const enc = encodeURIComponent;
const sign = (u: string): string | null => (store.helperToken ? `${u}&t=${store.helperToken}` : null);

export const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/;
const LABEL_RE = /^[A-Za-z0-9 ._-]{1,64}$/;

/** One-line validation text for the New project name; null when it may be created. */
export const nameProblem = (name: string, exists = false): string | null =>
  !NAME_RE.test(name) ? "Letters, digits, . _ - only · 1–64"
  : exists ? "Already a folder here — open it below" : null;

const withRoot = (root: string | null): string => (root ? `&root=${enc(root)}` : "");

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const withColor = (c: string | null): string => (c && HEX_RE.test(c) ? `&c=${c.slice(1).toLowerCase()}` : "");

export const helperUrl = {
  open(rel: string, resume: string[] = [], wt = false, root: string | null = null, color: string | null = null): string | null {
    if (!REL_RE.test(rel) || resume.length > MAX_RESUME || !resume.every((i) => UUID_RE.test(i)) || (wt && resume.length)) return null;
    return sign(`flowobserve://open?path=${enc(rel)}${resume.length ? `&resume=${enc(resume.join(","))}` : ""}${wt ? "&wt=1" : ""}${withRoot(root)}${withColor(color)}`);
  },
  run(rel: string, root: string | null = null, color: string | null = null): string | null {
    return REL_RE.test(rel) ? sign(`flowobserve://run?path=${enc(rel)}${withRoot(root)}${withColor(color)}`) : null;
  },
  diff(rel: string, root: string | null = null, color: string | null = null): string | null {
    return REL_RE.test(rel) ? sign(`flowobserve://diff?path=${enc(rel)}${withRoot(root)}${withColor(color)}`) : null;
  },
  newProject(root: string, name: string): string | null {
    return LABEL_RE.test(root) && NAME_RE.test(name)
      ? sign(`flowobserve://new?root=${enc(root)}&name=${enc(name)}`) : null;
  },
  step(iterm: string, step: Step): string | null {
    return ITERM_RE.test(iterm) && STEPS.has(step) ? sign(`flowobserve://step?iterm=${enc(iterm)}&do=${step}`) : null;
  },
};

const ITERM_Q = `w\\d+t\\d+p\\d+%3A${UUID}`;
const SHAPES = [
  new RegExp(`^flowobserve://open\\?path=[A-Za-z0-9._%-]+(&resume=[0-9A-Fa-f-]+(%2C[0-9A-Fa-f-]+)*|&wt=1)?(&root=[A-Za-z0-9._%-]+)?(&c=[0-9a-f]{6})?(&t=[0-9a-f]{64})?$`),
  new RegExp(`^flowobserve://run\\?path=[A-Za-z0-9._%-]+(&root=[A-Za-z0-9._%-]+)?(&c=[0-9a-f]{6})?(&t=[0-9a-f]{64})?$`),
  new RegExp(`^flowobserve://diff\\?path=[A-Za-z0-9._%-]+(&root=[A-Za-z0-9._%-]+)?(&c=[0-9a-f]{6})?(&t=[0-9a-f]{64})?$`),
  new RegExp(`^flowobserve://new\\?root=[A-Za-z0-9._%-]+&name=[A-Za-z0-9._%-]+(&t=[0-9a-f]{64})?$`),
  new RegExp(`^flowobserve://step\\?iterm=${ITERM_Q}&do=(handoff|clear|resume)(&t=[0-9a-f]{64})?$`),
  new RegExp(`^flowobserve://jump\\?iterm=${ITERM_Q}(&t=[0-9a-f]{64})?$`),
];

/** The URL when it is a well-formed open/run/diff/step/jump link (token optional), else null. */
export function safeHelperUrl(u: string | null | undefined): string | null {
  if (typeof u !== "string" || !SHAPES.some((r) => r.test(u))) return null;
  const q = u.slice(u.indexOf("?") + 1);
  const path = /(?:^|&)path=([^&]*)/.exec(q);
  if (path) { try { if (!REL_RE.test(decodeURIComponent(path[1]))) return null; } catch { return null; } }
  return u;
}

/** Decoded "w0t1p2:UUID" of a jump url, or null. */
export function itermOf(jumpUrl: string | null | undefined): string | null {
  const m = typeof jumpUrl === "string" ? /^flowobserve:\/\/jump\?iterm=([^&]+)/.exec(jumpUrl) : null;
  if (!m || !safeHelperUrl(jumpUrl)) return null;
  const id = decodeURIComponent(m[1]);
  return ITERM_RE.test(id) ? id : null;
}

/** True when an iterm session can be driven through the helper; otherwise it behaves like a vscode one (v1). */
export const helperReady = (s: { host?: string }): boolean => s.host === "iterm" && !!store.helperToken && canHelper();

/** Folder rel of the live session, from the projects message. */
export function relOf(sessionId: string): string | null {
  for (const p of store.projects) for (const f of p.folders) if (f.live === sessionId) return f.rel;
  return null;
}

/** Navigate to a safe vscode or helper link. A helper link only goes out carrying the store token. */
export function go(u: string | null): boolean {
  const h = safeHelperUrl(u);
  if (h) {
    const tok = store.helperToken;
    const given = /&t=([0-9a-f]{64})$/.exec(h)?.[1];
    if (!tok || !TOKEN_RE.test(tok) || (given !== undefined && given !== tok)) return false;
    nav.go(given ? h : `${h}&t=${tok}`);
    return true;
  }
  const v = safeOpenUrl(u);
  if (!v) return false;
  nav.go(v);
  return true;
}
