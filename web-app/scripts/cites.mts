/// Every `§` a comment cites, resolved against the docs in `context/`.
/// `npm run cites`.
///
/// The house style cites a spec section by number — `tech-spec §III.4`,
/// `infra.md §X`, `§V.5` — and those numbers are the one part of a doc that
/// cannot be kept honest by reading it: a section renumbered or lost takes 274
/// call sites with it silently. It happened. `tech-spec.md` was destroyed and
/// rebuilt from transcripts, and the rebuild swallowed `§III.4`'s heading; the
/// fourteen comments citing it pointed at nothing for a day, and nothing said
/// so.
///
/// This cannot be a test case: `context/` is gitignored on purpose, so a suite
/// that read it would fail on a fresh clone. It is a script for that reason —
/// no docs, nothing to check, and that is not a failure.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DOCS = "../context";
const SOURCE = "src";

/// Generated code is not authored code, and cannot carry a citation a person
/// could fix.
const SKIP = new Set(["generated", "node_modules"]);

/// What a doc defines, as ids a comment could write. `## VII.` is a section and
/// `### 4.` under it is `VII.4`. A numbered *list item* is one too — `canvas.md`
/// §XIII's invariants and `moodboard.md` §II's steps are cited by number and
/// neither is a heading — but only where the section is a list and nothing else:
/// `tech-spec.md` §III's cropper steps are numbered 1–4 inside §III.3, and
/// counting those as §III.1–§III.4 would answer for the headings of that name
/// whether or not they still exist, which is the one question this script is
/// here to ask.
function idsOf(text: string): Set<string> {
  const ids = new Set<string>();
  let section = "";
  let headed = false;
  let listed: string[] = [];
  const close = () => {
    if (!headed) for (const id of listed) ids.add(id);
    headed = false;
    listed = [];
  };
  for (const line of text.split("\n")) {
    const top = /^##\s+([IVXLC]+)[.)]\s/.exec(line);
    if (top) {
      close();
      section = top[1]!;
      ids.add(section);
      continue;
    }
    if (!section) continue;
    /// A heading numbers itself with or without the dot — `### 4. Cropper` and
    /// `#### 5.1 The picture` are both in `tech-spec.md` — while a list item
    /// always carries one, which is what keeps an ordinary sentence starting
    /// with a number out of either list.
    const heading = /^#{3,4}\s+(\d+(?:\.\d+)*)[.)]?\s/.exec(line);
    if (heading) {
      headed = true;
      ids.add(`${section}.${heading[1]}`);
      continue;
    }
    const item = /^(\d+(?:\.\d+)*)[.)]\s/.exec(line);
    if (item) listed.push(`${section}.${item[1]}`);
  }
  close();
  return ids;
}

/// A citation naming a doc has to resolve in *that* doc; a bare `§X` may
/// resolve anywhere. Bare ones are genuinely ambiguous — `§II.8` in
/// `moodboard-caption.ts` is `moodboard.md`'s and reads perfectly in context —
/// so holding them to one doc would report agreement as a fault.
const DOC_OF: Record<string, string> = {
  "tech-spec": "tech-spec.md",
  "tech-spec.md": "tech-spec.md",
  infra: "infra.md",
  "infra.md": "infra.md",
  canvas: "canvas.md",
  "canvas.md": "canvas.md",
  moodboard: "moodboard.md",
  "moodboard.md": "moodboard.md",
};

const CITATION = /(?:([\w.-]+)\s+)?§\s?([IVXLC]+(?:\.\d+)*)/g;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(mts|ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

let docs: Map<string, Set<string>>;
try {
  docs = new Map(
    readdirSync(DOCS)
      .filter((name) => name.endsWith(".md"))
      .map((name) => [name, idsOf(readFileSync(join(DOCS, name), "utf8"))]),
  );
} catch {
  console.log(`no ${DOCS} on this checkout — nothing to resolve against`);
  process.exit(0);
}

const dangling: string[] = [];
let cited = 0;

for (const path of walk(SOURCE)) {
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const [, prefix, id] of line.matchAll(CITATION)) {
      cited += 1;
      const named = prefix ? DOC_OF[prefix] : undefined;
      const where = named ? [named] : [...docs.keys()];
      if (where.some((doc) => docs.get(doc)?.has(id!))) continue;
      dangling.push(`${path}:${index + 1}  §${id}${named ? ` (${named})` : ""}`);
    }
  });
}

console.log(`${cited} citations across ${docs.size} docs`);
for (const line of dangling) console.log(`  unresolved  ${line}`);
if (dangling.length) {
  console.log(`\n${dangling.length} unresolved — the section was renumbered, lost, or never written`);
  process.exit(1);
}
console.log("every one resolves");
