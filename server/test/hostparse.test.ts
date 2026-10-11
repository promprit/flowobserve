import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Host } from "@fo/shared";
import { DEFAULT_DISKS, cpuDelta, diskOf, hostKey, parseDisks, parseIoreg, parseVmStat, pressure, pressureFromUsed, type CpuTimes } from "../src/hostparse";

const FX = path.resolve(__dirname, "../../fixtures/host");
const fx = (f: string) => fs.readFileSync(path.join(FX, f), "utf8");
const t = (user: number, idle: number, sys = 0): CpuTimes => ({ user, nice: 0, sys, idle, irq: 0 });

describe("parseIoreg", () => {
  it("reads Device Utilization % as 0-1, highest accelerator wins", () => {
    expect(parseIoreg('"PerformanceStatistics" = {"Device Utilization %"=37,"Renderer Utilization %"=30}')).toBe(0.37);
    expect(parseIoreg('"Device Utilization %"=12\n"Device Utilization %"=64')).toBe(0.64);
  });
  it("returns null when ioreg says nothing", () => {
    expect(parseIoreg("")).toBeNull();
    expect(parseIoreg(fx("ioreg-empty.txt"))).toBeNull();
  });
  it("reads the recorded fixture into range", () => {
    const g = parseIoreg(fx("ioreg.txt"));
    expect(g).not.toBeNull();
    expect(g!).toBeGreaterThanOrEqual(0); expect(g!).toBeLessThanOrEqual(1);
  });
});

describe("parseVmStat", () => {
  const vm = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                               1000.",
    "Pages active:                             9000.",
    "Pages wired down:                         1000.",
    "Pages purgeable:                           500.",
    "Pages occupied by compressor:             1000.",
    "Anonymous pages:                          2500.",
  ].join("\n");
  it("Memory Used as Activity Monitor / iStat Menus: (anonymous − purgeable + wired + compressor) × page size / total", () => {
    // 2500 − 500 + 1000 + 1000 = 4000 pages; active (includes file cache) is not used.
    expect(parseVmStat(vm, (4000 * 16384) / 0.5)).toBeCloseTo(0.5, 6);
  });
  it("null without the page-size header, a counter, or a total", () => {
    expect(parseVmStat(vm.replace(/\(page size.*\)/, ""), 1e9)).toBeNull();
    expect(parseVmStat(vm.replace(/Pages wired down.*\n/, ""), 1e9)).toBeNull();
    expect(parseVmStat(vm.replace(/Anonymous pages.*/, ""), 1e9)).toBeNull();
    expect(parseVmStat(vm, 0)).toBeNull();
  });
  it("missing purgeable counts as 0", () => {
    expect(parseVmStat(vm.replace(/Pages purgeable.*\n/, ""), (4500 * 16384) / 0.5)).toBeCloseTo(0.5, 6);
  });
  it("reads the recorded fixture into range", () => {
    const u = parseVmStat(fx("vm_stat.txt"), 16 * 2 ** 30);
    expect(u).not.toBeNull(); expect(u!).toBeGreaterThan(0); expect(u!).toBeLessThanOrEqual(1);
  });
});

describe("cpuDelta", () => {
  it("busy share of the time between two samples, all cores", () => {
    expect(cpuDelta([t(100, 900), t(0, 1000)], [t(150, 950), t(50, 1050)])).toBe(0.5);
  });
  it("0 when no time passed; missing previous cores count from zero", () => {
    expect(cpuDelta([t(1, 1)], [t(1, 1)])).toBe(0);
    expect(cpuDelta([], [t(25, 75)])).toBe(0.25);
  });
  it("recorded samples land in range", () => {
    const c = cpuDelta(JSON.parse(fx("cpus-a.json")), JSON.parse(fx("cpus-b.json")));
    expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1);
  });
});

describe("pressure", () => {
  it("1/2/4 → normal/warn/critical; anything else → normal", () => {
    expect(pressure("1\n")).toBe("normal");
    expect(pressure("2")).toBe("warn");
    expect(pressure("4")).toBe("critical");
    expect(pressure("7")).toBe("normal");
    expect(pressure("")).toBe("normal");
  });
});

describe("diskOf", () => {
  it("used share and free bytes from statfs", () => {
    expect(diskOf({ blocks: 1000, bsize: 4096, bavail: 250 })).toEqual({ used: 0.75, freeBytes: 250 * 4096 });
  });
  it("null (offline) on error or an empty volume", () => {
    expect(diskOf(null)).toEqual({ used: null, freeBytes: null });
    expect(diskOf({ blocks: 0, bsize: 4096, bavail: 0 })).toEqual({ used: null, freeBytes: null });
  });
});

describe("parseDisks", () => {
  it("defaults to the system disk only", () => {
    expect(parseDisks(undefined, "darwin")).toEqual([{ path: "/", label: "System" }]);
    expect(parseDisks("", "darwin")).toEqual(parseDisks(DEFAULT_DISKS, "darwin"));
  });
  it("keeps valid absolute path:label pairs, max 4", () => {
    expect(parseDisks("/a:A,bad,/b:,/c:C,/d:D,/e:E,/f:F")).toEqual([{ path: "/a", label: "A" }, { path: "/c", label: "C" }, { path: "/d", label: "D" }, { path: "/e", label: "E" }]);
  });
});

describe("Windows host (windows spec §3.3)", () => {
  it("pressureFromUsed thresholds", () => {
    expect(pressureFromUsed(0.84)).toBe("normal");
    expect(pressureFromUsed(0.85)).toBe("warn");
    expect(pressureFromUsed(0.949)).toBe("warn");
    expect(pressureFromUsed(0.95)).toBe("critical");
  });
  it("parseDisks accepts drive paths and defaults to C:\\ on win32", () => {
    expect(parseDisks(undefined, "win32")).toEqual([{ path: "C:\\", label: "System" }]);
    expect(parseDisks("C:\\:System,D:/:Data,/:Root,bad", "win32")).toEqual([
      { path: "C:\\", label: "System" }, { path: "D:/", label: "Data" }, { path: "/", label: "Root" },
    ]);
  });
});

describe("hostKey", () => {
  const h: Host = { at: 1, cpu: 0.501, gpu: null, mem: { used: 0.5, pressure: "normal" }, disks: [{ label: "S", path: "/", used: 0.4, freeBytes: 1 }] };
  it("ignores sub-percent noise and time; changes on whole %, pressure, and online/offline", () => {
    expect(hostKey({ ...h, at: 9, cpu: 0.504 })).toBe(hostKey(h));
    expect(hostKey({ ...h, cpu: 0.51 })).not.toBe(hostKey(h));
    expect(hostKey({ ...h, mem: { used: 0.5, pressure: "warn" } })).not.toBe(hostKey(h));
    expect(hostKey({ ...h, disks: [{ ...h.disks[0], used: null, freeBytes: null }] })).not.toBe(hostKey(h));
    expect(hostKey({ ...h, gpu: 0 })).not.toBe(hostKey(h));
  });
});
