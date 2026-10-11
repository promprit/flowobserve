import { store } from "./state";

/** POST a project colour pick (null = reset). True when the server stored it. */
export async function saveColor(key: string, color: string | null): Promise<boolean> {
  const token = store.helperToken;
  if (!token) return false;
  try {
    const r = await fetch("/api/color", { method: "POST", headers: { "x-fo-token": token, "content-type": "application/json" }, body: JSON.stringify({ key, color }) });
    return r.ok;
  } catch {
    return false;
  }
}
