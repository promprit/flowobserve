import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MsgZ } from "@fo/shared";
import { replayGolden } from "./golden";

const DIR = path.resolve(__dirname, "../../fixtures/golden");
const days = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".jsonl")).sort() : [];
const UPDATE = process.env.GOLDEN_UPDATE === "1";

describe("golden replay", () => {
  it("has at least one fixture", () => expect(days.length).toBeGreaterThan(0));
  for (const f of days) {
    it(f, () => {
      const got = replayGolden(fs.readFileSync(path.join(DIR, f), "utf8"));
      MsgZ.parse(got.snapshot);
      const file = path.join(DIR, f.replace(/\.jsonl$/, ".expected.json"));
      if (UPDATE) {
        fs.writeFileSync(file, JSON.stringify(got, null, 2) + "\n");
        console.log(`# ${f}  counts ${JSON.stringify(got.counts)}`);
        for (const s of got.snapshot.sessions)
          console.log(`  ${s.name}  stage ${s.stage}  ${s.status}  ${s.tasksDone}/${s.tasksTotal}  [${s.builders.join(",")}]  ${s.msg}`);
        return;
      }
      expect(got).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
    });
  }
});
