import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@fo/shared";
import { HostPoller, type HostDeps } from "../src/hostpoll";

const VM = "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nAnonymous pages: 120.\nPages purgeable: 20.\nPages wired down: 100.\nPages occupied by compressor: 50.\n";
function deps(over: Partial<HostDeps> = {}): HostDeps & { calls: string[]; busy: { v: number } } {
  const calls: string[] = [], busy = { v: 10 };
  return {
    calls, busy,
    run: async (cmd) => { calls.push(cmd); return cmd === "ioreg" ? '"Device Utilization %"=40' : cmd === "vm_stat" ? VM : "1"; },
    cpus: () => [{ user: busy.v, nice: 0, sys: 0, idle: 100, irq: 0 }],
    totalmem: () => 1000 * 4096,
    freemem: () => 400 * 4096,
    statfs: async (p) => { if (p === "/gone") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return { blocks: 100, bsize: 1e9, bavail: 60 }; },
    now: () => 1,
    ...over,
  };
}
const DISKS = [{ path: "/", label: "System" }, { path: "/gone", label: "External" }];
const ioregCalls = (d: { calls: string[] }) => d.calls.filter((c) => c === "ioreg").length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("HostPoller", () => {
  it("samples nothing without clients, once immediately on the first client, then every 5 s", async () => {
    const d = deps();
    const p = new HostPoller(d, DISKS, () => {});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ioregCalls(d)).toBe(0);
    p.clients(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(ioregCalls(d)).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ioregCalls(d)).toBe(3);
    p.clients(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ioregCalls(d)).toBe(3);
  });

  it("client churn never starts a second timer", async () => {
    const d = deps();
    const p = new HostPoller(d, DISKS, () => {});
    p.clients(1); p.clients(2); p.clients(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ioregCalls(d)).toBe(4); // 1 immediate + 3 ticks
    p.clients(0); p.clients(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(ioregCalls(d)).toBe(5);
  });

  it("builds a full sample: GPU, memory, pressure, online and offline disks", async () => {
    const got: Host[] = [];
    const p = new HostPoller(deps(), DISKS, (h) => got.push(h));
    await p.sample();
    expect(got[0]).toEqual({
      at: 1, cpu: 0, gpu: 0.4, mem: { used: 0.25, pressure: "normal" },
      disks: [{ label: "System", path: "/", used: 0.4, freeBytes: 60e9 }, { label: "External", path: "/gone", used: null, freeBytes: null }],
    });
    expect(p.latest()).toEqual(got[0]);
  });

  it("broadcasts only when the visible key changes", async () => {
    const d = deps(), got: Host[] = [];
    const p = new HostPoller(d, DISKS, (h) => got.push(h));
    await p.sample(); await p.sample();
    expect(got).toHaveLength(1);
    d.busy.v += 100; // next delta: 100 busy, 0 idle → cpu 1
    await p.sample();
    expect(got).toHaveLength(2);
    expect(got[1].cpu).toBe(1);
  });

  it("a failing command keeps that field's last good value; no throw", async () => {
    const d = deps();
    const p = new HostPoller(d, DISKS, () => {});
    await p.sample();
    d.run = async (cmd) => { if (cmd === "ioreg" || cmd === "vm_stat") throw new Error("timeout"); return "4"; };
    await expect(p.sample()).resolves.toBeUndefined();
    expect(p.latest()!.gpu).toBe(0.4);
    expect(p.latest()!.mem).toEqual({ used: 0.25, pressure: "critical" });
  });

  it("every command missing (not macOS): still samples with GPU null, never throws", async () => {
    const enoent = Object.assign(new Error("spawn ioreg ENOENT"), { code: "ENOENT" });
    const got: Host[] = [];
    const p = new HostPoller(deps({ run: async () => { throw enoent; } }), DISKS, (h) => got.push(h));
    await p.sample();
    expect(got[0].gpu).toBeNull();
    expect(got[0].mem).toEqual({ used: 0, pressure: "normal" });
  });

  it("hung statfs does not block later samples", async () => {
    let hang = true;
    const d = deps({ statfs: (p) => (hang ? new Promise(() => {}) : Promise.resolve({ blocks: 100, bsize: 1e9, bavail: 60 })) });
    const got: Host[] = [];
    const p = new HostPoller(d, DISKS, (h) => got.push(h));
    const s1 = p.sample();
    await vi.advanceTimersByTimeAsync(2_001);
    await s1;
    expect(got[0].disks.every((x) => x.used === null)).toBe(true);
    hang = false;
    const before = ioregCalls(d);
    await p.sample();
    expect(ioregCalls(d)).toBe(before + 1);
    expect(p.latest()!.disks[0].used).toBe(0.4);
  });

  it("re-seeds CPU baseline when sampling restarts after 0 clients", async () => {
    let t = { user: 10, idle: 100 };
    const d = deps({ cpus: () => [{ user: t.user, nice: 0, sys: 0, idle: t.idle, irq: 0 }] });
    const p = new HostPoller(d, DISKS, () => {});
    t = { user: 1010, idle: 1100 };
    p.clients(1);
    t = { user: 1020, idle: 1190 };
    await vi.advanceTimersByTimeAsync(0);
    expect(p.latest()!.cpu).toBeCloseTo(0.1, 5);
  });

  it("an onHost that throws is contained", async () => {
    const p = new HostPoller(deps(), DISKS, () => { throw new Error("boom"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(p.sample()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("HostPoller on win32", () => {
  it("runs no subprocess, gpu null, memory from freemem, pressure from the used share", async () => {
    const d = deps({ freemem: () => 100 * 4096 }); // totalmem 1000 pages → 90 % used
    let got: Host | null = null;
    const p = new HostPoller(d, [{ path: "C:\\", label: "System" }], (h) => { got = h; }, 5_000, "win32");
    const s = p.sample();
    await vi.advanceTimersByTimeAsync(0);
    await s;
    expect(d.calls).toEqual([]);
    expect(got!.gpu).toBeNull();
    expect(got!.mem.used).toBeCloseTo(0.9);
    expect(got!.mem.pressure).toBe("warn");
    expect(got!.disks).toHaveLength(1);
    expect(got!.disks[0].used).toBeCloseTo(0.4);
    expect(got!.disks[0].freeBytes).toBe(60e9);
  });
});
