/// Every `§` a comment cites, resolved against the docs in `context/`.
/// `npm run cites`.
///
/// Why the numbers need a checker at all, and what counts as a section, are in
/// `src/lib/util/citations.ts` — this is the part that reads the checkout: the
/// docs on disk, the files that cite them, and the report.
///
/// The resolving cannot be a test case *for `context/`*: it is gitignored on
/// purpose, so a suite that read it would fail on a fresh clone. It is a script
/// for that reason — no docs, nothing to check, and that is not a failure. The
/// two parsers underneath it are tested, because a widening there leaves this
/// script reporting success having stopped asking the question.
///
/// The colocated docs under `src/` are the half of the record that *is* in git,
/// so they are checked here and again in `citations.test.mts`, which is the
/// check that still runs on a clone with no `context/` at all.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { citationsIn, localDocNames, resolves, sectionIds } from "../src/lib/util/citations";
import { docFiles, readSource, sourceFiles } from "../src/server/google/source-tree";

const DOCS = "../context";

let docs: Map<string, Set<string>>;
try {
  docs = new Map(
    readdirSync(DOCS)
      .filter((name) => name.endsWith(".md"))
      .map((name) => [name, sectionIds(readFileSync(join(DOCS, name), "utf8"))]),
  );
} catch {
  console.log(`no ${DOCS} on this checkout — nothing to resolve against`);
  process.exit(0);
}

/// The same walk the source-text rules in the suite are asked through, rather
/// than a second one written here: it skips the generated client (not authored,
/// so not fixable by a person) and it is the one with the tests on it. `scripts`
/// is walked because scripts cite sections too — `floor.mts` §VI and
/// `db-tunnel.mts` §VIII.2 went unchecked for as long as this walked `src`
/// alone.
const dangling: string[] = [];
let cited = 0;

/// The docs that sit beside the code they document. Keyed by basename, as
/// `context/` is — so a colocated doc taking a name `context/` already uses
/// would answer for that doc's sections and the loser would never be read.
const localPaths = await docFiles("src");
const local = new Map<string, Set<string>>();
for (const path of localPaths) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!localDocNames().includes(name)) continue;
  if (docs.has(name)) {
    console.log(`two docs named ${name} — ${path} and ${DOCS}/${name}`);
    process.exit(1);
  }
  local.set(name, sectionIds(await readSource(path)));
}

/// The colocated docs are scanned as well as read: they cite `context/` specs,
/// and until they were walked nothing checked a `§` written inside markdown.
for (const path of [...(await sourceFiles("src", "scripts")), ...localPaths]) {
  for (const citation of citationsIn(await readSource(path))) {
    cited += 1;
    if (resolves(citation, docs, local)) continue;
    const named = citation.doc ? ` (${citation.doc})` : "";
    dangling.push(`${path}:${citation.line}  §${citation.id}${named}`);
  }
}

console.log(`${cited} citations across ${docs.size} docs and ${local.size} beside the code`);
for (const line of dangling) console.log(`  unresolved  ${line}`);
if (dangling.length) {
  console.log(`\n${dangling.length} unresolved — the section was renumbered, lost, or never written`);
  process.exit(1);
}
console.log("every one resolves");
