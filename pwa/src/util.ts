export const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null => document.querySelector<T>(s);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 4);
export const pad = (n: number) => String(n).padStart(2, "0");
export const dur = (ms: number) => { const s = Math.max(0, (ms / 1000) | 0), h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0; return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`; };
export const hms = (ms: number) => { const s = Math.max(0, (ms / 1000) | 0); return `${pad((s / 3600) | 0)}:${pad(((s % 3600) / 60) | 0)}:${pad(s % 60)}`; };
/** Running time: 42s · 4m 12s · 1h 05m */
export const runFmt = (ms: number) => { const s = Math.max(0, (ms / 1000) | 0); return s < 60 ? `${s}s` : s < 3600 ? `${(s / 60) | 0}m ${pad(s % 60)}s` : `${(s / 3600) | 0}h ${pad(((s % 3600) / 60) | 0)}m`; };
/** Coarse time: <1m · 6m · 1h 05m */
export const coarseFmt = (ms: number) => { const m = Math.max(0, (ms / 60000) | 0); return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${(m / 60) | 0}h ${pad(m % 60)}m`; };
export const clock = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: unknown) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ENT[c]);
export const fmtMs = (ms: number | null | undefined) => (ms == null || isNaN(ms) ? "—" : ms >= 10000 ? (ms / 1000).toFixed(0) + "s" : ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms");
export const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
export function quant(arr: number[], q: number): number | null {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

/** Only vscode://file/ links (spec §2 openUrl) may ever be opened. */
export const safeOpenUrl = (u: string | null | undefined): string | null => (typeof u === "string" && /^vscode:\/\/file\//.test(u) ? u : null);
/** Only the Claude Code extension's session-open link (spec §10), session id and an optional prompt, nothing else. */
export const safeSessionUrl = (u: string | null | undefined): string | null =>
  typeof u === "string" && /^vscode:\/\/anthropic\.claude-code\/open\?session=[A-Za-z0-9-]{8,64}(&prompt=[^&#]*)?$/.test(u) ? u : null;
/** Navigation seam so tests can spy on it. */
export const nav = { go(u: string): void {
  const stub = (globalThis as { __foNavStub?: (u: string) => void }).__foNavStub;
  if (typeof stub === "function") { stub(u); return; }
  location.href = u;
} };
