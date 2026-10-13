import { beforeEach, describe, expect, it } from "vitest";
import type { Host } from "@fo/shared";
import { store } from "../src/state";
import { bytes, hostCells, hostLevel, noteCpu, noteGpu, renderHost } from "../src/ui/host";
import { loadDom, reset } from "./helpers";

const GB = 1e9;
const disk = (used: number | null, freeBytes: number | null) => ({ label: "External", path: "/Volumes/External", used, freeBytes });
const H: Host = { at: 1, cpu: 0.2, gpu: 0.1, mem: { used: 0.5, pressure: "normal" }, disks: [{ label: "System", path: "/", used: 0.4, freeBytes: 412 * GB }, disk(0.6, 1.2e12)] };

beforeEach(() => { reset(); loadDom(); });

describe("hostLevel", () => {
  it("CPU warns at 85% and is critical at 95% (on the 3-sample mean)", () => {
    expect(hostLevel.cpu(0.849)).toBe(""); expect(hostLevel.cpu(0.85)).toBe("warn");
    expect(hostLevel.cpu(0.949)).toBe("warn"); expect(hostLevel.cpu(0.95)).toBe("crit");
  });
  it("GPU warns at 90%, never critical; null is healthy", () => {
    expect(hostLevel.gpu(0.899)).toBe(""); expect(hostLevel.gpu(0.9)).toBe("warn"); expect(hostLevel.gpu(1)).toBe("warn");
    expect(hostLevel.gpu(null)).toBe("");
  });
  it("memory follows pressure", () => {
    expect(hostLevel.mem("normal")).toBe(""); expect(hostLevel.mem("warn")).toBe("warn"); expect(hostLevel.mem("critical")).toBe("crit");
  });
  it("disk takes the worse of % used and GB free", () => {
    expect(hostLevel.disk(disk(0.849, 51 * GB))).toBe("");
    expect(hostLevel.disk(disk(0.85, 500 * GB))).toBe("warn");
    expect(hostLevel.disk(disk(0.1, 49 * GB))).toBe("warn");
    expect(hostLevel.disk(disk(0.95, 500 * GB))).toBe("crit");
    expect(hostLevel.disk(disk(0.5, 14 * GB))).toBe("crit");
    expect(hostLevel.disk(disk(0.9, 14 * GB))).toBe("crit");
    expect(hostLevel.disk(disk(null, null))).toBe("");
  });
});

describe("noteCpu", () => {
  it("averages the last 3 good samples; fewer than 3 counts as healthy (0); a repeated sample counts once", () => {
    const w = { at: 0, v: [] as number[] };
    expect(noteCpu(w, { ...H, at: 1, cpu: 0.99 })).toBe(0);
    expect(noteCpu(w, { ...H, at: 1, cpu: 0.99 })).toBe(0);
    expect(noteCpu(w, { ...H, at: 2, cpu: 0.99 })).toBe(0);
    expect(noteCpu(w, { ...H, at: 3, cpu: 0.6 })).toBeCloseTo(0.86, 2);
    noteCpu(w, { ...H, at: 4, cpu: 0.6 });
    expect(noteCpu(w, { ...H, at: 5, cpu: 0.6 })).toBeCloseTo(0.6);
  });
});

describe("noteGpu", () => {
  it("shows the mean of the last 3 GPU samples (fewer at start); null samples are skipped; a repeated sample counts once", () => {
    const w = { at: 0, v: [] as number[] };
    expect(noteGpu(w, { ...H, at: 1, gpu: null })).toBeNull();
    expect(noteGpu(w, { ...H, at: 2, gpu: 0.2 })).toBeCloseTo(0.2);
    expect(noteGpu(w, { ...H, at: 2, gpu: 0.9 })).toBeCloseTo(0.2);
    expect(noteGpu(w, { ...H, at: 3, gpu: 0.5 })).toBeCloseTo(0.35);
    noteGpu(w, { ...H, at: 4, gpu: 0.2 });
    expect(noteGpu(w, { ...H, at: 5, gpu: 0.8 })).toBeCloseTo(0.5);
  });
});

