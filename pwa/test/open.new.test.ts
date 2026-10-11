import { PALETTE, nameColor } from "@fo/shared";
import type { Project } from "@fo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/state";
import { closeDrawer } from "../src/ui/drawer";
import { bindOpen, closeSheet, openSheet, renderSheet } from "../src/ui/open";
import { nav } from "../src/util";
import { loadDom, reset } from "./helpers";

const TOKEN = "a".repeat(64);
const folder = (rel: string, patch: Record<string, unknown> = {}) => ({ rel, worktree: null, live: null, restore: [], ...patch });
const proj = (key: string, patch: Partial<Project> = {}): Project =>
  ({ key, name: key, group: null, color: "#aabbcc", folders: [folder(key)], ...patch }) as Project;
const projWithRoot = (key: string, root: string): Project =>
  ({ key, name: key, group: null, color: "#aabbcc", folders: [folder(key, { root })] }) as unknown as Project;
const setStore = (patch: Record<string, unknown>) => {
  Object.assign(store, { projects: [], rootMissing: false, helperToken: TOKEN, createRoots: undefined }, patch);
};
const spyGo = () => vi.spyOn(nav, "go").mockImplementation(() => {});

let bound = false;
beforeEach(() => {
  reset(); loadDom(); closeDrawer();
  setStore({});
  if (!bound) { bindOpen(); bound = true; }
  closeSheet();
  vi.restoreAllMocks();
});

const type = (input: HTMLInputElement, v: string) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); };

describe("New project row", () => {
  it("New project row is hidden without a projects message", () => {
    setStore({ projects: [], rootMissing: false, helperToken: null, createRoots: undefined });
    openSheet();
    expect(document.querySelector(".op-new")).toBeNull();
  });

  it("path select lists createRoots labels and pre-selects the first", () => {
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }, { label: "Dev", path: "/d", exists: true }] });
    openSheet();
    const sel = document.querySelector<HTMLSelectElement>(".op-new-root")!;
    expect([...sel.options].map((o) => o.value)).toEqual(["projects", "Dev"]);
    expect(sel.value).toBe("projects");
  });

  it("an unplugged root is shown disabled; the SSD message names only the selected root", () => {
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }, { label: "Dev", path: "/d", exists: false }] });
    openSheet();
    const sel = document.querySelector<HTMLSelectElement>(".op-new-root")!;
    const dev = [...sel.options].find((o) => o.value === "Dev")!;
    expect(dev.disabled).toBe(true);
    expect(document.querySelector(".op-new-msg")!.textContent).toBe("");
    sel.value = "Dev";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector(".op-new-msg")!.textContent).toContain("Dev not found");
    expect(document.querySelector(".op-new-msg")!.textContent).toContain("SSD mounted?");
  });

  it("row is disabled when the selected root is missing, even with a valid name", () => {
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }, { label: "Dev", path: "/d", exists: false }] });
    openSheet();
    const sel = document.querySelector<HTMLSelectElement>(".op-new-root")!;
    sel.value = "Dev";
    type(document.querySelector<HTMLInputElement>(".op-new-name")!, "my-app");
    expect(document.querySelector(".op-new-msg")!.textContent).toContain("Dev not found");
    expect(document.querySelector<HTMLButtonElement>(".op-new-create")!.disabled).toBe(true);
    document.querySelector<HTMLFormElement>(".op-new")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(go).not.toHaveBeenCalled();
  });

  it("Create is disabled without a helper token", () => {
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }], helperToken: null });
    openSheet();
    type(document.querySelector<HTMLInputElement>(".op-new-name")!, "my-app");
    expect(document.querySelector<HTMLButtonElement>(".op-new-create")!.disabled).toBe(true);
  });

  it("the sheet closes after a successful submit", () => {
    spyGo();
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }] });
    openSheet();
    const input = document.querySelector<HTMLInputElement>(".op-new-name")!;
    type(input, "my-app");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector<HTMLElement>("#sheet")!.hidden).toBe(true);
  });

  it("a second submit while creating sends nothing, even after the 1 s re-render", () => {
    vi.useFakeTimers();
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }] });
    const submit = () => {
      openSheet();
      const input = document.querySelector<HTMLInputElement>(".op-new-name")!;
      type(input, "dbl-app");
      renderSheet();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    };
    submit();
    submit();
    expect(go).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  it("Create stays disabled for an invalid name and enables for a valid one", () => {
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }] });
    openSheet();
    const input = document.querySelector<HTMLInputElement>(".op-new-name")!;
    const create = document.querySelector<HTMLButtonElement>(".op-new-create")!;
    type(input, "a/b");
    expect(create.disabled).toBe(true);
    type(input, "my-app");
    expect(create.disabled).toBe(false);
  });

  it("an existing sibling name disables Create with the open-it-below line", () => {
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }] });
    openSheet();
    const input = document.querySelector<HTMLInputElement>(".op-new-name")!;
    type(input, "app");
    expect(document.querySelector<HTMLButtonElement>(".op-new-create")!.disabled).toBe(true);
    expect(document.querySelector(".op-new-msg")!.textContent).toBe("Already a folder here — open it below");
  });

  it("Enter submits a valid name through go() with the new URL", () => {
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }], helperToken: TOKEN });
    openSheet();
    const input = document.querySelector<HTMLInputElement>(".op-new-name")!;
    type(input, "my-app");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(go).toHaveBeenCalledWith(expect.stringMatching(/^flowobserve:\/\/new\?root=projects&name=my-app&t=/));
  });

  it("Esc closes the sheet", () => {
    setStore({ projects: [proj("app")], createRoots: [{ label: "projects", path: "/p", exists: true }] });
    openSheet();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector<HTMLElement>("#sheet")!.hidden).toBe(true);
  });

  it("folder buttons send the folder's root label", () => {
    const go = spyGo();
    setStore({ projects: [projWithRoot("tool", "Dev")], helperToken: TOKEN, createRoots: [] });
    openSheet();
    document.querySelector<HTMLElement>(".op-row")!.click();
    document.querySelector<HTMLButtonElement>(".op-b")!.click();
    expect(go.mock.calls.at(-1)![0]).toMatch(/root=Dev/);
  });
});

