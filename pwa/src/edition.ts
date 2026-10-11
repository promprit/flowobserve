import { store } from "./state";

/** The helper (iTerm2) actions exist in the iterm and both editions. */
export const canHelper = (): boolean => store.edition !== "vscode";
/** Helper actions for a session (e.g. TRY IT): never in vscode; in iterm only for iTerm2 sessions; any host in both. */
export const helperFor = (s: { host?: string }): boolean => canHelper() && (store.edition !== "iterm" || s.host === "iterm");
export const editionLabel = (): string => (store.edition === "vscode" ? "VS Code" : store.edition === "iterm" ? "iTerm2" : "");
/** vscode:// actions for a session: the vscode edition only for VS Code sessions; both keeps the v1 fallback for an iTerm2 session without the helper. */
export const vscodeFor = (s: { host?: string }): boolean => store.edition === "both" || (store.edition === "vscode" && s.host !== "iterm");
