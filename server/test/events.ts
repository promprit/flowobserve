import type { Event } from "@fo/shared";
import { emptyEmit, initState, reduce, type Emit } from "../src/reducer";
import { at } from "./helpers";

type K = Event["k"];
type F<k extends K> = Omit<Extract<Event, { k: k }>, "k" | "ts" | "sid" | "cwd" | "agentId"> & { agentId?: string | null };
export const ev = <k extends K>(sec: number, k: k, f: F<k>): Event =>
  ({ ts: at(sec), sid: "s1", cwd: "/Users/p/projects/app", agentId: null, k, ...f }) as Event;

export function run(events: Event[]) {
  let s = initState("s1", "/Users/p/projects/app", at(0));
  const all: Emit = emptyEmit();
  for (const e of events) {
    const r = reduce(s, e);
    s = r.state;
    for (const key of Object.keys(all) as (keyof Emit)[]) (all[key] as unknown[]).push(...r.emit[key]);
  }
  return { s, emit: all };
}
