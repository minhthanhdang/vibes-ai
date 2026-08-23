import { test } from "node:test";
import assert from "node:assert/strict";

import { citationsIn, resolves, sectionIds, type Citation } from "@/lib/util/citations";

/// `npm run cites` is the only thing holding the migration's "do not renumber
/// any section" constraint, and until these cases it held nothing: twelve of
/// fourteen mutations planted in it left the script reporting `every one
/// resolves`. Two of the twelve changed how many citations it looked at at all —
/// scanning only `.mts` took 423 down to 144 and the report did not change a
/// word. A checker that cannot fail is a checker that is not checking, so the
/// two parsers it answers from are pinned here.

/// A doc as `sectionIds` reads it, written the way `context/` writes them.
const DOC = `# Title

Prose before anything is numbered.

## VII. Model Access

Some prose.

### 4. The cropper

### 5.1 The picture

## XIII. Invariants

1. The first invariant.
2. The second.
`;

test("a `##` roman heading is a section, and defines its own id", () => {
  const ids = sectionIds(DOC);
  assert.ok(ids.has("VII"));
  assert.ok(ids.has("XIII"));
});

test("a numbered heading under a section is that section's sub-id", () => {
  const ids = sectionIds(DOC);
  assert.ok(ids.has("VII.4"));
  /// With the dot and without it, and more than one level deep — `tech-spec.md`
  /// writes both.
  assert.ok(ids.has("VII.5.1"));
});

test("only `##` opens a section", () => {
  /// A deeper heading that happens to be roman is a heading inside whatever
  /// section it sits in, not a new one — and nothing may cite it as `§III`.
  const ids = sectionIds("## VII. Model Access\n\n### III. Not a section\n");
  assert.ok(ids.has("VII"));
  assert.ok(!ids.has("III"));
});

test("a `##` heading that numbers itself is not a sub-id", () => {
  /// The sub-id rule reads `###` and `####` only. A `##` line is either a
  /// section or nothing, and reading it as a sub-id would invent `§V.3` out of
  /// a heading no one can cite.
  const ids = sectionIds("## V. Rules\n\n## 3. Not a section heading\n");
  assert.ok(ids.has("V"));
  assert.ok(!ids.has("V.3"));
});

test("a section's list items are ids only where it has no headings", () => {
  const ids = sectionIds(DOC);
  /// §XIII is a list and nothing else, so `§XIII.2` is a citation that resolves.
  assert.ok(ids.has("XIII.1"));
  assert.ok(ids.has("XIII.2"));
  /// §VII is headed, so its `1.`/`2.` steps belong to whichever heading they sit
  /// under. Counting them would answer for `§VII.1` whether or not a heading of
  /// that name still exists — the one question this file is here to ask.
  const headed = sectionIds("## VII. Model Access\n\n### 4. The cropper\n\n1. First step.\n2. Second step.\n");
  assert.ok(headed.has("VII.4"));
  assert.ok(!headed.has("VII.1"));
});

test("the last section's list items are read", () => {
  /// Nothing closes the final section but the end of the file, and `§XIII.2` is
  /// in the last one here.
  const ids = sectionIds(DOC);
  assert.ok(ids.has("XIII.2"));
  assert.ok(DOC.trimEnd().endsWith("2. The second."), "the fixture's last section must be a list");
});

test("a numbered line before any section is not an id", () => {
  const ids = sectionIds("1. A numbered line in the preamble.\n\n## I. First\n");
  assert.deepEqual([...ids], ["I"]);
});

test("a citation carries the line it was written on", () => {
  const [first, second] = citationsIn("no citation here\n/// see §X for why\n/// and §XIII.2\n");
  assert.deepEqual(first, { line: 2, id: "X" });
  assert.deepEqual(second, { line: 3, id: "XIII.2" });
});

test("a citation resolves to its full depth", () => {
  /// `§V.5.1` is not `§V.5`, and a citation read one level deep would resolve
  /// against a section that still exists while the one cited is gone.
  assert.deepEqual(citationsIn("/// tech-spec §V.5.1").at(0)?.id, "V.5.1");
});

test("the section mark may be written with or without a space", () => {
  assert.deepEqual(
    citationsIn("/// §X and § XI").map((c) => c.id),
    ["X", "XI"],
  );
});

test("a known doc name in front of the mark says where to look", () => {
  const named = citationsIn("/// infra §X, infra.md §X, tech-spec §III, tech-spec.md §III, canvas §XIII, moodboard §II");
  assert.deepEqual(
    named.map((c) => c.doc),
    ["infra.md", "infra.md", "tech-spec.md", "tech-spec.md", "canvas.md", "moodboard.md"],
  );
});

test("the two docs written since the checker was are doc names too", () => {
  /// A hyphenated name is the case that would quietly fail: the prefix group
  /// has to take the whole of `orchestrator-tool-reference`, not the last word
  /// of it. Without these two, `orchestrator-tool-reference §VII` resolved as a
  /// bare mark against whichever of twelve docs happened to have a §VII — which
  /// is the widening this file exists to catch.
  const named = citationsIn(
    "/// compositor-v2 §IX, compositor-v2.md §IX.2, orchestrator-tool-reference §VII.9",
  );
  assert.deepEqual(
    named.map((c) => c.doc),
    ["compositor-v2.md", "compositor-v2.md", "orchestrator-tool-reference.md"],
  );
});

test("an ordinary word in front of the mark is not a doc name", () => {
  /// `see §X` and `(§X)` are how most citations are written, and holding them
  /// to a doc called `see` would report every one of them as dangling.
  assert.deepEqual(citationsIn("/// see §X").at(0)?.doc, undefined);
});

const DOCS = new Map<string, Set<string>>([
  ["infra.md", new Set(["X", "XVI"])],
  ["tech-spec.md", new Set(["III", "VIII.2"])],
]);

test("a bare citation may resolve in any doc", () => {
  assert.ok(resolves({ line: 1, id: "XVI" }, DOCS));
  assert.ok(resolves({ line: 1, id: "VIII.2" }, DOCS));
});

test("a citation naming a doc has to resolve in that doc", () => {
  /// `infra §III` is wrong even though some doc has a §III — the reader is
  /// being sent to `infra.md`, where there is nothing of that name.
  const misdirected: Citation = { line: 1, id: "III", doc: "infra.md" };
  assert.ok(!resolves(misdirected, DOCS));
  assert.ok(resolves({ ...misdirected, doc: "tech-spec.md" }, DOCS));
});

test("a sub-id is not answered for by its section", () => {
  /// `§III.4` is exactly the citation that went dangling when the rebuild
  /// swallowed its heading while `§III` itself survived.
  assert.ok(!resolves({ line: 1, id: "III.4", doc: "tech-spec.md" }, DOCS));
});

test("a citation naming a doc that was not read does not resolve", () => {
  assert.ok(!resolves({ line: 1, id: "X", doc: "canvas.md" }, DOCS));
});
