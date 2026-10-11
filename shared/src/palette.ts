/** The 10 colours a user may pick for a project (spec 2026-10-09-project-colour §5.1). */
export const PALETTE: readonly string[] = [
  "#e06c75", "#e5a35b", "#e5c07b", "#98c379", "#56b6c2",
  "#61afef", "#7f8cf0", "#c678dd", "#e57ab5", "#a3a8b4",
];

export const isPaletteColor = (c: unknown): c is string => typeof c === "string" && PALETTE.includes(c);

/** Stable colour from a name: FNV-1a 32-bit over UTF-8, hsl(h, 55%, 62%) as lower-case hex. Shared with the Python helper. */
export function nameColor(name: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(name)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  const hue = h % 360;
  const s = 0.55;
  const l = 0.62;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
