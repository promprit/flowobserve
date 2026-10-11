import fs from "node:fs";
import { parseUsageCache, type ClaudeUsage } from "./usagecache";

export class UsageCachePoller {
  private lastMtime = -1;
  constructor(private file: string, private onUsage: (u: ClaudeUsage) => void) {}
  check(): void {
    let mtime: number;
    let u: ClaudeUsage | null;
    try {
      mtime = fs.statSync(this.file).mtimeMs;
      if (mtime === this.lastMtime) return;
      u = parseUsageCache(fs.readFileSync(this.file, "utf8"));
    } catch {
      return; // missing/unreadable/malformed: stay silent
    }
    if (!u) return;
    this.onUsage(u); // may throw: propagate, mtime not recorded so the next tick retries
    this.lastMtime = mtime;
  }
}
