import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireAgent } from "@fo/shared";
import { pager } from "../src/pager";
import { type CSession, store, ui } from "../src/state";
import { applySnapshot, upsert } from "../src/store";
import { selectAgent } from "../src/ui/agents";
import { renderCards } from "../src/ui/cards";
import { T0, agent, loadDom, reset, sess, wire } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); });

const ago = (sec: number) => T0 - sec * 1000;
const run = (tool: string, sec: number) => ({ tool, since: ago(sec) });
const put = (...l: CSession[]) => l.forEach((s) => store.sessions.set(s.id, s));
const card = (id = "a") => document.querySelector<HTMLElement>(`.card[data-id="${id}"]`)!;
const lanes = (id = "a") => [...card(id).querySelectorAll<HTMLElement>(".ag .lane")];
const pips = (id = "a") => [...card(id).querySelectorAll<HTMLElement>(".ag .pips .pip")];
const B4 = (): WireAgent[] => [
  agent("b1", { task: "Parse ISO dates with offsets in parse_date", state: "done", endedAt: ago(9), toolCalls: 31, tokens: 52800, spawnedAt: ago(251) }),
  agent("b2", { task: "Migrate the session store to schema v3", running: run("Edit", 72), toolCalls: 44, tokens: 71300, spawnedAt: ago(250) }),
  agent("b3", { task: "Empty-state copy for the cards zone", running: run("Read", 8), toolCalls: 19, tokens: 23900, spawnedAt: ago(250) }),
  agent("b4", { task: "CSV export of shipped tasks with a header row", state: "waiting", running: run("Bash", 37), toolCalls: 12, tokens: 18400, spawnedAt: ago(249) }),
];
const many = (n: number, p: Partial<WireAgent> = {}) => Array.from({ length: n }, (_, i) => agent("x" + i, { spawnedAt: ago(100) + i, ...p }));
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("agents row", () => {
  it("old server: a session without agents shows no agents row", () => {
    put(sess("a", { stage: 3, builders: ["working", "idle", "idle"] }));
    renderCards();
    expect(card().classList.contains("has-ag")).toBe(false);
    expect(lanes()).toHaveLength(0);
  });

  it("one lane per visible agent, in spawn order, between the stage bar and the terminal", () => {
    put(sess("a", { stage: 3, agents: B4() }));
    renderCards();
    const c = card();
    expect(c.classList.contains("has-ag")).toBe(true);
    expect(c.querySelector(".c2")!.nextElementSibling!.classList.contains("ag")).toBe(true);
    expect(c.querySelector(".ag")!.nextElementSibling!.classList.contains("term")).toBe(true);
    expect(lanes().map((l) => l.dataset.aid)).toEqual(["b1", "b2", "b3", "b4"]);
    expect(lanes().map((l) => l.querySelector(".n")!.textContent)).toEqual(["EXECUTOR 1", "EXECUTOR 2", "EXECUTOR 3", "EXECUTOR 4"]);
    expect(lanes()[3].className).toContain("waiting");
    expect(lanes()[3].querySelector(".r")!.textContent).toBe("NEEDS YOU · BASH");
    expect(lanes()[2].querySelector(".r")!.textContent).toBe("READ 0:08");
    expect(c.querySelector(".ag .as")!.textContent).toBe("4 AGENTS · 1 WAITING · 2 WORKING · 1 DONE");
    const bold = [...c.querySelectorAll<HTMLElement>(".ag .as b")];
    expect(bold.map((b) => b.textContent)).toEqual(["4 AGENTS", "1 WAITING"]);
    expect(bold[1].style.color).toBe("rgb(242, 181, 68)");
    expect(pips().map((p) => p.dataset.aid)).toEqual(["b1", "b2", "b3", "b4"]);
    expect(pips()[3].style.getPropertyValue("--m")).toBe("#F2B544");
  });

  it("a done agent leaves the lanes 20 s after it ended", () => {
    put(sess("a", { stage: 3, agents: B4() }));
    vi.setSystemTime(T0 + 12_000);
    renderCards();
    expect(lanes().map((l) => l.dataset.aid)).toEqual(["b2", "b3", "b4"]);
  });

  it("eight lanes, then +N MORE; every agent keeps a pip", () => {
    put(sess("a", { stage: 3, agents: many(12) }));
    renderCards();
    expect(lanes()).toHaveLength(8);
    expect(card().querySelector<HTMLElement>(".ag .lanes")!.dataset.more).toBe("+4 MORE");
    expect(pips()).toHaveLength(12);
  });

  it("markup in a task or a tool name is shown as text, never parsed", () => {
    put(sess("a", { stage: 3, agents: [agent("x1", { task: "<b>x</b>", running: { tool: "<img src=x onerror=alert(1)>", since: ago(5) } })] }));
    renderCards();
    const c = card(), t = c.querySelector(".lane .t")!;
    expect(t.textContent).toBe("<b>x</b>");
    expect(t.querySelector("b")).toBeNull();
    expect(c.querySelector(".lane .r")!.textContent).toBe("<IMG SRC=X ONERROR=ALERT(1)> 0:05");
    expect(c.querySelector("img")).toBeNull();
    selectAgent("a", "x1");
    renderCards();
    expect(c.querySelector(".agd .at")!.textContent).toBe("<b>x</b>");
    expect(c.querySelector(".agd .at b, .agd img")).toBeNull();
  });

  it("tap a lane: the detail replaces the terminal; tap the detail to close it", () => {
    put(sess("a", { stage: 3, agents: B4() }));
    pager.focus = "a";
    renderCards();
    click(lanes()[3]);
    expect(ui.agentSel).toEqual({ sid: "a", aid: "b4", at: T0 });
    renderCards();
    const c = card();
    expect(c.classList.contains("sel-ag")).toBe(true);
    expect(lanes()[3].classList.contains("sel")).toBe(true);
    expect(c.querySelector(".agd .ah")!.textContent).toContain("EXECUTOR 4 · SONNET");
    expect(c.querySelector(".agd .ah")!.textContent).toContain("NEEDS YOU");
    expect([...c.querySelectorAll(".agd .an b")].map((b) => b.textContent)).toEqual(["BASH 0:37", "4:09", "12", "18K"]);
    expect(c.querySelector(".agd .ap")!.textContent).toBe("SPAWNED BY MAIN SESSION");
    click(c.querySelector(".agd")!);
    expect(ui.agentSel).toBeNull();
    renderCards();
    expect(c.classList.contains("sel-ag")).toBe(false);
  });

  it("tapping the selected pip again clears it", () => {
    put(sess("a", { stage: 3, agents: B4() }));
    renderCards();
    click(pips()[1]); expect(ui.agentSel?.aid).toBe("b2");
    click(pips()[1]); expect(ui.agentSel).toBeNull();
  });

  it("the selection clears itself after 60 s", () => {
    put(sess("a", { stage: 3, agents: B4() }));
    selectAgent("a", "b2");
    renderCards();
    expect(card().classList.contains("sel-ag")).toBe(true);
    vi.setSystemTime(T0 + 60_001);
    renderCards();
    expect(ui.agentSel).toBeNull();
    expect(card().classList.contains("sel-ag")).toBe(false);
  });

  it("the selection shows only on its own session's card", () => {
    put(sess("a", { stage: 3, agents: B4() }), sess("b", { name: "a", stage: 3, agents: B4() }, 1)); // same project: both cards shown
    selectAgent("a", "b2");
    renderCards();
    expect(card("a").classList.contains("sel-ag")).toBe(true);
    expect(card("b").classList.contains("sel-ag")).toBe(false);
  });

  it("the cycle tally shows from the review stage on", () => {
    put(sess("a", { stage: 5, agents: [agent("r1", { type: "reviewer", model: "opus" })], agentTally: { spawned: 10, passed: 5, failed: 1, escalated: 1 } }));
    renderCards();
    expect(card().querySelector(".ag .atl")!.textContent).toBe("THIS CYCLE · 10 SPAWNED · 5 PASSED · 1 FAILED · 1 ESCALATED");
    put(sess("a", { stage: 3, agents: [agent("r1")], agentTally: { spawned: 10, passed: 5, failed: 1, escalated: 1 } }));
    renderCards();
    expect(card().querySelector(".ag .atl")!.textContent).toBe("");
  });

  it("an escalation is one lane with a two-segment pill; a lone re-dispatch keeps its pill", () => {
    put(sess("a", { stage: 4, agents: [
      agent("c2", { state: "escalated", endedAt: ago(2), spawnedAt: ago(299) }),
      agent("c2o", { model: "opus", escalatedFrom: "sonnet", running: run("Read", 0), spawnedAt: ago(1) }),
    ] }));
    renderCards();
    expect(lanes()).toHaveLength(1);
    const p = lanes()[0].querySelector<HTMLElement>(".pip")!;
    expect(p.classList.contains("ln")).toBe(true);
    expect(p.querySelectorAll("i")).toHaveLength(2);
    expect(lanes()[0].querySelector(".r")!.textContent).toBe("SONNET → OPUS · READ 0:00");
    put(sess("a", { stage: 4, agents: [agent("e4", { model: "opus", escalatedFrom: "sonnet" })] }));
    renderCards();
    expect(lanes()[0].querySelector(".pip")!.querySelectorAll("i")).toHaveLength(2);
  });

  it("16 agents and 50 rapid session messages keep the same DOM", () => {
    applySnapshot([wire("a", { stage: 3, agents: many(16) })]);
    renderCards();
    const l0 = lanes(), p0 = pips();
    for (let i = 0; i < 50; i++) { upsert(wire("a", { stage: 3, agents: many(16, { toolCalls: i + 1 }) }), 0); renderCards(); }
    expect(lanes().every((l, i) => l === l0[i])).toBe(true); // same elements, not just equal markup
    expect(pips().every((p, i) => p === p0[i])).toBe(true);
    expect(lanes()).toHaveLength(8);
    expect(card().querySelector<HTMLElement>(".ag .lanes")!.dataset.more).toBe("+8 MORE");
  });

  it("a reconnect replay of the same snapshot reuses the lanes and keeps the selection", () => {
    const snap = () => applySnapshot([wire("a", { stage: 3, agents: B4() })]);
    snap(); renderCards();
    const l0 = lanes();
    selectAgent("a", "b3");
    snap(); renderCards();
    expect(lanes()).toHaveLength(l0.length);
    expect(lanes().every((l, i) => l === l0[i])).toBe(true);
    expect(ui.agentSel?.aid).toBe("b3");
  });
});