describe("hostCells", () => {
  it("formats percent, free space, GPU null and offline disks", () => {
    expect(bytes(412 * GB)).toBe("412 GB"); expect(bytes(1.2e12)).toBe("1.2 TB");
    const c = hostCells({ ...H, gpu: null, disks: [H.disks[0], disk(null, null)] }, 0.2);
    expect(c.map((x) => [x.k, x.v])).toEqual([["CPU", "20%"], ["GPU", "—"], ["MEM", "50%"], ["SYSTEM", "412 GB"], ["EXTERNAL", "offline"]]);
    expect(c[1].fill).toBeNull(); expect(c[4].fill).toBeNull(); expect(c[4].lvl).toBe("");
  });
  it("CPU level comes from the mean, not the current value", () => {
    expect(hostCells({ ...H, cpu: 0.99 }, 0.5)[0].lvl).toBe("");
    expect(hostCells({ ...H, cpu: 0.5 }, 0.96)[0].lvl).toBe("crit");
  });
});

describe("renderHost", () => {
  it("hides the row and its grid track until host data exists", () => {
    renderHost();
    expect(document.querySelector<HTMLElement>("#host")!.hidden).toBe(true);
    expect(document.querySelector("#dock")!.classList.contains("has-host")).toBe(false);
  });
  it("renders Mac as one tile of 3 rings + one tile of disks as stacked hairlines, one ring tall", () => {
    store.host = H;
    renderHost();
    const el = document.querySelector("#host")!;
    expect(el.querySelectorAll(".tile")).toHaveLength(2);
    expect(el.querySelectorAll(".tile.arcs svg")).toHaveLength(3);
    expect(el.querySelectorAll(".tile.arcs svg text")).toHaveLength(0);
    expect(el.querySelectorAll(".tile.stack")).toHaveLength(0);
    const lines = [...el.querySelectorAll(".tile.store .disks .dl")];
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => [l.querySelector(".cap")!.textContent, l.querySelector(".v")!.textContent])).toEqual([["SYSTEM", "412 GB FREE"], ["EXTERNAL", "1.2 TB FREE"]]);
    expect(lines.every((l) => l.querySelector(".hl s"))).toBe(true);
    expect(el.querySelector(".tile.store > .cap")!.textContent).toBe("STORAGE");
  });
  it("four disks: four hairlines in one block, ring plus caption tall", () => {
    store.host = { ...H, disks: [1, 2, 3, 4].map((i) => ({ label: `d${i}`, path: `/d${i}`, used: 0.1, freeBytes: 5e11 })) };
    renderHost();
    expect(document.querySelectorAll("#host .disks .dl")).toHaveLength(4);
    expect(document.querySelector("#host .tile.store > .cap")).toBeNull(); // the four lines take the caption's line
  });
  it("an offline disk says so and draws no fill", () => {
    store.host = { ...H, disks: [disk(null, null)] };
    renderHost();
    const l = document.querySelector("#host .disks .dl")!;
    expect(l.querySelector(".v")!.textContent).toBe("OFFLINE");
    expect(l.querySelector(".hl s")).toBeNull();
  });
  it("the GPU ring shows the 3-sample mean and says it includes this dashboard", () => {
    for (const [at, gpu] of [[11, 0.1], [12, 0.2], [13, 0.6]] as const) { store.host = { ...H, at, gpu }; renderHost(); }
    const g = document.querySelectorAll<HTMLElement>("#host .tile.arcs .a")[1];
    expect(g.textContent).toContain("30%");
    expect(g.title).toMatch(/includes this dashboard/i);
  });
  it("a warn arc is hot and carries its word; a low disk says LOW", () => {
    store.host = { ...H, mem: { used: 0.9, pressure: "warn" }, disks: [{ label: "System", path: "/", used: 0.9, freeBytes: 30 * GB }, disk(0.6, 1.2e12)] };
    renderHost();
    const el = document.querySelector<HTMLElement>("#host")!;
    expect(el.hidden).toBe(false);
    expect(document.querySelector("#dock")!.classList.contains("has-host")).toBe(true);
    const arcs = [...el.querySelectorAll(".tile.arcs .a")];
    expect(arcs[2].className).toContain("hot");
    expect(arcs[2].textContent).toContain("PRESSURE");
    expect(arcs[0].className).not.toContain("hot");
    expect(el.querySelector(".disks .dl.hot .v")!.textContent).toBe("30 GB LOW");
  });
});

describe("renderHost with no disks", () => {
  it("shows a dash in the storage tile, not an empty tile", () => {
    store.host = { ...H, disks: [] };
    renderHost();
    expect(document.querySelector("#host .disks .v")!.textContent).toBe("—");
  });
});
