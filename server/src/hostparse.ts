import type { Host } from "@fo/shared";

/** Pure macOS host parsers (spec §3.2). Every function is total: bad input gives null/0/"normal", never a throw. */
export type Pressure = Host["mem"]["pressure"];
export interface CpuTimes { user: number; nice: number; sys: number; idle: number; irq: number }
export interface DiskSpec { path: string; label: string }
export interface StatFs { blocks: number; bsize: number; bavail: number }

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** `ioreg -r -d 1 -c IOAccelerator`: highest "Device Utilization %" across accelerators, as 0-1; null when absent. */
export function parseIoreg(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/"Device Utilization %"\s*=\s*(\d+)/g)) best = Math.max(best ?? 0, Number(m[1]));
  return best === null ? null : clamp01(best / 100);
}

/** `vm_stat`: Memory Used as Activity Monitor and iStat Menus show it, app (anonymous − purgeable) + wired + compressor,
 *  × page size / total bytes. "Pages active" is not used: it counts file cache and misses inactive app memory.
 *  Null when the header, anonymous, wired or compressor is missing; missing purgeable counts as 0. */
export function parseVmStat(text: string, totalBytes: number): number | null {
  const ps = /page size of (\d+) bytes/.exec(text);
  const pages = (label: string): number | null => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, "m").exec(text);
    return m ? Number(m[1]) : null;
  };
  const an = pages("Anonymous pages"), p = pages("Pages purgeable") ?? 0, w = pages("Pages wired down"), c = pages("Pages occupied by compressor");
  if (!ps || an === null || w === null || c === null || !(totalBytes > 0)) return null;
  return clamp01(((Math.max(0, an - p) + w + c) * Number(ps[1])) / totalBytes);
}

/** Busy share between two `os.cpus()` samples, all cores together. */
export function cpuDelta(prev: CpuTimes[], next: CpuTimes[]): number {
  let busy = 0, total = 0;
  next.forEach((n, i) => {
    const p = prev[i] ?? { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const b = n.user - p.user + (n.nice - p.nice) + (n.sys - p.sys) + (n.irq - p.irq);
    busy += b; total += b + (n.idle - p.idle);
  });
  return total > 0 ? clamp01(busy / total) : 0;
}

/** `sysctl -n kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical; anything else normal. */
export function pressure(text: string): Pressure {
  const n = parseInt(text.trim(), 10);
  return n === 2 ? "warn" : n === 4 ? "critical" : "normal";
}

/** `fs.statfs` result → used share and free bytes; null (offline) on error or an empty volume. */
export function diskOf(st: StatFs | null): { used: number | null; freeBytes: number | null } {
  if (!st || !(st.blocks > 0)) return { used: null, freeBytes: null };
  return { used: clamp01(1 - st.bavail / st.blocks), freeBytes: st.bavail * st.bsize };
}

export const DEFAULT_DISKS = "/:System";

/** Windows has no pressure level: derive it from the used share (windows spec §3.3). */
export function pressureFromUsed(used: number): Pressure {
  return used >= 0.95 ? "critical" : used >= 0.85 ? "warn" : "normal";
}

export const DEFAULT_DISKS_WIN = "C:\\:System";
const ABS_DISK = /^(\/|[A-Za-z]:[\\/])/;

/** FO_DISKS: comma-separated absolute `path:label` pairs, max 4; invalid pairs are dropped. */
export function parseDisks(spec: string | undefined, platform: NodeJS.Platform = process.platform): DiskSpec[] {
  const out: DiskSpec[] = [];
  for (const p of (spec || (platform === "win32" ? DEFAULT_DISKS_WIN : DEFAULT_DISKS)).split(",")) {
    const i = p.lastIndexOf(":");
    const d = { path: p.slice(0, i), label: p.slice(i + 1) };
    if (i > 0 && ABS_DISK.test(d.path) && d.label) out.push(d);
  }
  return out.slice(0, 4);
}

/** What the row can show: whole percents, pressure, online/offline. A change here means broadcast. */
export function hostKey(h: Host): string {
  const p = (x: number | null): string => (x === null ? "-" : String(Math.round(x * 100)));
  return [p(h.cpu), p(h.gpu), p(h.mem.used), h.mem.pressure, ...h.disks.map((d) => p(d.used))].join("|");
}
