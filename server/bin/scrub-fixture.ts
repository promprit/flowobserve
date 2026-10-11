// Usage: pnpm --filter @fo/server scrub <in.jsonl> <out.jsonl> [--map FROM=TO]...
// Rewrites a recorded spool so it is safe to commit (see src/scrub.ts).
import fs from "node:fs";
import { Scrubber } from "../src/scrub";

const args = process.argv.slice(2);
const maps: Array<[string, string]> = [];
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--map") {
    const m = args[++i] ?? "", at = m.indexOf("=");
    if (at <= 0) { console.error(`bad --map ${m}: want FROM=TO`); process.exit(2); }
    maps.push([m.slice(0, at), m.slice(at + 1)]);
  } else files.push(args[i]);
}
if (files.length !== 2) { console.error("usage: scrub-fixture <in.jsonl> <out.jsonl> [--map FROM=TO]..."); process.exit(2); }
const s = new Scrubber({ maps });
const text = fs.readFileSync(files[0], "utf8");
const cut = text.lastIndexOf("\n") + 1; // after the last "\n" is a half-written line; replay skips it
const out = text.slice(0, cut).split("\n").filter(Boolean).map((l) => s.line(l));
fs.writeFileSync(files[1], out.join("\n") + "\n" + (cut < text.length ? '{"v":1,"ts":' : ""));
console.log(`scrubbed ${out.length} lines -> ${files[1]}`);
