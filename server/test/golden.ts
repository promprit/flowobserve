import { Engine } from "../src/engine";
import { Store } from "../src/store";

const tsOf = (line: string): number => {
  try { const t = Date.parse(JSON.parse(line).ts); return Number.isFinite(t) ? t : NaN; } catch { return NaN; }
};

/** Replays one spool file through the real engine. A last line without "\n" is half-written and skipped, as the tailer does. */
export function replayGolden(spool: string) {
  const complete = spool.endsWith("\n") ? spool : spool.slice(0, spool.lastIndexOf("\n") + 1);
  const lines = complete.split("\n").filter((l) => l.length > 0);
  const clock = { t: 0 };
  let last = 0;
  const engine = new Engine(new Store(":memory:"), () => clock.t);
  for (const l of lines) {
    const t = tsOf(l);
    if (Number.isFinite(t)) { clock.t = t; last = Math.max(last, t); }
    engine.ingestSpool(l);
  }
  clock.t = last + 1;
  engine.flush(true);
  return { snapshot: engine.snapshot(), counts: engine.health().counts };
}
