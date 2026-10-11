import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/state";
import { renderCards } from "../src/ui/cards";
import { T0, loadDom, reset, sess } from "./helpers";

const css = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); loadDom(); });

describe(".term message line (spec §6)", () => {
  it("has a one-line minimum height and no unconditional mask", () => {
    const rule = /\.term\{[^}]*\}/.exec(css)![0];
    expect(rule).toMatch(/min-height:1\.4em/);
    expect(rule).not.toMatch(/mask-image/);
  });
  it("fades only when it holds more than one line", () => {
    expect(css).toMatch(/\.term\.multi\{[^}]*mask-image:linear-gradient/);
  });
  it("portrait term fills the card", () => {
    expect(/\.term\{[^}]*\}/.exec(css)![0]).toMatch(/max-height:calc\(var\(--u\)\*190\)/);
    const rule = /body\.portrait #cards \.term\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toMatch(/max-height:none/);
    expect(rule).toMatch(/flex:1 1 auto/);
  });
  it("the newest line is never dimmed", () => {
    expect(css).toMatch(/\.term \.ln:last-child\{[^}]*opacity:1/);
  });
  it("one line: no .multi; several lines: .multi", () => {
    store.sessions.set("a", sess("a", { log: [{ t: T0, text: "one" }], seeded: true }));
    renderCards();
    expect(document.querySelector(".term")!.classList.contains("multi")).toBe(false);
    store.sessions.set("a", sess("a", { log: [{ t: T0, text: "one" }, { t: T0 + 1000, text: "two" }], seeded: true }));
    renderCards();
    expect(document.querySelector(".term")!.classList.contains("multi")).toBe(true);
  });
});
