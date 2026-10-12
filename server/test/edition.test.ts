import { describe, expect, it } from "vitest";
import { MsgZ } from "@fo/shared";
import { loadConfig } from "../src/config";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { at } from "./helpers";

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;

describe("edition", () => {
  it("config reads FO_EDITION, unknown or unset is both", () => {
    expect(loadConfig(env({ FO_EDITION: "vscode" }), "darwin").edition).toBe("vscode");
    expect(loadConfig(env({ FO_EDITION: "iterm" }), "darwin").edition).toBe("iterm");
    expect(loadConfig(env({}), "darwin").edition).toBe("both");
    expect(loadConfig(env({ FO_EDITION: "VSCode" }), "darwin").edition).toBe("both");
  });
  it("Windows is always the vscode edition", () => {
    expect(loadConfig(env({ FO_EDITION: "iterm" }), "win32").edition).toBe("vscode");
    expect(loadConfig(env({ FO_EDITION: "both" }), "win32").edition).toBe("vscode");
    expect(loadConfig(env({}), "win32").edition).toBe("vscode");
    expect(loadConfig(env({ FO_EDITION: "iterm" }), "darwin").edition).toBe("iterm");
  });
  it("snapshot carries edition", () => {
    const e = new Engine(new Store(":memory:"), () => at(10));
    expect(e.snapshot().edition).toBe("both");
    e.edition = "iterm";
    expect(MsgZ.parse(e.snapshot())).toMatchObject({ edition: "iterm" });
  });
});