describe("New project colour", () => {
  const roots = [{ label: "projects", path: "/p", exists: true }, { label: "Dev", path: "/d", exists: true }];
  let n = 0;
  // `creating` is module state that outlives a test; a changed project list (what a real create does) clears it.
  beforeEach(() => { setStore({ projects: [proj(`seed${n++}`)] }); renderSheet(); });
  const swatch = (c: string) => document.querySelector<HTMLElement>(`.op-new .op-sw[data-c="${c}"]`)!;
  const nameIt = (v: string) => type(document.querySelector<HTMLInputElement>(".op-new-name")!, v);
  const submit = () => document.querySelector<HTMLFormElement>(".op-new")!.requestSubmit();
  it("previews the name colour until a swatch is picked", () => {
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    nameIt("fresh");
    expect(document.querySelector<HTMLElement>(".op-new-sw")!.style.getPropertyValue("--pc")).toBe(nameColor("fresh"));
  });
  it("Create posts the picked colour with the pending key, then opens the new link", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    nameIt("fresh");
    swatch(PALETTE[2]).click();
    submit();
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith(expect.stringMatching(/^flowobserve:\/\/new\?root=projects&name=fresh/)));
    expect(f).toHaveBeenCalledWith("/api/color", expect.objectContaining({ body: JSON.stringify({ key: "fresh", color: PALETTE[2] }) }));
  });
  it("under another root the key is label:name", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    spyGo();
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    const sel = document.querySelector<HTMLSelectElement>(".op-new-root")!;
    sel.value = "Dev"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    nameIt("tool");
    swatch(PALETTE[0]).click();
    submit();
    await vi.waitFor(() => expect(f).toHaveBeenCalledWith("/api/color", expect.objectContaining({ body: JSON.stringify({ key: "Dev:tool", color: PALETTE[0] }) })));
  });
  it("without a pick Create sends no colour", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 400 }));
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    nameIt("plain");
    submit();
    await vi.waitFor(() => expect(go).toHaveBeenCalled());
    expect(f).not.toHaveBeenCalled();
  });
  it("a failed save still creates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 400 }));
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    nameIt("plain");
    swatch(PALETTE[1]).click();
    submit();
    await vi.waitFor(() => expect(go).toHaveBeenCalled());
  });
  it("fetch is called before the new-link go", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    nameIt("ordered");
    swatch(PALETTE[2]).click();
    submit();
    await vi.waitFor(() => expect(go).toHaveBeenCalled());
    expect(f.mock.invocationCallOrder[0]).toBeLessThan(go.mock.invocationCallOrder[0]);
  });
  it("second submit while the colour save is pending", async () => {
    let done!: (r: Response) => void;
    const f = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((r) => { done = r; }));
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    nameIt("pending");
    swatch(PALETTE[2]).click();
    submit();
    expect(document.querySelector(".op-new-create")!.textContent).toBe("Creating…");
    expect((document.querySelector(".op-new-create") as HTMLButtonElement).disabled).toBe(true);
    submit();
    document.querySelector<HTMLInputElement>(".op-new-name")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    done(new Response("{}", { status: 200 }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a projects push during a pending colour save keeps Create locked and fires one go", async () => {
    let done!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((r) => { done = r; }));
    const go = spyGo();
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    nameIt("pushed");
    swatch(PALETTE[2]).click();
    submit();
    store.projects = [proj("app"), proj("other-new")];
    renderSheet();
    expect((document.querySelector(".op-new-create") as HTMLButtonElement).disabled).toBe(true);
    submit();
    done(new Response("{}", { status: 200 }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  });
  it("swatches carry aria-pressed for the picked colour", () => {
    setStore({ projects: [proj("app")], createRoots: roots });
    openSheet();
    swatch(PALETTE[1]).click();
    expect(swatch(PALETTE[1]).getAttribute("aria-pressed")).toBe("true");
    expect(swatch(PALETTE[0]).getAttribute("aria-pressed")).toBe("false");
  });
});
