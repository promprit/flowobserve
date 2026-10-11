import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import type { Host } from "@fo/shared";
import { cpuDelta, diskOf, hostKey, parseIoreg, parseVmStat, pressure, pressureFromUsed, type CpuTimes, type DiskSpec, type StatFs } from "./hostparse";

export const HOST_MS = 5_000;
export const CMD_TIMEOUT_MS = 2_000;

export interface HostDeps {
  run(cmd: string, args: string[]): Promise<string>;
  cpus(): CpuTimes[];
  totalmem(): number;
  freemem(): number;
  statfs(path: string): Promise<StatFs>;
  now(): number;
}

export const realDeps: HostDeps = {
  run: (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: CMD_TIMEOUT_MS, maxBuffer: 4 << 20 }, (err, out) => (err ? reject(err) : resolve(String(out))))),
  cpus: () => os.cpus().map((c) => c.times),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  statfs: (p) => fs.promises.statfs(p),
  now: () => Date.now(),
};

/** Resolves null if p has not settled within ms (timer cleared and unref'd). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    t.unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

/**
 * Samples this machine (macOS, or Windows per windows spec §3.3) every HOST_MS while at least one client is connected (spec §3.2). Never throws.
 * GPU source rule (spec §3.2): `ioreg` is the only GPU source; `—` (null) is the v1 answer
 * because `powermetrics` needs root.
 */
export class HostPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private prevCpu: CpuTimes[];
  private last: Host | null = null;
  private lastKey = "";
  private busy = false;

  constructor(private deps: HostDeps, private disks: DiskSpec[], private onHost: (h: Host) => void, private everyMs = HOST_MS, private platform: "darwin" | "win32" = "darwin") {
    this.prevCpu = deps.cpus();
  }

  latest(): Host | null { return this.last; }

  clients(n: number): void {
    if (n > 0 && !this.timer) {
      this.prevCpu = this.deps.cpus(); // first sample covers only the new interval
      this.timer = setInterval(() => void this.sample(), this.everyMs);
      void this.sample();
    } else if (n <= 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sample(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const d = this.deps, prev = this.last;
      const text = (cmd: string, args: string[]) => d.run(cmd, args).catch(() => null);
      const win = this.platform === "win32";
      const [io, vm, pr, st] = await Promise.all([
        win ? null : text("ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"]),
        win ? null : text("vm_stat", []),
        win ? null : text("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
        Promise.all(this.disks.map((k) => withTimeout(Promise.resolve().then(() => d.statfs(k.path)), CMD_TIMEOUT_MS))),
      ]);
      const cpus = d.cpus(), cpu = cpuDelta(this.prevCpu, cpus);
      this.prevCpu = cpus;
      const total = d.totalmem();
      const winUsed = total > 0 ? Math.min(1, Math.max(0, 1 - d.freemem() / total)) : 0;
      const h: Host = {
        at: d.now(),
        cpu,
        gpu: win ? null : io === null ? prev?.gpu ?? null : parseIoreg(io),
        mem: win ? { used: winUsed, pressure: pressureFromUsed(winUsed) } : {
          used: (vm === null ? null : parseVmStat(vm, total)) ?? prev?.mem.used ?? 0,
          pressure: pr === null ? prev?.mem.pressure ?? "normal" : pressure(pr),
        },
        disks: this.disks.map((k, i) => ({ label: k.label, path: k.path, ...diskOf(st[i]) })),
      };
      this.last = h;
      const key = hostKey(h);
      if (key !== this.lastKey) { this.lastKey = key; this.onHost(h); }
    } catch (err) {
      console.error("fo-server: host sample failed:", err);
    } finally {
      this.busy = false;
    }
  }
}
