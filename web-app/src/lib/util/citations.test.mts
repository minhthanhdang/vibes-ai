import { test } from "node:test";
import assert from "node:assert/strict";

import { citationsIn, localDocNames, resolves, sectionIds, type Citation } from "@/lib/util/citations";
import { docFiles, readSource, sourceFiles } from "@/server/google/source-tree";

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

/// The colocated docs — the half of the design record that is in git. Everything
/// below is about keeping their pool and `context/`'s visibly apart, and about
/// the one question `npm run cites` structurally cannot ask.

/// Composed rather than written, so the last case in this file — which scans the
/// tree for real references — does not read these fixtures as citations of a
/// section that was never meant to exist.
const MARK = String.fromCharCode(0xa7);

test("a colocated doc is a doc name, and says so", () => {
  const named = citationsIn(`Conversation.md ${MARK}IV, Windows ${MARK}II, Tools.md ${MARK}VII, Metering ${MARK}V`);
  assert.deepEqual(
    named.map((c) => [c.doc, c.local]),
    [
      ["Conversation.md", true],
      ["Windows.md", true],
      ["Tools.md", true],
      ["Metering.md", true],
    ],
  );
});

test("a colocated name is not a `context/` doc name", () => {
  /// The two pools are separate tables so that a reader can see they are
  /// separate. If a colocated name ever leaked into `DOC_OF`, `Tools.md III`
  /// would start being looked for in `context/`, where there is no such file,
  /// and every one of them would report as dangling at once.
  for (const citation of citationsIn(`Conversation ${MARK}I`)) {
    assert.equal(citation.local, true);
  }
  for (const citation of citationsIn(`tech-spec ${MARK}III`)) {
    assert.equal(citation.local, undefined);
  }
});

const LOCAL = new Map<string, Set<string>>([["Conversation.md", new Set(["V", "IV.2"])]]);

test("a bare mark does not resolve against a doc beside the code", () => {
  /// The widening this arrangement exists to refuse. A bare `V` is written
  /// hundreds of times in this tree meaning a `context/` spec; a colocated doc
  /// numbered from I again, admitted to the bare pool, answers for every one of
  /// them and `npm run cites` goes on reporting success having stopped asking.
  assert.ok(!resolves({ line: 1, id: "V" }, DOCS, LOCAL));
  assert.ok(!resolves({ line: 1, id: "IV.2" }, new Map(), LOCAL));
  /// And the same mark named is fine, which is what makes the refusal a
  /// narrowing rather than a hole.
  assert.ok(resolves({ line: 1, id: "V", doc: "Conversation.md", local: true }, DOCS, LOCAL));
});

test("a colocated citation is looked for beside the code and nowhere else", () => {
  /// Not in `context/`: a `Conversation.md` there would be a different file, and
  /// answering from it is the collision the checker exits on.
  const shadowed = new Map<string, Set<string>>([["Conversation.md", new Set(["IX"])]]);
  assert.ok(!resolves({ line: 1, id: "IX", doc: "Conversation.md", local: true }, shadowed, LOCAL));
  assert.ok(!resolves({ line: 1, id: "V", doc: "Conversation.md", local: true }, DOCS, undefined));
});

test("the colocated names are the four docs and their bare spellings", () => {
  assert.deepEqual(localDocNames().sort(), ["Conversation.md", "Metering.md", "Tools.md", "Windows.md"]);
  for (const bare of ["Conversation", "Windows", "Tools", "Metering"]) {
    assert.equal(citationsIn(`${bare} ${MARK}I`).at(0)?.doc, `${bare}.md`);
  }
});

/// The check that could not exist before. `cites.mts` records why resolution is
/// a script and not a test: `context/` is gitignored, so a suite reading it
/// fails on a fresh clone. The colocated docs are in git — so every reference to
/// one of them can be resolved against the actual file on disk, here, on every
/// clone, which is the only durable guard the design record has.
test("every colocated reference in the tree resolves against the doc on disk", async () => {
  const paths = await docFiles("src");
  const local = new Map<string, Set<string>>();
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (localDocNames().includes(name)) local.set(name, sectionIds(await readSource(path)));
  }

  const dangling: string[] = [];
  let checked = 0;
  for (const path of [...(await sourceFiles("src", "scripts")), ...paths]) {
    for (const citation of citationsIn(await readSource(path))) {
      if (!citation.local) continue;
      checked += 1;
      if (resolves(citation, new Map(), local)) continue;
      dangling.push(`${path}:${citation.line}  ${citation.doc} ${MARK}${citation.id}`);
    }
  }
  assert.deepEqual(dangling, []);
  assert.equal(checked > 0, local.size > 0, "a doc exists that nothing cites, or a citation with no doc");
});
