import fs from "node:fs";
import path from "node:path";
import { localMidnight } from "./queries";
import { jevLineKey, parseJevLine } from "./jev";
import type { Store } from "./store";

export interface TailSource { dir: string; match: RegExp; onLine(file: string, line: string): void }

const MAX_CHUNK = 8 * 1024 * 1024;

export class Tailer {
  errors = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private store: Store, private sources: TailSource[], private after: () => void = () => {}) {}

  setSources(sources: TailSource[]): void { this.sources = sources; }

  pollOnce(): void {
    for (const src of this.sources) {
      let names: string[];
      try { names = fs.readdirSync(src.dir); } catch { continue; }
      for (const name of names.filter((n) => src.match.test(n)).sort()) this.readFile(src, path.join(src.dir, name));
    }
    this.after();
  }

  private readFile(src: TailSource, file: string): void {
    let size: number;
    try { size = fs.statSync(file).size; } catch { return; }
    let off = this.store.getOffset(file);
    if (size < off) off = 0;
    if (size === off) return;
    const len = Math.min(size - off, MAX_CHUNK);
    const buf = Buffer.alloc(len);
    try {
      const fd = fs.openSync(file, "r");
      try { fs.readSync(fd, buf, 0, len, off); } finally { fs.closeSync(fd); }
    } catch { return; } // deleted or unreadable since stat: skip it this poll
    const end = buf.lastIndexOf(0x0a);
    if (end < 0) return; // a half-written line: wait for its newline
    const text = buf.subarray(0, end + 1).toString("utf8");
    this.store.tx(() => {
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try { src.onLine(file, line); } catch { this.errors++; }
      }
      this.store.setOffset(file, off + end + 1);
    });
  }

  start(ms: number): void {
    const poll = () => { try { this.pollOnce(); } catch (e) { this.errors++; console.error("tail", e); } };
    poll();
    this.timer = setInterval(poll, ms);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const SEEN_KEY = "jev.seen.v1";

/**
 * Once per database: mark every Jev line already read (bytes before each stored offset, in every dir with offsets except
 * `skip`, e.g. the spool) as seen, so a dir read for the first time (~/.dryas/jev/logs holding lines Dryas moved or
 * appended from ~/.claude/jev/logs) skips them. Covers an upgrade made after Dryas migrated. When an old file can no
 * longer be read, its offset is carried by name to `target` (the shared log dir) instead, if that has none yet.
 * Returns the number of lines marked.
 */
export function backfillJevSeen(store: Store, skip: string[], target: string | null): number {
  if (store.kvGet(SEEN_KEY)) return 0;
  let n = 0;
  store.tx(() => {
    for (const dir of store.offsetDirs()) {
      if (skip.includes(dir) || dir === target) continue;
      for (const [name, byte] of store.offsetsIn(dir)) {
        if (!name.endsWith(".jsonl") || byte <= 0) continue;
        let text: string;
        try {
          const fd = fs.openSync(path.join(dir, name), "r");
          try { const buf = Buffer.alloc(byte); const got = fs.readSync(fd, buf, 0, byte, 0); text = buf.subarray(0, got).toString("utf8"); }
          finally { fs.closeSync(fd); }
        } catch {
          if (target && store.getOffset(path.join(target, name)) === 0) store.setOffset(path.join(target, name), byte);
          continue;
        }
        const file = path.basename(name, ".jsonl");
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          const j = parseJevLine(file, line);
          if (j && store.jevFirstSeen(jevLineKey(file, line), j.ts)) n++;
        }
      }
    }
    store.kvSet(SEEN_KEY, String(Date.now()));
  });
  return n;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function pruneSpool(store: Store, dir: string, now: number, days: number): string[] {
  const cut = new Date(localMidnight(now));
  cut.setDate(cut.getDate() - days);
  const cutoff = ymd(cut);
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const removed: string[] = [];
  for (const name of names.sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!m || m[1] >= cutoff) continue;
    const file = path.join(dir, name);
    try { fs.unlinkSync(file); } catch { continue; }
    store.deleteOffset(file);
    removed.push(name);
  }
  return removed;
}
