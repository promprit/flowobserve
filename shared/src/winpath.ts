/** Windows path → forward-slash form with an upper-case drive; macOS paths come back unchanged (windows spec §3.2). */
const DRIVE = /^[A-Za-z]:/;

export function toPosix(p: string): string {
  if (!p.includes("\\") && !DRIVE.test(p)) return p;
  let s = p.replace(/\\/g, "/");
  if (DRIVE.test(s)) s = s[0].toUpperCase() + s.slice(1);
  if (/^[A-Z]:\/*$/.test(s)) return s.slice(0, 2) + "/";
  return s.replace(/\/+$/, "");
}
