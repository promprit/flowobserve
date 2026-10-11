import fs from "node:fs";
import path from "node:path";
import { localMidnight } from "./queries";
import type { Store } from "./store";

export interface TailSource { dir: string; match: RegExp; onLine(file: string, line: string): void }

const MAX_CHUNK = 8 * 1024 * 1024;

export class Tailer {
  errors = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private store: Store, private sources: TailSource[], private after: () => void = () => {}) {}

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
