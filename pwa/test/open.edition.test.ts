import type { Project } from "@fo/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/state";
import { bindOpen, closeSheet, openSheet, vscodeFolderUrl } from "../src/ui/open";
import { closeDrawer } from "../src/ui/drawer";
import { nav } from "../src/util";
import { T0, loadDom, reset } from "./helpers";

const folder = (rel: string, patch: Partial<Project["folders"][number]> = {}) => ({ rel, worktree: null, live: null, restore: [], ...patch });
const proj = (key: string, folders: Project["folders"], patch: Partial<Project> = {}): Project =>
  ({ key, name: key, group: null, color: "#aabbcc", folders, ...patch });

let bound = false;
beforeEach(() => {
  reset(); loadDom(); closeDrawer();
  Object.assign(store, {
    edition: "vscode", rootMissing: false, helperToken: "a".repeat(64),
    createRoots: [{ label: "projects", path: "/Volumes/X/projects", exists: true }, { label: "Dev", path: "/Volumes/X/Dev", exists: true }],
    projects: [
      proj("app", [folder("app", { restore: [{ id: "22222222-2222-2222-2222-222222222222", title: null, endedAt: T0 }] }), folder("app-wt", { worktree: "wt" })]),
      proj("Dev:tool", [folder("tool", { root: "Dev" })], { name: "tool" }),
    ],
  });
  if (!bound) { bindOpen(); bound = true; }
  closeSheet();
  vi.restoreAllMocks();
});
afterEach(() => { store.edition = "both"; });

const sheet = () => document.querySelector<HTMLElement>("#sheet")!;
const row = (k: string) => sheet().querySelector<HTMLElement>(`.op-row[data-key="${k}"]`)!;

describe("VS Code edition Open sheet", () => {
  it("opens folders in VS Code and drops helper-only controls", () => {
    openSheet();
    const b = row("app").querySelector<HTMLButtonElement>(".op-b")!;
    expect(b.textContent).toBe("Open");
    expect(b.dataset.url).toBe("vscode://file/Volumes/X/projects/app");
    expect(sheet().querySelector(".op-new")).toBeNull();
    expect(sheet().querySelector(".restore")).toBeNull();
    expect(sheet().querySelector(".op-hint")!.textContent).toBe("");
  });
  it("a project under a non-default root opens under that root", () => {
    openSheet();
    expect(row("Dev:tool").querySelector<HTMLElement>(".op-b")!.dataset.url).toBe("vscode://file/Volumes/X/Dev/tool");
  });
  it("expanded folders get one Open each, no New worktree", () => {
    openSheet();
    row("app").click();
    const bs = [...sheet().querySelectorAll<HTMLElement>(".op-f .op-b")];
    expect(bs.map((x) => x.textContent)).toEqual(["Open", "Open"]);
    expect(bs.every((x) => x.classList.contains("vscode"))).toBe(true);
    expect(bs[1].dataset.url).toBe("vscode://file/Volumes/X/projects/app-wt");
  });
  it("clicking Open navigates via nav.go; the colour dot stays", () => {
    const g = vi.spyOn(nav, "go").mockImplementation(() => {});
    openSheet();
    expect(row("Dev:tool").querySelector(".op-dot")).not.toBeNull();
    row("Dev:tool").querySelector<HTMLButtonElement>(".op-b")!.click();
    expect(g).toHaveBeenCalledWith("vscode://file/Volumes/X/Dev/tool");
  });
});

describe("vscodeFolderUrl", () => {
  it("Windows root gives vscode://file/C:/...; posix root unchanged", () => {
    store.createRoots = [{ label: "projects", path: "C:/Users/dev/src", exists: true }];
    expect(vscodeFolderUrl(folder("app"))).toBe("vscode://file/C:/Users/dev/src/app");
    store.createRoots = [{ label: "projects", path: "D:/", exists: true }];
    expect(vscodeFolderUrl(folder("app"))).toBe("vscode://file/D:/app");
    store.createRoots = [{ label: "projects", path: "D:\\", exists: true }];
    expect(vscodeFolderUrl(folder("app"))).toBe("vscode://file/D:/app");
    store.createRoots = [{ label: "projects", path: "/", exists: true }];
    expect(vscodeFolderUrl(folder("app"))).toBe("vscode://file/app");
    store.createRoots = [{ label: "projects", path: "/Users/dev/src", exists: true }];
    expect(vscodeFolderUrl(folder("app"))).toBe("vscode://file/Users/dev/src/app");
  });
});
