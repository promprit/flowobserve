import type { Status } from "@fo/shared";
import { IDLE_MS, RANK } from "./config";
import { type CSession, now, store } from "./state";

export const eff = (s: CSession): Status => (s.status === "active" && now() - (s.lastEventAt || now()) > IDLE_MS ? "idle" : s.status);
export const sorted = () => [...store.sessions.values()].sort((a, b) => RANK[eff(a)] - RANK[eff(b)] || a.order - b.order);
export const byOrder = () => [...store.sessions.values()].sort((a, b) => a.order - b.order);

