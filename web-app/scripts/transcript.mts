/// The other half of the transcripts. `npm run transcript` lists the last
/// twenty turns, one line each; `npm run transcript -- --last` prints the most
/// recent; `npm run transcript -- <stem>` prints one.
///
/// The `.md` beside each `.jsonl` is what you actually read — it is written as
/// the turn happens and this script does not reformat a byte of it. What is
/// missing without this is the step before: which of the ninety files in the
/// directory is the turn that went wrong. So the listing is a line per turn —
/// when, how many rounds, what it cost, which agents were in it, and the
/// sentence the user opened with, which is the only field a human recognises a
/// turn by.
///
/// Modelled on `design-runs.mts`, which is already the shape of a "what did the
/// last N runs do" reader — with the one difference that this reads files
/// rather than rows, and so needs neither a database nor a credential.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { config } from "dotenv";

import {
  summaryLine,
  transcriptRecords,
  transcriptSummary,
} from "../src/lib/agent/shared/transcript";

/// The same two files, in the same order, as the other scripts: Next reads
/// `.env.local` and nothing outside it does on its own.
config({ path: ".env.local" });
config({ path: ".env" });

/// `process.env` rather than `env()`, deliberately: reading a transcript that is
/// already on disk should not need a database url or a Vertex credential to be
/// present. Blank counts as unset, which is `src/env.ts`'s rule for this key.
const raw = process.env.AGENT_TRANSCRIPT_DIR;
const directory = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;

if (!directory) {
  console.log(
    "AGENT_TRANSCRIPT_DIR is unset, so nothing has been recorded.\n" +
      'Set it in .env.local (.transcripts is the suggested value), chat, and run this again.',
  );
  process.exit(0);
}

const LISTED = 20;

/// Newest first. A stem opens with the ISO time, so sorting the names is
/// sorting the turns — no `stat` per file.
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

/// One turn, as it was written. The markdown is printed whole and unedited;
/// the JSONL beside it is for the suite, not for a reader.
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
