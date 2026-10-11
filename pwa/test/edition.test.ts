import type { Edition } from "@fo/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pager } from "../src/pager";
import { ingest } from "../src/source";
import { store } from "../src/state";
import { popoverContent } from "../src/ui/inspect";
import { bindCards, renderCards } from "../src/ui/cards";
import { bindTabs } from "../src/ui/tabs";
import { renderFoot } from "../src/ui/foot";
import { diffUrl, jump, jumpTarget, verbFor } from "../src/ui/verbs";
import { nav } from "../src/util";
import { T0, loadDom, reset, sess, snap } from "./helpers";

type Host = "vscode" | "iterm";
const U = "0123abcd-4567-89ab-cdef-0123456789ab";
const JUMP = `flowobserve://jump?iterm=w0t1p2%3A${U}`;
const TOKEN = "a".repeat(64);
const VS = "vscode://file/Dev/app";
const folders = [{ key: "app", name: "app", group: null, color: "#112233", folders: [{ rel: "app", worktree: null, live: "a", restore: [] }] }];
const vsS = () => sess("a", { host: "vscode", stage: 5, openUrl: VS });
const itS = () => sess("a", { host: "iterm", stage: 5, jumpUrl: JUMP, openUrl: VS });

beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom();
  Object.assign(store, { helperToken: TOKEN, projects: folders, edition: "both" });
});
afterEach(() => { store.edition = "both"; });

describe("edition gates", () => {
  const cases: [Edition, string | null, string | null, boolean][] = [
    // edition, vscode-session jumpTarget, iterm-session jumpTarget, vscode-session has step buttons
    ["both", VS, JUMP, true],
    ["vscode", VS, null, true],
    ["iterm", null, JUMP, false],
  ];
  it.each(cases)("%s: jumpTarget / verb / diff", (ed, vsT, itT) => {
    store.edition = ed;
    expect(jumpTarget(vsS())).toBe(vsT);
    expect(jumpTarget(itS())).toBe(itT);
    expect(verbFor(itS())?.label).toBe(itT ? "JUMP" : undefined);
    expect(verbFor(vsS())).toBeNull();
    expect(!!diffUrl(itS())).toBe(ed !== "vscode");
    expect(diffUrl(vsS())).toBeNull();
  });
  it("vscode edition builds no flowobserve:// link for an iterm session", () => {
    store.edition = "vscode";
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    const s = itS();
    expect(jump(s)).toBe(false);
    expect(go).not.toHaveBeenCalled();
    store.sessions.set("a", s); pager.focus = "a"; renderCards();
    const c = document.querySelector<HTMLElement>('.card[data-id="a"]')!;
    expect(c.querySelector<HTMLElement>(".btns")!.hidden).toBe(true);
    expect(c.querySelector(".act")!.textContent).not.toBe("JUMP");
  });
  it("snapshot without edition renders as both", () => {
    store.edition = "iterm";
    ingest(snap([]));
    expect(store.edition).toBe("both");
    ingest({ ...snap([]), edition: "vscode" });
    expect(store.edition).toBe("vscode");
  });
  it("footer names the edition only for vscode / iterm", () => {
    const foot = () => { renderFoot(); return document.querySelector("#foot")!.innerHTML; };
    expect(foot()).not.toContain("· VS Code");
    store.edition = "vscode"; expect(foot()).toContain("· VS Code");
    store.edition = "iterm"; expect(foot()).toContain("· iTerm2");
  });
  it("iterm edition: vscode session has hidden step buttons and Enter navigates nowhere", () => {
    store.edition = "iterm";
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    const s = vsS();
    store.sessions.set("a", s); pager.focus = "a"; renderCards();
    const c = document.querySelector<HTMLElement>('.card[data-id="a"]')!;
    expect(c.querySelector<HTMLElement>(".btns")!.hidden).toBe(true);
    expect(jump(s)).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });
  it("both: step buttons stay visible for a vscode session", () => {
    store.sessions.set("a", vsS()); pager.focus = "a"; renderCards();
    expect(document.querySelector<HTMLElement>('.card[data-id="a"] .btns')!.hidden).toBe(false);
  });
});

