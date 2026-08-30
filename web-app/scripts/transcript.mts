import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { config } from "dotenv";

import {
  summaryLine,
  transcriptRecords,
  transcriptSummary,
} from "../src/lib/agent/shared/transcript";

config({ path: ".env.local" });
config({ path: ".env" });

const raw = process.env.AGENT_TRANSCRIPT_DIR;
const directory = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;

if (!directory) {
  console.log(
    "AGENT_TRANSCRIPT_DIR is unset, so nothing has been recorded.\n" +
      'Set it in .env.local (.design-log is the suggested value), chat, and run this again.',
  );
  process.exit(0);
}

const LISTED = 20;

const stems = (await readdir(directory).catch(() => [] as string[]))
  .filter((name) => name.endsWith(".jsonl"))
  .map((name) => name.slice(0, -".jsonl".length))
  .sort()
  .reverse();

if (!stems.length) {
  console.log(`no transcripts in ${directory} yet — chat with the variable set and run this again`);
  process.exit(0);
}

const asked = process.argv[2];

async function print(stem: string) {
  const markdown = await readFile(join(directory!, `${stem}.md`), "utf8").catch(() => undefined);
  if (markdown === undefined) {
    console.error(`no ${stem}.md in ${directory} — the turn recorded no model call`);
    process.exit(1);
  }
  console.log(`# ${stem}\n`);
  console.log(markdown);
}

if (asked === "--last") {
  await print(stems[0]!);
} else if (asked) {
  const wanted = asked.replace(/\.(jsonl|md)$/, "");
  const found = stems.find((stem) => stem === wanted || stem.startsWith(wanted));
  if (!found) {
    console.error(`no transcript in ${directory} matching ${wanted}`);
    process.exit(1);
  }
  await print(found);
} else {
  const listed = stems.slice(0, LISTED);
  console.log(`${stems.length} turn${stems.length === 1 ? "" : "s"} in ${directory}`);
  for (const stem of listed) {
    const jsonl = await readFile(join(directory, `${stem}.jsonl`), "utf8").catch(() => "");
    console.log(`  ${summaryLine(transcriptSummary(stem, transcriptRecords(jsonl)))}`);
  }
  console.log(
    `\nnpm run transcript -- --last, or -- <stem>, prints one whole; ` +
      `${join(directory, "<stem>.md")} is the same thing in an editor`,
  );
}
