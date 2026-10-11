import type { Project } from "@fo/shared";
import { PALETTE } from "@fo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/state";
import { bindOpen, openSheet, renderSheet } from "../src/ui/open";
import { loadDom, reset } from "./helpers";

const TOKEN = "a".repeat(64);
const folder = (rel: string) => ({ rel, worktree: null, live: null, restore: [] });
const proj = (key: string, patch: Partial<Project> = {}): Project => ({ key, name: key, group: null, color: "#aabbcc", folders: [folder(key)], ...patch });
const $ = (s: string) => document.querySelector<HTMLElement>(s);
const click = (el: Element | null) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

let bound = false;
beforeEach(() => {
  reset(); loadDom();
  Object.assign(store, { projects: [proj("app")], rootMissing: false, helperToken: TOKEN });
  if (!bound) { bindOpen(); bound = true; }
  vi.restoreAllMocks();
});

describe("Open sheet colour picker", () => {
  it("dot opens the popover without toggling the row", () => {
    openSheet();
    click($('.op-dot[data-key="app"]'));
    expect(document.querySelectorAll(".op-pick .op-sw:not(.reset)")).toHaveLength(PALETTE.length);
    expect($('.op-row[data-key="app"] .op-car')!.textContent).toBe("▸");
  });
  it("picking recolours at once and posts the colour", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    openSheet();
    click($('.op-dot[data-key="app"]'));
    click($(`.op-sw[data-c="${PALETTE[0]}"]`));
    expect($('.op-row[data-key="app"]')!.style.getPropertyValue("--pc")).toBe(PALETTE[0]);
    expect($(".op-pick")).toBeNull();
    expect(f).toHaveBeenCalledWith("/api/color", expect.objectContaining({ method: "POST", body: JSON.stringify({ key: "app", color: PALETTE[0] }) }));
  });
  it("a failed save reverts the row and shows a note", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 400 }));
    openSheet();
    click($('.op-dot[data-key="app"]'));
    click($(`.op-sw[data-c="${PALETTE[1]}"]`));
    await vi.waitFor(() => expect($('.op-row[data-key="app"]')!.style.getPropertyValue("--pc")).toBe("#aabbcc"));
    expect($(".op-pick-err")!.textContent).toBe("Colour not saved");
  });
  it("a late failure of an older pick does not undo a newer pick", async () => {
    let fail!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(new Promise<Response>((r) => { fail = r; }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    openSheet();
    click($('.op-dot[data-key="app"]'));
    click($(`.op-sw[data-c="${PALETTE[0]}"]`));
    click($('.op-dot[data-key="app"]'));
    click($(`.op-sw[data-c="${PALETTE[1]}"]`));
    fail(new Response("", { status: 400 }));
    await new Promise((r) => setTimeout(r, 20));
    expect($('.op-row[data-key="app"]')!.style.getPropertyValue("--pc")).toBe(PALETTE[1]);
    expect($(".op-pick-err")).toBeNull();
  });
  it("popover swatches carry aria-pressed for the current colour", () => {
    store.projects = [proj("fresh", { color: PALETTE[0] })];
    openSheet();
    click($('.op-dot[data-key="fresh"]'));
    expect($(`.op-pick .op-sw[data-c="${PALETTE[0]}"]`)!.getAttribute("aria-pressed")).toBe("true");
    expect($(`.op-pick .op-sw[data-c="${PALETTE[1]}"]`)!.getAttribute("aria-pressed")).toBe("false");
  });
  it("reset posts null", () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    openSheet();
    click($('.op-dot[data-key="app"]'));
    click($(".op-sw.reset"));
    expect(f).toHaveBeenCalledWith("/api/color", expect.objectContaining({ body: JSON.stringify({ key: "app", color: null }) }));
  });
  it("Escape closes the popover but not the sheet", () => {
    openSheet();
    click($('.op-dot[data-key="app"]'));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect($(".op-pick")).toBeNull();
    expect($("#sheet")!.hidden).toBe(false);
  });
  it("popover survives a projects push re-render", () => {
    openSheet();
    click($('.op-dot[data-key="app"]'));
    store.projects = [proj("app"), proj("other")];
    renderSheet();
    expect($('.op-row[data-key="app"] + .op-pick, .op-pick')).not.toBeNull();
  });
  it("a failed reset shows a note", async () => {
    store.projects = [proj("reset-fail", { color: PALETTE[2] })];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 400 }));
    openSheet();
    click($('.op-dot[data-key="reset-fail"]'));
    click($(".op-sw.reset"));
    await vi.waitFor(() => expect($(".op-pick-err")!.textContent).toBe("Colour not saved"));
  });
  it("reset recolours to base at once", () => {
    store.projects = [proj("reset-base", { color: PALETTE[2], base: PALETTE[4] })];
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => {}));
    openSheet();
    click($('.op-dot[data-key="reset-base"]'));
    click($(".op-sw.reset"));
    expect($('.op-row[data-key="reset-base"]')!.style.getPropertyValue("--pc")).toBe(PALETTE[4]);
  });
  it("a failed reset with a base returns the row to the old colour and shows the note", async () => {
    store.projects = [proj("reset-base-fail", { color: PALETTE[2], base: PALETTE[4] })];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 400 }));
    openSheet();
    click($('.op-dot[data-key="reset-base-fail"]'));
    click($(".op-sw.reset"));
    await vi.waitFor(() => expect($(".op-pick-err")!.textContent).toBe("Colour not saved"));
    expect($('.op-row[data-key="reset-base-fail"]')!.style.getPropertyValue("--pc")).toBe(PALETTE[2]);
  });
  it("no dot without a helper token", () => {
    store.helperToken = null;
    openSheet();
    expect($(".op-dot")).toBeNull();
  });
});
