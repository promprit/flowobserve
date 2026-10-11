import { beforeEach, expect, it, vi } from "vitest";
import { pager } from "../src/pager";
import { store, view } from "../src/state";
import { renderHead } from "../src/ui/head";
import { T0, agent, loadDom, reset, sess } from "./helpers";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); });
const meta = () => document.querySelector("#meta")!.textContent!;

it("focused: N AGENTS beside the stage; nothing without agents", () => {
  store.sessions.set("a", sess("a", { stage: 3, agents: [agent("e1"), agent("e2")] })); pager.focus = "a";
  renderHead(); expect(meta()).toContain("2 AGENTS");
  store.sessions.set("a", sess("a", { stage: 3, agents: [agent("e1")] }));
  renderHead(); expect(meta()).toContain("1 AGENT"); expect(meta()).not.toContain("1 AGENTS");
  store.sessions.set("a", sess("a", { stage: 3 }));
  renderHead(); expect(meta()).not.toContain("AGENT");
});

it("zoomed out: the total across sessions", () => {
  store.sessions.set("a", sess("a", { stage: 3, agents: [agent("e1"), agent("e2")] }, 0));
  store.sessions.set("b", sess("b", { stage: 3, agents: [agent("e3")] }, 1));
  pager.focus = "a"; view.zt = 0;
  renderHead();
  expect(meta()).toContain("3 AGENTS");
});