describe("TRY IT gated by edition", () => {
  const tryS = (host: Host) => sess("a", { host, stage: 3, runnable: true, ready: { review: true, tests: true, build: true }, openUrl: VS });
  it.each<[Edition, Host, boolean]>([["both", "vscode", true], ["both", "iterm", true], ["vscode", "vscode", false], ["vscode", "iterm", false], ["iterm", "vscode", false], ["iterm", "iterm", true]])("%s edition, %s session: TRY IT %s", (ed, host, on) => {
    store.edition = ed; store.projects = folders as never;
    expect(verbFor(tryS(host))?.label).toBe(on ? "TRY IT" : undefined);
  });
});

describe("other-host action chip", () => {
  const needs = (host: Host, patch = {}) => sess("a", { host, stage: 1, status: "waiting", action: "APPROVE", msg: "ok?", openUrl: VS, ...patch });
  const chip = (s: ReturnType<typeof needs>) => { store.sessions.set("a", s); pager.focus = "a"; renderCards(); const c = document.querySelector<HTMLElement>('.card[data-id="a"]')!; return [c.classList.contains("has-act"), c.querySelector(".act")!.textContent] as const; };
  it("iterm edition: a vscode session gets no chip", () => { store.edition = "iterm"; expect(chip(needs("vscode"))).toEqual([false, ""]); });
  it("vscode edition: an iterm session gets no chip", () => { store.edition = "vscode"; expect(chip(needs("iterm"))).toEqual([false, ""]); });
  it("vscode edition: a vscode session keeps its chip", () => { store.edition = "vscode"; expect(chip(needs("vscode"))).toEqual([true, "APPROVE"]); });
  it("the reader chip stays in every edition", () => {
    store.edition = "iterm";
    expect(chip(needs("vscode", { action: "REVIEW SPEC", docs: { spec: 1, plan: 0 } }))).toEqual([true, "REVIEW SPEC"]);
  });
});

describe("tab and inspect vscode links", () => {
  it("inspect: openUrl only when vscodeFor(session)", () => {
    const s = (host: Host) => sess("a", { host, openUrl: VS, nodes: [{ key: "b0", state: "working", model: null, startedAt: null, task: null, waiting: null }] });
    store.edition = "iterm"; expect(popoverContent(s("vscode"), "b0", T0)?.openUrl ?? null).toBeNull();
    store.edition = "vscode"; expect(popoverContent(s("vscode"), "b0", T0)?.openUrl ?? null).toBe(VS);
    expect(popoverContent(s("iterm"), "b0", T0)?.openUrl ?? null).toBeNull();
  });
  it("tabs: the open link does nothing for a session the edition cannot open", () => {
    const go = vi.spyOn(nav, "go").mockImplementation(() => {});
    bindCards(); bindTabs(); store.edition = "iterm"; store.link = "live"; store.sessions.set("a", vsS()); pager.focus = "a";
    renderCards(); document.querySelector<HTMLElement>("#tabs .open")!.click();
    expect(go).not.toHaveBeenCalled();
    store.edition = "both"; document.querySelector<HTMLElement>("#tabs .open")!.click();
    expect(go).toHaveBeenCalledWith(VS);
  });
});

describe("helperFor", () => {
  afterEach(() => { store.edition = "both"; });
  it("helper actions per edition and session host", async () => {
    const { helperFor } = await import("../src/edition");
    const cases: [Edition, string, boolean][] = [
      ["both", "iterm", true], ["both", "vscode", true],
      ["iterm", "iterm", true], ["iterm", "vscode", false],
      ["vscode", "iterm", false], ["vscode", "vscode", false],
    ];
    for (const [e, host, want] of cases) { store.edition = e; expect(helperFor({ host }), `${e}/${host}`).toBe(want); }
  });
});
