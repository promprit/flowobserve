import type { Project } from "@fo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { helperUrl } from "../src/helper";
import { store } from "../src/state";
import { closeDrawer } from "../src/ui/drawer";
import { bindOpen, closeSheet, openSheet } from "../src/ui/open";
import { nav } from "../src/util";
import { loadDom, reset } from "./helpers";

const TOKEN = "a".repeat(64);
const folder = (rel: string) => ({ rel, worktree: null, live: null, restore: [] });
const proj = (key: string, patch: Partial<Project> = {}): Project =>
  ({ key, name: key, group: null, color: "#aabbcc", folders: [folder(key)], ...patch });

let bound = false;
beforeEach(() => {
  reset(); loadDom(); closeDrawer();
  Object.assign(store, { projects: [], rootMissing: false, helperToken: TOKEN });
  if (!bound) { bindOpen(); bound = true; }
  closeSheet();
  vi.restoreAllMocks();
});
const sheet = () => document.querySelector<HTMLElement>("#sheet")!;
const row = (key: string) => sheet().querySelector<HTMLElement>(`.op-row[data-key="${key}"]`)!;

describe("plain (no git) folders", () => {
  it("plain row shows no git tag", () => {
    store.projects = [proj("notes", { plain: true })];
    openSheet();
    expect(row("notes").textContent).toContain("no git");
  });
  it("a git row has no no git tag", () => {
    store.projects = [proj("app")];
    openSheet();
    expect(row("app").textContent).not.toContain("no git");
  });
  it("Open on a plain folder still sends the open URL", () => {
    const spy = vi.spyOn(nav, "go").mockImplementation(() => {});
    store.projects = [proj("notes", { plain: true })];
    openSheet();
    row("notes").querySelector<HTMLElement>(".op-b")!.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(helperUrl.open("notes", [], false, null, "#aabbcc"));
    expect(String(spy.mock.calls[0][0])).toMatch(/^flowobserve:\/\/open\?.*notes/);
  });
});
