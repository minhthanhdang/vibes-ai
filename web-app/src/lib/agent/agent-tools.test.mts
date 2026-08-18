import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADD_PAGE,
  CANVAS_PUT_LIMIT,
  CANVAS_REMOVE_LIMIT,
  CANVAS_REORDER_LIMIT,
  CANVAS_TRANSFORM_LIMIT,
  CATALOG_LIMIT,
  COMPOSE_MOODBOARD,
  DISCARD_BOARD,
  DISCARD_PAGE,
  DISCARD_REFERENCE,
  DUPLICATE_BOARD,
  DUPLICATE_PAGE,
  GENERATE_CALL_LIMIT,
  GENERATE_IMAGE,
  generateImageFor,
  generationCeilingSaid,
  INSPECT_BOARD,
  RESIZE_PAGE,
  CROP_REFERENCE,
  LIST_REFERENCES,
  MOVE_LIMIT,
  MOVE_TO_PAGE,
  PUT_ON_CANVAS,
  READ_CANVAS,
  READ_LIMIT,
  READ_REFERENCES,
  REMOVE_FROM_CANVAS,
  REORDER_ON_CANVAS,
  SHOWN_LIMIT,
  SHOW_REFERENCES,
  REWORD_ON_BOARD,
  SWAP_ON_BOARD,
  TRANSFORM_ON_CANVAS,
  aspectLabel,
  attachmentKey,
  attachmentOf,
  attachmentTarget,
  BOARD_LINE_CHARS,
  boardAttachmentOf,
  boardsBrief,
  BOARDS_BRIEF_LIMIT,
  catalogBrief,
  cropAttachmentOf,
  DIRECTOR_BRIEF_LIMIT,
  directorBrief,
  digestTags,
  drawnFrom,
  mergedAttachments,
  orchestratorTools,
  pickReferences,
  referenceCatalog,
  referenceDigest,
  referenceProperties,
  unreadReason,
  type ToolReference,
} from "@/lib/agent/agent-tools";
import { LAYOUT_REQUESTS, LAYOUTS_WITH_TEXT } from "@/lib/layout/moodboard-layouts";
import { CROP_ASPECT_IDS, LOOSE_SHAPE_IDS } from "@/lib/references/reference-version";
import type { CropOffer } from "@/lib/crop/crop-offer";

function reference(overrides: Partial<ToolReference> = {}): ToolReference {
  return {
    id: "ref-1",
    title: "Hallway",
    width: 1920,
    height: 1080,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
    ...overrides,
  };
}

test("a photograph's shape is said by the name a user uses for it", () => {
  assert.equal(aspectLabel(1920, 1080), "16:9");
  assert.equal(aspectLabel(2048, 2048), "1:1");
  assert.equal(aspectLabel(1080, 1920), "9:16");
});

test("a shape nobody has a name for is said as its own ratio", () => {
  assert.equal(aspectLabel(5568, 3712), "1.50:1");
});

test("a row with no recorded pixels has no shape rather than a made-up one", () => {
  assert.equal(aspectLabel(null, null), "unknown");
  assert.equal(aspectLabel(1920, 0), "unknown");
});

test("the digest carries the id, the shape and the tags and nothing else", () => {
  const digest = referenceDigest(
    reference({
      analysis: { lighting: ["low-key"], subject: ["interior"], colorPalette: ["#112233"] },
    }),
  );

  assert.deepEqual(digest, {
    id: "ref-1",
    title: "Hallway",
    shape: "16:9",
    tags: ["Low key", "Interior"],
  });
});

test("the palette stays out of the digest — hex codes are tokens a model cannot see", () => {
  assert.equal(digestTags({ colorPalette: ["#112233", "#445566"] }), undefined);
});

/// The argument above is about a list of every picture. It does not hold for the
/// one picture the user is asking about, and `read_references` is the door
/// that asks about one — so the two fields no digest carries are carried here.
test("the properties answer carries the palette and the rationale the digest drops", () => {
  const properties = referenceProperties(
    reference({
      analysis: {
        title: "Lit corridor",
        colorPalette: ["#112233"],
        lighting: ["low-key"],
        subject: ["interior"],
        rationale: "  Sodium light held against a cold wall.  ",
      },
    }),
  );

  assert.deepEqual(properties?.palette, ["#112233"]);
  assert.equal(properties?.rationale, "Sodium light held against a cold wall.");
  /// Per dimension, and every dimension said even when it is empty: a missing key
  /// and an empty list are the same nothing, and only one of them means the
  /// analyzer found nothing there.
  assert.deepEqual(properties?.lighting, ["Low key"]);
  assert.deepEqual(properties?.texture, []);
  assert.equal(properties?.title, "Lit corridor");
  /// Not the flattened list beside them — the same words twice, under a name that
  /// means something else on a catalog line.
  assert.equal("tags" in properties!, false);
});

/// Every field would come back empty, and an empty palette beside an empty
/// rationale reads as a picture with no colour in it. So the caller excludes it
/// rather than describing it — null is what makes that a compile-time filter.
test("a picture nobody has read has no properties answer at all", () => {
  assert.equal(referenceProperties(reference({ analysis: null, unread: "never" })), null);
  assert.equal(referenceProperties(reference()), null);
  /// An analysis row that exists and holds nothing is a different fact: it was
  /// read, and the answer says so by being there.
  assert.deepEqual(referenceProperties(reference({ analysis: {} }))?.palette, []);
});

/// The conversation the model is handed carries no tool calls, so a picture it
/// drew an hour ago is a title and a mark to it — the description behind it is
/// gone unless a door hands it back.
test("a drawn picture's own description is what the column answers with", () => {
  const drawn = reference({
    origin: "GENERATED",
    generationPrompt: "  Warm grey paper texture, lit flat, no grain  ",
  });
  assert.equal(drawnFrom(drawn), "Warm grey paper texture, lit flat, no grain");
  assert.equal(drawnFrom(reference()), undefined);
  /// A cut of a drawing inherits the provenance and not the sentence, so it is
  /// marked as drawn with nothing to quote — a blank must read as no answer
  /// rather than as an empty one.
  assert.equal(drawnFrom(reference({ origin: "GENERATED" })), undefined);
  assert.equal(drawnFrom(reference({ generationPrompt: "   " })), undefined);
});

test("the properties answer keeps the drawn mark and quotes what was asked for", () => {
  const properties = referenceProperties(
    reference({
      origin: "GENERATED",
      generationPrompt: "Dusk gradient over water",
      analysis: { rationale: "A soft horizon.", colorPalette: ["#334455"] },
    }),
  );

  assert.equal(properties?.made, true);
  assert.equal(properties?.drawnFrom, "Dusk gradient over water");
  /// Beside the reading rather than instead of it: one is the ask, the other is
  /// what a reader found in what came back.
  assert.equal(properties?.rationale, "A soft horizon.");

  const shot = referenceProperties(reference({ analysis: { rationale: "Shot at dusk." } }));
  assert.equal("made" in shot!, false);
  assert.equal("drawnFrom" in shot!, false);
});

test("a cut says which frame it came out of and what it keeps", () => {
  const digest = referenceDigest(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(digest.croppedFrom, "ref-1");
  assert.equal(digest.keeps, "the doorway");
});

test("an untitled reference is still named — a blank row is unpointable", () => {
  assert.equal(referenceDigest(reference({ title: "   " })).title, "Untitled");
});

test("agent 2's name for a picture wins over the filename the browser sent", () => {
  const digest = referenceDigest(
    reference({ title: "DSC_0431.jpg", analysis: { title: "  Man alone in a lit corridor  " } }),
  );

  assert.equal(digest.title, "Man alone in a lit corridor");
});

test("a picture nobody has read keeps the name it was uploaded under", () => {
  assert.equal(referenceDigest(reference({ title: "Hallway", analysis: null })).title, "Hallway");
  assert.equal(
    referenceDigest(reference({ title: "Hallway", analysis: { title: "  " } })).title,
    "Hallway",
  );
  assert.equal(referenceDigest(reference({ title: " ", analysis: {} })).title, "Untitled");
});

test("the catalog says how many did not fit, so a truncated list is not read as the whole gallery", () => {
  const references = Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const catalog = referenceCatalog(references);

  assert.equal(catalog.total, CATALOG_LIMIT + 5);
  assert.equal(catalog.shown, CATALOG_LIMIT);
  assert.equal(catalog.references.length, CATALOG_LIMIT);
});

test("a catalog that fits reports no truncation", () => {
  const catalog = referenceCatalog([reference(), reference({ id: "ref-2" })]);
  assert.equal(catalog.total, 2);
  assert.equal(catalog.shown, 2);
});

/// The user's own words are the one thing in a turn nothing derived, and
/// they were the one thing the model was never given.
test("the project's brief is primed in the user's own words, with what to do about it", () => {
  const primed = directorBrief({ title: "Cold open", brief: "  Night exteriors,\n  sodium light.  " });

  assert.match(primed, /This project is called “Cold open”\./);
  assert.match(primed, /Night exteriors, sodium light\./);
  assert.match(primed, /What they say in this conversation wins/);
  /// It has no door of its own, so a model that thinks it can set it will report
  /// having set it.
  assert.match(primed, /You cannot write or change the brief/);
});

/// A project with no brief and a project whose brief was withheld are the same
/// silence, and only one of them should have the model asking what the work is.
test("a project with no brief says so rather than saying nothing", () => {
  const primed = directorBrief({ title: "Untitled", brief: "" });

  assert.match(primed, /has not written a brief for it\.$/);
  /// The note is the expensive half, and it is about a value this project does
  /// not have.
  assert.equal(primed.includes("wins where the two disagree"), false);
  assert.equal(directorBrief({ title: "  ", brief: null }).includes("“Untitled project”"), true);
});

/// The column holds 5,000 characters and every one of them is paid on every
/// model call of every turn — but a brief cut in silence is the model answering
/// from half of what the user wrote.
test("a brief longer than the limit is cut on a word, and the cut is said out loud", () => {
  const long = "sodium ".repeat(400).trim();
  const primed = directorBrief({ title: "Cold open", brief: long });
  const body = primed.split("\n")[1];

  assert.ok(body.length <= DIRECTOR_BRIEF_LIMIT);
  assert.equal(body.endsWith("sodium"), true);
  assert.match(primed, new RegExp(`first ${body.length} characters of a longer brief`));
});

test("a brief that fits carries no truncation sentence", () => {
  assert.equal(
    directorBrief({ title: "Cold open", brief: "Night exteriors." }).includes("longer brief"),
    false,
  );
});

/// The brief is what a round used to cost. What it has to be is complete enough
/// that the model never needs the round back: every id, every shape, every tag,
/// and an honest count when it does not all fit.
test("the brief is one line per photograph, carrying what a tool answer carried", () => {
  const brief = catalogBrief([
    reference({ analysis: { lighting: ["golden_hour"], subject: ["portrait"] } }),
  ]);
  const [head, line] = brief.split("\n");

  assert.equal(head, "The project holds 1 photograph:");
  assert.equal(line, "ref-1 · Hallway · 16:9 · Golden_hour, Portrait");
});

test("the brief says the total when it could not carry it all", () => {
  const references = Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const brief = catalogBrief(references);

  assert.match(brief, new RegExp(`^The project holds ${CATALOG_LIMIT + 5} photographs\\. `));
  assert.equal(brief.split("\n").length, CATALOG_LIMIT + 1);
});

/// The one thing priming cannot carry, said as a count rather than as rows: it
/// is what tells the model whether list_references is worth a round, and a
/// project with no crops must never spend one finding out.
test("the brief counts the cuts it does not list, and stays quiet when there are none", () => {
  assert.match(catalogBrief([reference()], { crops: 3 }), /3 cuts have been made of them\./);
  assert.equal(catalogBrief([reference()], { crops: 0 }).includes("cut"), false);
});

test("an empty project is said plainly rather than as an empty list", () => {
  assert.match(catalogBrief([]), /^This project has no pictures in it yet/);
});

test("a photograph with no analysis and no shape is still a pointable line", () => {
  const brief = catalogBrief([reference({ width: null, height: null })]);
  assert.equal(brief.split("\n")[1], "ref-1 · Hallway · unknown");
});

/// The star is the one thing in a digest the user said themselves. Without
/// it the model is deciding "which of these matters" from tags a machine read,
/// while the answer is sitting in a column that already sorts the list it is
/// being shown.
test("a picture the user starred is marked, and an ordinary one carries nothing", () => {
  const [, starred] = catalogBrief([reference({ favorite: true })]).split("\n");
  assert.equal(starred, "ref-1 · Hallway · starred · 16:9");

  const [, plain] = catalogBrief([reference()]).split("\n");
  assert.equal(plain, "ref-1 · Hallway · 16:9");
  assert.equal(referenceDigest(reference({ favorite: false })).favorite, undefined);
});

/// The tool can put a picture in the gallery, so "the pictures of this project"
/// is no longer the same thing as "the pictures the user has". A line that does
/// not say which is which turns the instruction to prefer theirs into nothing.
test("a picture the assistant drew is marked, and its meaning is said once", () => {
  const [, drawn] = catalogBrief([reference({ origin: "GENERATED" })]).split("\n");
  assert.equal(drawn, "ref-1 · Hallway · generated · 16:9");

  const [, shot] = catalogBrief([reference({ origin: "UPLOADED" })]).split("\n");
  assert.equal(shot, "ref-1 · Hallway · 16:9");

  assert.equal(referenceDigest(reference({ origin: "IMPORTED" })).made, undefined);
  assert.equal(referenceDigest(reference()).made, undefined);

  const withOne = catalogBrief([reference({ origin: "GENERATED" }), reference({ id: "ref-2" })]);
  assert.match(withOne, /drawn by you earlier in this project/);
  assert.doesNotMatch(catalogBrief([reference({ id: "ref-2" })]), /drawn by you/);
});

/// What the mark means is the same on every project; what to do about it is not.
/// The note's second half prefers a photograph they brought, and a list with no
/// unmarked line on it has none — so it is chosen off the list rather than said
/// to every project holding a drawing.
test("the note prefers a photograph they brought only where the list has one", () => {
  const mixed = catalogBrief([reference({ origin: "GENERATED" }), reference({ id: "ref-2" })]);
  assert.match(mixed, /a photograph they brought is the better answer/);
  assert.doesNotMatch(mixed, /none to prefer instead/);

  const drawnOnly = catalogBrief([
    reference({ origin: "GENERATED" }),
    reference({ id: "ref-2", origin: "GENERATED" }),
  ]);
  assert.match(drawnOnly, /The pictures marked “generated” were drawn by you/);
  assert.doesNotMatch(drawnOnly, /the better answer wherever one fits/);
  assert.match(drawnOnly, /reach for one of them wherever it fits/);

  const one = catalogBrief([reference({ origin: "GENERATED" })]);
  assert.match(one, /The picture marked “generated” was drawn by you/);
  assert.match(one, /reach for it wherever it fits/);
});

/// Both marks on one line, in the order the line is read: what the user said
/// about it, then what it is, then its shape.
test("a drawn picture the user starred carries both marks", () => {
  const [, line] = catalogBrief([reference({ origin: "GENERATED", favorite: true })]).split("\n");
  assert.equal(line, "ref-1 · Hallway · starred · generated · 16:9");
});

test("what the star means is said once, and only to a project that has one", () => {
  const starred = catalogBrief([reference({ favorite: true }), reference({ id: "ref-2" })]);
  assert.match(starred, /the user starred in the gallery/);
  assert.match(starred, /cannot star or unstar/);

  assert.equal(catalogBrief([reference()]).includes("starred"), false);
});

/// The head was describing an order the gallery does not use: starred first,
/// then newest. A truncated list is exactly where that matters, because it is
/// the sentence saying which photographs are *not* on the list.
test("a truncated list is described by the order it was truncated in", () => {
  const many = (over: Partial<ToolReference> = {}) =>
    Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) => reference({ id: `ref-${index}`, ...over }));

  assert.match(catalogBrief(many()), /photographs\. 24 of them, newest first:/);
  assert.match(
    catalogBrief([reference({ favorite: true }), ...many().slice(1)]),
    /photographs\. 24 of them, starred first and then newest:/,
  );
});

/// The analyzer runs out of band, so the turn right after an upload is a turn
/// about photographs with no tags. Without a mark, that line is the same line a
/// picture agent 2 read and found nothing in produces — and a model reading it
/// answers "this one is plain" about a picture nobody has looked at.
test("a picture nobody has read yet says so, and one that was read says nothing", () => {
  const [, unreadLine] = catalogBrief([reference({ unread: "pending" })]).split("\n");
  assert.equal(unreadLine, "ref-1 · Hallway · 16:9 · not read yet");

  const [, readLine] = catalogBrief([reference()]).split("\n");
  assert.equal(readLine, "ref-1 · Hallway · 16:9");
});

test("each reason a picture is unread is said as its own next step", () => {
  const marks = (["pending", "failed", "never"] as const).map(
    (unread) => catalogBrief([reference({ unread })]).split("\n")[1],
  );
  assert.deepEqual(marks, [
    "ref-1 · Hallway · 16:9 · not read yet",
    "ref-1 · Hallway · 16:9 · could not be read",
    "ref-1 · Hallway · 16:9 · never read",
  ]);
});

/// Tags are the evidence the picture was read. A mark beside them would be the
/// line contradicting itself, and the toolset cannot know which to believe.
test("a picture that has tags is never marked unread", () => {
  const digest = referenceDigest(
    reference({ unread: "pending", analysis: { lighting: ["golden_hour"] } }),
  );
  assert.equal(digest.unread, undefined);
  assert.deepEqual(digest.tags, ["Golden_hour"]);
});

/// The marks are three or four tokens each; the sentence explaining them is the
/// expensive half, so a project agent 2 has finished with must not carry it.
test("the note under the list appears only when something is marked", () => {
  const marked = catalogBrief([reference({ unread: "pending" }), reference({ id: "ref-2" })]);
  assert.match(marked, /1 of these has not been read by the property analyzer/);
  assert.match(marked, /still being read and will have tags in a moment/);
  assert.match(marked, /can still be shown, cropped and put on a board/);

  const clean = catalogBrief([reference(), reference({ id: "ref-2" })]);
  assert.equal(clean.includes("property analyzer"), false);
  assert.equal(clean.split("\n").length, 3);
});

/// A failed run is not a run that will finish. Telling the model to wait for
/// tags that are never coming is the one way this mark can be worse than the
/// silence it replaces — so the two states get two different next steps, and
/// each is said only when the project is in it.
test("the note gives a waiting run and a stalled one different next steps", () => {
  const failed = catalogBrief([reference({ unread: "failed" })]);
  assert.match(failed, /1 of these has not been read/);
  assert.equal(failed.includes("in a moment"), false);
  assert.match(failed, /will not get tags on their own/);

  const pending = catalogBrief([reference({ unread: "pending" })]);
  assert.match(pending, /in a moment/);
  assert.equal(pending.includes("will not get tags on their own"), false);
});

/// The next step a stalled picture is given has to be one somebody can take, and
/// it must not be a call. `read_references` was that call for a while and no
/// longer files a reading at all, so the note names the user's own panel —
/// naming the tool would have the model spending a round finding out it cannot,
/// and telling the user it asked for something nobody was asked for.
test("a stalled picture is pointed at the panel that reads it, and never at a call", () => {
  const stalled = catalogBrief([reference({ unread: "never" })]);
  assert.match(stalled, /you have no way to ask for a reading/);
  assert.match(stalled, /from that picture's properties panel/);
  for (const brief of [
    stalled,
    catalogBrief([reference({ unread: "pending" })]),
    catalogBrief([reference()]),
  ]) {
    assert.equal(brief.includes("read_references"), false);
  }
});

test("a picture's unread reason is read off its latest analyzer run", () => {
  assert.equal(unreadReason({ status: "QUEUED" }), "pending");
  assert.equal(unreadReason({ status: "RUNNING" }), "pending");
  assert.equal(unreadReason({ status: "FAILED" }), "failed");
  assert.equal(unreadReason(null), "never");
  /// A succeeded run wrote an `Analysis` row, so a succeeded run beside no
  /// properties is a picture the model found nothing in — read, not unread.
  assert.equal(unreadReason({ status: "SUCCEEDED" }), null);
});

/// The boards are primed for the same reason the photographs are, and for one
/// more: there is no tool that lists them, so an id the brief does not carry is
/// a board the orchestrator cannot rebuild.
test("the brief names each board by the id a rebuild is asked for by", () => {
  const brief = boardsBrief([{ id: "board-1", title: "Act two", width: 1920, height: 1080 }]);
  const [head, line] = brief.split("\n");

  assert.equal(head, "The project holds 1 board:");
  assert.equal(line, "board-1 · Act two · 1920×1080");
});

/// The template rides on the line so the model can tell a change of shape from a
/// change of contents before it asks for either — and a board with none is one
/// the user dragged together, which is a fact about it rather than a gap.
test("a board's template is on its line when it has one", () => {
  const brief = boardsBrief([
    { id: "board-1", title: "Act two", width: 1920, height: 1080, layout: "HERO_LEFT" },
    { id: "board-2", title: "Scraps", width: 1920, height: 1080, layout: null },
  ]);
  const [, composed, dragged] = brief.split("\n");

  assert.equal(composed, "board-1 · Act two · 1920×1080 · HERO_LEFT");
  assert.equal(dragged, "board-2 · Scraps · 1920×1080");
});

/// Every page-scoped tool tells the model to pass a pageId "on a board of more
/// than one page". Until the line said so there was nothing in the whole prompt
/// that could answer which boards those are.
test("a board of more than one page says so on its line", () => {
  const brief = boardsBrief([
    { id: "board-1", title: "Act two", width: 1920, height: 1080, layout: "SPLIT", pages: 3 },
  ]);
  assert.equal(brief.split("\n")[1], "board-1 · Act two · 1920×1080 · SPLIT · 3 pages");
});

/// A board of one page *is* that page — its size is already on the line and
/// there is no id to choose between — so the segment is dropped rather than
/// written as "1 page", and every board in the app that has never been given a
/// second page keeps the line it always had.
test("a board of one page says nothing about pages", () => {
  const brief = boardsBrief([
    { id: "board-1", title: "Act two", width: 1920, height: 1080, pages: 1 },
    { id: "board-2", title: "Scraps", width: 1920, height: 1080, pages: 0 },
  ]);
  const [, one, none] = brief.split("\n");

  assert.equal(one, "board-1 · Act two · 1920×1080");
  assert.equal(none, "board-2 · Scraps · 1920×1080");
});

/// The names are what routes a sentence to a board: "put the stairwell on the
/// exteriors page" names no board and no id, and without them the model has to
/// read every spread in the project to find out which one the user meant.
test("a spread's line says what its pages are called", () => {
  const brief = boardsBrief([
    {
      id: "board-1",
      title: "Act two",
      width: 1920,
      height: 1080,
      layout: "SPLIT",
      pages: 3,
      pageNames: ["Act one", "Exteriors", ""],
    },
  ]);

  /// The unnamed one by its ordinal and unquoted: quoting "Page 3" would put a
  /// name on the page the canvas does not draw above it.
  assert.equal(
    brief.split("\n")[1],
    "board-1 · Act two · 1920×1080 · SPLIT · 3 pages: “Act one”, “Exteriors”, page 3",
  );
});

/// A row written before the names were stored carries none, and one whose names
/// disagree with its count would have the model choosing between pages that are
/// not the board's. Both degrade to the count alone, which is the line as it
/// stood before names reached the prompt.
test("a board whose names do not answer for its pages says only how many", () => {
  const brief = boardsBrief([
    { id: "board-1", title: "Act two", width: 1920, height: 1080, pages: 2, pageNames: [] },
    {
      id: "board-2",
      title: "Scraps",
      width: 1920,
      height: 1080,
      pages: 3,
      pageNames: ["Act one", "Exteriors"],
    },
  ]);
  const [, unwritten, stale] = brief.split("\n");

  assert.equal(unwritten, "board-1 · Act two · 1920×1080 · 2 pages");
  assert.equal(stale, "board-2 · Scraps · 1920×1080 · 3 pages");
});

/// A board built up all week is not a line any more. What is dropped is counted,
/// the same way the boards past the brief's own limit are.
test("a board of many pages names the first few and counts the rest", () => {
  const brief = boardsBrief([
    {
      id: "board-1",
      title: "Act two",
      width: 1920,
      height: 1080,
      pages: 8,
      pageNames: ["a", "b", "c", "d", "e", "f", "g", "h"],
    },
  ]);
  assert.equal(
    brief.split("\n")[1],
    "board-1 · Act two · 1920×1080 · 8 pages: “a”, “b”, “c”, “d”, “e”, “f”, +2 more",
  );
});

/// A board of one page keeps the line it always had: the page is the board, and
/// naming it would be the board's own line said twice.
test("a board of one page is not named page by page", () => {
  const brief = boardsBrief([
    { id: "board-1", title: "Act two", width: 1920, height: 1080, pages: 1, pageNames: ["Act one"] },
  ]);
  assert.equal(brief.split("\n")[1], "board-1 · Act two · 1920×1080");
});

test("a board nobody has named is still a pointable line", () => {
  const brief = boardsBrief([{ id: "board-1", title: "  ", width: 2048, height: 2048 }]);
  assert.equal(brief.split("\n")[1], "board-1 · Untitled board · 2048×2048");
});

test("the boards brief says the total when it could not carry it all", () => {
  const boards = Array.from({ length: BOARDS_BRIEF_LIMIT + 2 }, (_, index) => ({
    id: `board-${index}`,
    title: `Board ${index}`,
    width: 1920,
    height: 1080,
  }));
  const brief = boardsBrief(boards);

  assert.match(brief, new RegExp(`^The project holds ${BOARDS_BRIEF_LIMIT + 2} boards\\. `));
  assert.equal(brief.split("\n").length, BOARDS_BRIEF_LIMIT + 1);
});

/// A project with no boards says nothing at all rather than a line about
/// nothing: the brief is appended to every message of every turn, and the empty
/// case is the common one.
test("a project with no boards adds nothing to the brief", () => {
  assert.equal(boardsBrief([]), "");
});

test("an attachment of a photograph opens that photograph", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.deepEqual(target, { view: "gallery", inspectId: "ref-1" });
});

test("an attachment of a cut opens the frame it was cut from, at that cut", () => {
  const attachment = attachmentOf(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(attachment.caption, "Hallway — the doorway");
  assert.deepEqual(attachmentTarget(attachment), {
    view: "gallery",
    inspectId: "ref-1",
    versionId: "cut-1",
  });
});

test("a photograph is not sent to a version of itself", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.equal("versionId" in target, false);
});

test("an offer is not read as a cut that exists", () => {
  const target = attachmentTarget(cropAttachmentOf(reference(), offer()));
  assert.equal(target.view === "gallery" && target.versionId, undefined);
});

test("named references come back in the order they were named", () => {
  const references = [reference({ id: "a" }), reference({ id: "b" }), reference({ id: "c" })];
  const { found, missing } = pickReferences(references, ["c", "a"]);

  assert.deepEqual(
    found.map((entry) => entry.id),
    ["c", "a"],
  );
  assert.deepEqual(missing, []);
});

test("an id that answers to nothing is reported, not dropped", () => {
  const { found, missing } = pickReferences([reference({ id: "a" })], ["a", "ghost"]);
  assert.deepEqual(
    found.map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(missing, ["ghost"]);
});

test("a reference named twice in one call is shown once", () => {
  const { found } = pickReferences([reference({ id: "a" })], ["a", "a"]);
  assert.equal(found.length, 1);
});

test("a call naming more pictures than the chat has room for is cut to the limit, and says which", () => {
  const references = Array.from({ length: SHOWN_LIMIT + 3 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const { found, missing, overLimit } = pickReferences(
    references,
    references.map((entry) => entry.id),
  );
  assert.equal(found.length, SHOWN_LIMIT);
  /// The three that did not survive are real references, so they are not
  /// `missing` — and they were asked for, so they are not nothing either.
  assert.deepEqual(missing, []);
  assert.deepEqual(overLimit, [`ref-${SHOWN_LIMIT}`, `ref-${SHOWN_LIMIT + 1}`, `ref-${SHOWN_LIMIT + 2}`]);
});

test("an id that answers to nothing is missing rather than over the limit, wherever it was named", () => {
  const references = Array.from({ length: SHOWN_LIMIT }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  /// The ghost sits past the limit in the order it was named, and still resolves
  /// to nothing — the limit counts what was found, not what was asked.
  const { found, missing, overLimit } = pickReferences(references, [
    ...references.map((entry) => entry.id),
    "ghost",
  ]);
  assert.equal(found.length, SHOWN_LIMIT);
  assert.deepEqual(missing, ["ghost"]);
  assert.deepEqual(overLimit, []);
});

test("the same picture shown on two rounds of one exchange is drawn once", () => {
  const first = [attachmentOf(reference({ id: "a" }))];
  const merged = mergedAttachments(first, [
    attachmentOf(reference({ id: "a" })),
    attachmentOf(reference({ id: "b" })),
  ]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a", "reference:b"]);
});

test("the declarations name themselves as the model is told to call them", () => {
  assert.equal(LIST_REFERENCES.name, "list_references");
  assert.equal(SHOW_REFERENCES.name, "show_references");
  assert.deepEqual(SHOW_REFERENCES.parameters.required, ["referenceIds"]);
});

/// The declaration has to agree with the executor about what leaving the field
/// out means. A description still reading "true is the only reason to call this"
/// against a default that already includes the cuts is the one disagreement that
/// costs the model a round to discover.
test("list_references offers the cuts as something to leave out, not to ask for", () => {
  const includeCrops = (
    LIST_REFERENCES.parameters.properties as Record<string, { description?: string } | undefined>
  ).includeCrops;
  assert.match(String(includeCrops?.description), /Pass false/);
  assert.equal(LIST_REFERENCES.description.includes("this is for the cuts"), false);
});

test("a board and a reference of the same id are two attachments", () => {
  const board = boardAttachmentOf({
    id: "a",
    title: "Act one",
    layout: "GRID_3X3",
    images: 9,
    thumbUrl: null,
  });
  const merged = mergedAttachments([attachmentOf(reference({ id: "a" }))], [board, board]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a", "board:a"]);
});

test("a board with nothing drawn of it yet falls back to its cover", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 1,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
  });

  assert.equal(board.preview, null);
  assert.equal(board.thumbUrl, "/api/references/ref-1/image?variant=thumb");
});

test("a board carries the arrangement it was composed into", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 1,
    thumbUrl: null,
    preview: {
      aspectRatio: 16 / 9,
      items: [{ kind: "image", left: 0, top: 0, width: 50, height: 100, thumbUrl: "/t.jpg" }],
    },
  });

  assert.equal(board.preview?.items.length, 1);
  assert.equal(attachmentKey(board), "board:b1");
});

test("a board says what it is rather than what it is called", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "  ",
    layout: "HERO_LEFT",
    images: 1,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
  });

  assert.equal(board.title, "Untitled board");
  assert.equal(board.caption, "1 photograph · Hero left");
});

test("a board attachment opens the board, a cut opens its frame", () => {
  assert.deepEqual(
    attachmentTarget(
      boardAttachmentOf({ id: "b1", title: "Act one", layout: "SPLIT", images: 2, thumbUrl: null }),
    ),
    { view: "moodboard", boardId: "b1" },
  );
  assert.deepEqual(
    attachmentTarget(attachmentOf(reference({ id: "cut", source: { id: "frame", title: "Hallway" } }))),
    { view: "gallery", inspectId: "frame", versionId: "cut" },
  );
});

test("compose_moodboard only offers templates that exist, plus RANDOM", () => {
  assert.equal(COMPOSE_MOODBOARD.name, "compose_moodboard");

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<
    string,
    { enum?: string[]; description?: string }
  >;
  assert.deepEqual(properties.layout?.enum, [...LAYOUT_REQUESTS]);

  /// Which of them carry a line of text, said before the call rather than
  /// reported after it: naming a template is the one decision the model makes
  /// about a board without being told what is in it, and a headline composed at
  /// a template with no text block comes back as "unplaced" — the same word a
  /// photograph the compositor chose to leave off comes back as.
  for (const id of LAYOUTS_WITH_TEXT) {
    assert.match(String(properties.layout?.description), new RegExp(id));
  }
  assert.match(String(properties.layout?.description), /leaves the line off the board/);
});

/// A rebuild's selection can come off the board itself, so demanding the ids
/// would make the model guess at what it is already holding. Only the intention
/// is genuinely required of both shapes of call.
test("compose_moodboard asks for the intention and takes a board to rebuild", () => {
  assert.deepEqual(COMPOSE_MOODBOARD.parameters.required, ["intention"]);

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<string, unknown>;
  assert.ok(properties.boardId, "a board can be named to rebuild");
  /// And the two ways of changing what is on it without naming the whole of it —
  /// which the model cannot do, since a board is primed by id and title only.
  assert.ok(properties.addReferenceIds, "a picture can be put on a board");
  assert.ok(properties.removeReferenceIds, "a picture can be taken off a board");
});

/// The two page parameters are the one pair a model can read as each other: both
/// are about a page, and the difference between them is a page written over and a
/// page added. Which is which has to be in the declaration, since by the time the
/// answer says so the wrong one has been done.
test("compose_moodboard says which of its page parameters replaces a page and which adds one", () => {
  const properties = declared({ photographs: 4, boards: 1 }, "compose_moodboard").properties;

  assert.equal(properties.newPage?.type, "BOOLEAN");
  assert.match(String(properties.newPage?.description), /page of its own/);
  /// The thing a user is owed the truth about: a new page costs them nothing
  /// they already have.
  assert.match(String(properties.newPage?.description), /moved or written over/);
  /// And the other way round, on the parameter that does write over a page: what
  /// `pageId` means changes when the two are passed together, so it says so
  /// rather than being read as the page to replace.
  assert.match(String(properties.pageId?.description), /newPage/);
});

/// The third of them, and the only one that is not a choice between writing over
/// a page and adding one: a name changes nothing about what is on a page. A model
/// reading it as either of the others renames the wrong page or lays one out.
test("compose_moodboard says a page name on its own renames the page and lays nothing out", () => {
  const properties = declared({ photographs: 4, boards: 1 }, "compose_moodboard").properties;

  assert.equal(properties.pageName?.type, "STRING");
  /// Both halves said, because they are one parameter doing two things: the page
  /// newPage adds is named with it, and the page pageId points at is renamed.
  assert.match(String(properties.pageName?.description), /newPage it names the page being added/);
  assert.match(String(properties.pageName?.description), /renames that page/);
  /// The guarantee the rename is worth making: nothing on the page moves and no
  /// other page is touched.
  assert.match(String(properties.pageName?.description), /nothing on the page moves/);
  /// And where to go when there is no page to name, which is the one board this
  /// cannot answer for.
  assert.match(String(properties.pageName?.description), /add_page/);
});

/// The third page parameter in the toolset, and the one whose neighbours are
/// both destructive: `add_page` next to `compose_moodboard`'s `pageId` (which
/// writes a page over) and its `newPage` (which chooses what goes on the new
/// one). A model reading this one as either of those lays a board out that
/// nobody asked to have laid out.
test("add_page says it draws a page and lays nothing out, and never replaces the page it is given", () => {
  const properties = declared({ photographs: 4, boards: 1 }, "add_page").properties;

  assert.deepEqual(ADD_PAGE.parameters.required, ["boardId"]);
  assert.match(String(ADD_PAGE.description), /lays nothing out/);
  /// The one sentence that sends the hand-made board here rather than to a
  /// rebuild, which is the case the tool exists for.
  assert.match(String(ADD_PAGE.description), /arranged by hand/);
  /// And the boundary with the tool beside it: pictures on a new page is a
  /// compose, an empty page is this.
  assert.match(String(ADD_PAGE.description), /compose_moodboard with newPage/);
  assert.match(String(properties.pageId?.description), /goes beside/);
  assert.match(String(properties.pageId?.description), /never replaces/);
  assert.ok(properties.name, "the user's own name for the page can be passed");
});

/// The two free scene edits, on a board that is pages now. Both name what they
/// change by its content — a reference id, a quoted line — and a spread carries
/// both twice as a matter of course, so the page is the only thing that says
/// which copy the user meant.
test("swap_on_board and reword_on_board take the page the edit is on", () => {
  const swap = declared({ photographs: 4, boards: 1 }, "swap_on_board").properties;
  const reword = declared({ photographs: 4, boards: 1 }, "reword_on_board").properties;

  /// Optional, because every board this app has filed until now is one page and
  /// asking for an id on those is a round spent learning what the board already
  /// said.
  assert.deepEqual(SWAP_ON_BOARD.parameters.required, ["boardId", "swaps"]);
  assert.deepEqual(REWORD_ON_BOARD.parameters.required, ["boardId", "rewordings"]);

  /// What a model has to be told to reach for it: without a page the copy edited
  /// is the first the board carries, which is a guess.
  assert.match(String(swap.pageId?.description), /more than one page/);
  assert.match(String(reword.pageId?.description), /more than one page/);
  /// And the one thing the swap's page scoping decides that is not obvious: a
  /// picture on another page joins this one rather than trading across the board.
  assert.match(String(swap.pageId?.description), /rather than trading across/);
});

test("crop_reference takes any shape a user names, not only the usual ones", () => {
  assert.equal(CROP_REFERENCE.name, "crop_reference");
  assert.deepEqual(CROP_REFERENCE.parameters.required, ["referenceId", "intention"]);

  const properties = CROP_REFERENCE.parameters.properties as Record<
    string,
    { enum?: string[]; description?: string }
  >;
  /// Not an enum. The spec asks for "a specific ratio, or loose square/rectangle"
  /// and an enum of six is narrower than that — a user asking for 5:4 would
  /// have been answered with the nearest of six and told nothing about it.
  assert.equal(properties.aspect?.enum, undefined);
  /// The usual ones are still named, because they are what most asks are and a
  /// model given no examples invents its own spelling of them.
  for (const id of CROP_ASPECT_IDS) {
    assert.match(String(properties.aspect?.description), new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(String(properties.aspect?.description), /5:4/);
  /// And the loose half of the same spec sentence: the words a user says
  /// when they have described a shape without naming a number. Without them the
  /// model's only way to pass "make it square" is a ratio nobody asked for.
  for (const id of LOOSE_SHAPE_IDS) {
    assert.match(String(properties.aspect?.description), new RegExp(id));
  }
  /// The board a cut is *for* is optional and stays optional: most crops are
  /// asked for a frame and not for a slot, and a required board would make the
  /// commonest ask impossible to state.
  assert.ok(properties.boardId);
  assert.ok(!CROP_REFERENCE.parameters.required?.includes("boardId"));
  /// Said in the declaration rather than only in the answer, which is where a
  /// ceiling costs nothing to enforce: the swap happens without the model, so
  /// the model has to be told not to make it.
  assert.match(String(properties.boardId?.description), /swap_on_board/);
});

function offer(overrides: Partial<CropOffer> = {}): CropOffer {
  return {
    referenceId: "ref-1",
    region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    cropBox: [100, 100, 600, 600],
    editIntent: "the doorway",
    editRationale: "the light falls through it",
    aspect: null,
    ...overrides,
  };
}

test("an offer is drawn on the frame it would be cut from, under what it keeps", () => {
  const attachment = cropAttachmentOf(reference(), offer());

  assert.equal(attachment.kind, "crop");
  assert.equal(attachment.referenceId, "ref-1");
  assert.equal(attachment.title, "the doorway");
  assert.equal(attachment.thumbUrl, reference().thumbUrl);
  assert.match(attachment.caption, /Keeps 25% of the frame/);
});

test("an offer carries the cut drawn out of the frame, not the frame", () => {
  const attachment = cropAttachmentOf(reference(), offer());

  /// Half of each edge kept, from a tenth in: twice the size, shifted by a fifth
  /// of itself — and shaped 16:9 like the pixels it keeps out of a 16:9 frame.
  assert.deepEqual(attachment.preview, {
    aspectRatio: 1.78,
    image: { width: 200, height: 200, left: -20, top: -20 },
  });
});

test("an offer off a frame with no recorded pixels shows the frame instead", () => {
  const attachment = cropAttachmentOf(reference({ width: null, height: null }), offer());

  assert.equal(attachment.preview, null);
  assert.equal(attachment.thumbUrl, reference().thumbUrl);
});

test("clicking an offer opens its frame and carries the cut to the review there", () => {
  const target = attachmentTarget(cropAttachmentOf(reference(), offer()));

  assert.deepEqual(target, {
    view: "gallery",
    inspectId: "ref-1",
    offer: offer(),
  });
});

test("two cuts of one frame are two offers, and the same cut twice is one", () => {
  const first = cropAttachmentOf(reference(), offer());
  const second = cropAttachmentOf(reference(), offer({ cropBox: [0, 0, 500, 500] }));
  const merged = mergedAttachments([], [first, second, first]);

  assert.deepEqual(merged.map(attachmentKey), [
    "crop:ref-1:100,100,600,600",
    "crop:ref-1:0,0,500,500",
  ]);
});

test("an offer and the picture it is a cut of are two attachments", () => {
  const merged = mergedAttachments(
    [attachmentOf(reference())],
    [cropAttachmentOf(reference(), offer())],
  );

  assert.deepEqual(merged.map(attachmentKey), ["reference:ref-1", "crop:ref-1:100,100,600,600"]);
});

/// A board read off its own scene has no template — the layout is not stored,
/// and a board the user rearranged is no longer the shape it started as. The
/// page is what is still true about it.
test("a board with no template is captioned by its page", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    page: { width: 1080, height: 1920 },
    images: 6,
    thumbUrl: null,
  });

  assert.equal(board.caption, "6 photographs · 1080×1920");
});

test("inspect_board takes a board, and one page of it at most", () => {
  assert.equal(INSPECT_BOARD.name, "inspect_board");
  /// The page is optional, and that is the whole of the read's story: a board
  /// with no pageId is the board, which is what every board made until pages
  /// existed still is.
  assert.deepEqual(INSPECT_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(INSPECT_BOARD.parameters.properties as object), [
    "boardId",
    "pageId",
  ]);
  /// The one tool whose description is about another tool: the call it exists to
  /// stop being made is a rebuild, and a ceiling written into a description is
  /// obeyed before the call rather than refused after it.
  assert.match(INSPECT_BOARD.description, /never rebuild a board/);
  /// Where a page id comes from, said in the declaration: the model cannot
  /// invent one, so the unscoped read has to be named as what hands them out.
  assert.match(INSPECT_BOARD.description, /without a pageId/);
});

test("duplicate_board takes a board, and says what it is for before it is called", () => {
  assert.equal(DUPLICATE_BOARD.name, "duplicate_board");
  assert.deepEqual(DUPLICATE_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(DUPLICATE_BOARD.parameters.properties as object), [
    "boardId",
    "title",
  ]);
  /// The routing is the whole point of the tool and it lives in the description,
  /// where it is obeyed before the call: every other board tool changes the board
  /// the user is looking at, so the copy has to be made *before* the change.
  assert.match(DUPLICATE_BOARD.description, /leave the original untouched/);
  assert.match(DUPLICATE_BOARD.description, /then change the copy/);
});

test("duplicate_page says which of the three copies it is, before it is called", () => {
  assert.equal(DUPLICATE_PAGE.name, "duplicate_page");
  assert.deepEqual(DUPLICATE_PAGE.parameters.required, ["boardId", "pageId"]);
  assert.deepEqual(Object.keys(DUPLICATE_PAGE.parameters.properties as object), [
    "boardId",
    "pageId",
    "name",
  ]);
  /// The same routing `duplicate_board` carries, one level down — and the two
  /// calls it has to be told apart from, because both are reachable, neither
  /// errors, and each is wrong in a way the user finds out about later.
  assert.match(DUPLICATE_PAGE.description, /then change the copy/);
  assert.match(DUPLICATE_PAGE.description, /Do not use duplicate_board/);
  assert.match(DUPLICATE_PAGE.description, /newPage/);
});

/// §V.1's "resizing a page is allowed and changes nothing else": the shape and
/// the arrangement are two requests, and the model's only route to the first was
/// a call that answers with both.
test("resize_page offers the three page shapes and says what it is instead of", () => {
  assert.equal(RESIZE_PAGE.name, "resize_page");
  assert.deepEqual(RESIZE_PAGE.parameters.required, ["boardId", "pageId", "preset"]);
  assert.deepEqual(Object.keys(RESIZE_PAGE.parameters.properties as object), [
    "boardId",
    "pageId",
    "preset",
  ]);
  const preset = (RESIZE_PAGE.parameters.properties as { preset: { enum: string[] } }).preset;
  assert.deepEqual(preset.enum, ["LANDSCAPE_HD", "PORTRAIT_HD", "SQUARE"]);
  /// The routing is obeyed before the call: a compose at a template of another
  /// shape resizes the page too, and hands back an arrangement nobody asked for.
  assert.match(RESIZE_PAGE.description, /lay nothing out again/);
  assert.match(RESIZE_PAGE.description, /compose_moodboard naming a template of another shape/);
  /// The two consequences of writing a rectangle nothing else follows.
  assert.match(RESIZE_PAGE.description, /a page made smaller leaves pictures beside it/);
  assert.match(RESIZE_PAGE.description, /a page made larger takes in whatever it now covers/);
});

test("discard_board offers rather than deletes, and says so before it is called", () => {
  assert.equal(DISCARD_BOARD.name, "discard_board");
  assert.deepEqual(DISCARD_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(DISCARD_BOARD.parameters.properties as object), ["boardId"]);
  /// The whole tool is in its description, where it is obeyed before the call:
  /// it deletes nothing, the user presses the button, and a model that reads
  /// it as a deletion writes "I have deleted that board" over a board that is
  /// still there.
  assert.match(DISCARD_BOARD.description, /This deletes nothing/);
  assert.match(DISCARD_BOARD.description, /never that the board is gone/);
  /// And the ceiling that matters for an act nothing can undo: the board they
  /// named, not the ones it would be tidy to be rid of.
  assert.match(DISCARD_BOARD.description, /Offer only the board they named/);
  assert.match(DISCARD_BOARD.description, /takes none of its photographs out of the gallery/);
});

/// tech-spec §V: the two discards are a routing decision the model makes before
/// it calls either, and getting it wrong costs the user the pages they asked
/// to keep. Both descriptions carry the fork.
test("discard_page takes a page rather than the board, and says which is which", () => {
  assert.equal(DISCARD_PAGE.name, "discard_page");
  /// No default page to throw away: unlike every other page-scoped tool here, a
  /// missing pageId cannot fall back to the board's first page.
  assert.deepEqual(DISCARD_PAGE.parameters.required, ["boardId", "pageId"]);
  assert.deepEqual(Object.keys(DISCARD_PAGE.parameters.properties as object), [
    "boardId",
    "pageId",
  ]);
  assert.match(DISCARD_PAGE.description, /this deletes nothing/);
  assert.match(DISCARD_PAGE.description, /never that the page is gone/);
  assert.match(DISCARD_PAGE.description, /Offer only the page they named/);
  /// The two things the user hears differently from what the call does: the
  /// photographs on the page come off the board, and the gallery keeps them.
  assert.match(DISCARD_PAGE.description, /photographs standing on that page come off the board/);
  assert.match(DISCARD_PAGE.description, /takes none of its photographs out of the gallery/);
  /// And the fork itself, said in both directions.
  assert.match(DISCARD_PAGE.description, /Use discard_board instead when they want the whole board/);
  assert.match(DISCARD_BOARD.description, /Offer only the board they named/);
});

/// tech-spec §V: the call that carries a picture between the pages of one board.
/// The declaration has to say what it is *instead of*, because both alternatives
/// are calls the model already has and both are wrong in ways the answer hides.
test("move_to_page names both pages and says why it is not a swap", () => {
  assert.equal(MOVE_TO_PAGE.name, "move_to_page");
  /// Neither end falls back: a picture is taken off a page and put on a page, and
  /// a default for either would be a page the user did not name.
  assert.deepEqual(MOVE_TO_PAGE.parameters.required, [
    "boardId",
    "fromPageId",
    "toPageId",
    "referenceIds",
  ]);
  assert.deepEqual(Object.keys(MOVE_TO_PAGE.parameters.properties as object), [
    "boardId",
    "fromPageId",
    "toPageId",
    "referenceIds",
  ]);
  /// The guarantee: once on the board afterwards, which is the thing a swap
  /// cannot promise.
  assert.match(MOVE_TO_PAGE.description, /holds each of them once/);
  assert.match(MOVE_TO_PAGE.description, /Do not use swap_on_board for it/);
  assert.match(MOVE_TO_PAGE.description, /carrying it twice/);
  assert.match(MOVE_TO_PAGE.description, /prefer it over compose_moodboard/);
  assert.match(MOVE_TO_PAGE.description, new RegExp(`At most ${MOVE_LIMIT} pictures a call`));
});

test("discard_reference offers rather than deletes, and routes the board case away", () => {
  assert.equal(DISCARD_REFERENCE.name, "discard_reference");
  assert.deepEqual(DISCARD_REFERENCE.parameters.required, ["referenceId"]);
  assert.deepEqual(Object.keys(DISCARD_REFERENCE.parameters.properties as object), ["referenceId"]);
  /// The same three clauses a board's discard carries, for the same reason: the
  /// description is obeyed before the call, and a model that reads this as a
  /// deletion writes "I have deleted that picture" over a picture that is still
  /// there.
  assert.match(DISCARD_REFERENCE.description, /This deletes nothing/);
  assert.match(DISCARD_REFERENCE.description, /never that the picture is gone/);
  assert.match(DISCARD_REFERENCE.description, /Offer only the picture they named/);
  /// The reach the model cannot see, said where it is cheapest to say it.
  assert.match(DISCARD_REFERENCE.description, /deletes every cut made of it/);
  /// And the wrong call this one exists to be reached for instead of: taking a
  /// picture off a board is not taking it out of the project, and the free tool
  /// for that is named rather than left to be discovered by a refusal.
  assert.match(DISCARD_REFERENCE.description, /removeReferenceIds/);
});

test("swap_on_board asks for the pair rather than for two lists", () => {
  assert.equal(SWAP_ON_BOARD.name, "swap_on_board");
  assert.deepEqual(SWAP_ON_BOARD.parameters.required, ["boardId", "swaps"]);

  const properties = SWAP_ON_BOARD.parameters.properties as Record<
    string,
    { items?: { properties?: object; required?: string[] } }
  >;
  /// Objects, not two arrays paired by position: a misaligned pair would put the
  /// wrong cut in the wrong place, and it would do it silently.
  assert.deepEqual(Object.keys(properties.swaps!.items!.properties!), ["takeOff", "putOn"]);
  assert.deepEqual(properties.swaps!.items!.required, ["takeOff", "putOn"]);
  /// The routing lives in the description, where it is obeyed before the call
  /// rather than refused after it — the call it exists to stop being made is a
  /// rebuild that reflows a board nobody asked to rearrange.
  assert.match(SWAP_ON_BOARD.description, /prefer it over compose_moodboard/);
});

test("reword_on_board asks for the pair, and routes the other two text edits away", () => {
  assert.equal(REWORD_ON_BOARD.name, "reword_on_board");
  assert.deepEqual(REWORD_ON_BOARD.parameters.required, ["boardId", "rewordings"]);

  const properties = REWORD_ON_BOARD.parameters.properties as Record<
    string,
    { items?: { properties?: object; required?: string[] } }
  >;
  /// Objects for the same reason a swap's are: two parallel arrays of wordings
  /// would misalign into a line that reads as correct whichever way it was meant,
  /// and here the mistake is written onto the board in words.
  assert.deepEqual(Object.keys(properties.rewordings!.items!.properties!), ["from", "to"]);
  assert.deepEqual(properties.rewordings!.items!.required, ["from", "to"]);
  /// The routing is in the description, obeyed before the call: a rebuild is what
  /// this exists to stop, and add/remove of a line is what it must not swallow.
  assert.match(REWORD_ON_BOARD.description, /prefer it over compose_moodboard/);
  assert.match(REWORD_ON_BOARD.description, /addCaptions\/removeCaptions only to add a line/);
});

test("read_canvas says what it is instead of, and that the handles come from it", () => {
  assert.equal(READ_CANVAS.name, "read_canvas");
  assert.deepEqual(READ_CANVAS.parameters.required, ["boardId"]);
  /// The split from inspect_board is the whole reason the tool exists, and it
  /// has to be in the declaration — by the time the model has called the wrong
  /// read it has spent the round the split was meant to save.
  assert.match(READ_CANVAS.description, /not inspect_board/);
  /// The instruction seam: read before any direct edit, the way inspect_board
  /// is read before a content edit, and by name so the routing is followable.
  assert.match(
    READ_CANVAS.description,
    /before transform_on_canvas, reorder_on_canvas or remove_from_canvas/,
  );
  /// The dialect is two dialects, and which one a box is in is said per object
  /// — a number a model has to guess the unit of is a number it guesses wrong.
  assert.match(READ_CANVAS.description, /boxUnit/);
  assert.match(READ_CANVAS.description, /\[ymin, xmin, ymax, xmax\]/);
  /// And the handle rule: a referenceId stops naming one thing the moment a
  /// photo is placed twice.
  assert.match(READ_CANVAS.description, /placed twice is two objects/);
});

test("put_on_canvas routes by whether the user named the place, and says its cap", () => {
  assert.deepEqual(PUT_ON_CANVAS.parameters.required, ["boardId", "objects"]);
  assert.match(PUT_ON_CANVAS.description, new RegExp(`At most ${CANVAS_PUT_LIMIT} objects a call`));
  /// The routing against compose, both directions: a named place is this
  /// tool's, an arrangement is compose's.
  assert.match(PUT_ON_CANVAS.description, /prefer compose_moodboard when they want a set arranged/);
  /// Contain, never stretch (§XIII.6) — the put has no stretch switch at all.
  assert.match(PUT_ON_CANVAS.description, /keeps its own shape inside the box/);
  /// Not doubled, and said as the answer the model will read it back in.
  assert.match(PUT_ON_CANVAS.description, /alreadyOn/);

  const properties = PUT_ON_CANVAS.parameters.properties as Record<
    string,
    { items?: { properties?: Record<string, { enum?: string[] }>; required?: string[] } }
  >;
  assert.deepEqual(Object.keys(properties.objects!.items!.properties!), [
    "kind",
    "referenceId",
    "text",
    "name",
    "pageId",
    "box",
  ]);
  /// Only the kind is required: which other field an object needs depends on
  /// what it is, and the executor answers a mismatch rather than the schema.
  assert.deepEqual(properties.objects!.items!.required, ["kind"]);
  assert.deepEqual(properties.objects!.items!.properties!.kind!.enum, ["image", "text", "page"]);
});

test("remove_from_canvas says every selector form, and that the gallery is untouched", () => {
  assert.deepEqual(REMOVE_FROM_CANVAS.parameters.required, ["boardId", "objects"]);
  assert.match(
    REMOVE_FROM_CANVAS.description,
    new RegExp(`At most ${CANVAS_REMOVE_LIMIT} selectors a call`),
  );
  /// The four forms one selector string is tried as, so the model does not
  /// invent a fifth: objectId, referenceId, a line's words, a pageId.
  assert.match(REMOVE_FROM_CANVAS.description, /objectId from read_canvas first/);
  assert.match(REMOVE_FROM_CANVAS.description, /every copy of that picture/);
  assert.match(REMOVE_FROM_CANVAS.description, /words of a line/);
  /// A page's removal is the same act discard_page offers with a button — the
  /// seam between an offer and a write has to be said where the write is.
  assert.match(REMOVE_FROM_CANVAS.description, /discard_page offers with a button/);
  /// Removal from a board is not removal from the project — the sentence that
  /// stops the model telling the user a picture was deleted.
  assert.match(REMOVE_FROM_CANVAS.description, /Nothing leaves the project/);
  assert.match(REMOVE_FROM_CANVAS.description, /notOnBoard/);
});

test("transform_on_canvas carries the refusal rules, and routes geometry away from a rebuild", () => {
  assert.deepEqual(TRANSFORM_ON_CANVAS.parameters.required, ["boardId", "changes"]);
  assert.match(
    TRANSFORM_ON_CANVAS.description,
    new RegExp(`At most ${CANVAS_TRANSFORM_LIMIT} changes a call`),
  );
  /// The seam the spec asked for by name: pure geometry is this tool's, not a
  /// rebuild's, and the read comes first.
  assert.match(TRANSFORM_ON_CANVAS.description, /prefer it over compose_moodboard/);
  assert.match(TRANSFORM_ON_CANVAS.description, /read_canvas first/);
  /// The rules the pure module refuses by, said before the call rather than
  /// discovered by making it: pages do not rotate and resize_page owns their
  /// shape; locked is refused; a group moves whole; aspect holds bar stretch.
  assert.match(TRANSFORM_ON_CANVAS.description, /page cannot be rotated/);
  assert.match(TRANSFORM_ON_CANVAS.description, /resize_page/);
  assert.match(TRANSFORM_ON_CANVAS.description, /locked/);
  assert.match(TRANSFORM_ON_CANVAS.description, /whole group rigidly/);
  assert.match(TRANSFORM_ON_CANVAS.description, /keeps its own proportions.*unless the change says stretch/);

  const properties = TRANSFORM_ON_CANVAS.parameters.properties as Record<
    string,
    { items?: { properties?: object; required?: string[] } }
  >;
  assert.deepEqual(Object.keys(properties.changes!.items!.properties!), [
    "objectId",
    "to",
    "angle",
    "size",
    "stretch",
  ]);
  assert.deepEqual(properties.changes!.items!.required, ["objectId"]);
});

test("reorder_on_canvas addresses stacking relatively, within one company", () => {
  assert.deepEqual(REORDER_ON_CANVAS.parameters.required, ["boardId", "moves"]);
  assert.match(
    REORDER_ON_CANVAS.description,
    new RegExp(`At most ${CANVAS_REORDER_LIMIT} moves a call`),
  );
  assert.match(REORDER_ON_CANVAS.description, /prefer it over compose_moodboard/);
  /// z is per company, and front/back mean that company's ends — the one fact
  /// that stops "bring it above the other page's picture" being asked at all.
  assert.match(REORDER_ON_CANVAS.description, /own company/);
  /// Pages are refused — stacking between pages is not a thing the scene has.
  assert.match(REORDER_ON_CANVAS.description, /page cannot be reordered/);

  const properties = REORDER_ON_CANVAS.parameters.properties as Record<
    string,
    { items?: { properties?: Record<string, { enum?: string[] }>; required?: string[] } }
  >;
  /// A destination is one of four shapes and Vertex schemas carry no unions, so
  /// it is flattened to three fields and the rule "exactly one" is prose — the
  /// executor answers a move that names none or two.
  assert.deepEqual(Object.keys(properties.moves!.items!.properties!), [
    "objectId",
    "to",
    "above",
    "below",
  ]);
  assert.deepEqual(properties.moves!.items!.properties!.to!.enum, ["front", "back"]);
  assert.deepEqual(properties.moves!.items!.required, ["objectId"]);
});

const toolNames = (state: { photographs?: number; crops?: number; boards?: number }) =>
  orchestratorTools({ photographs: 0, crops: 0, boards: 0, ...state }).map((tool) => tool.name);

test("a project with nothing in it is given the one tool that needs nothing", () => {
  /// Every declaration is schema and prose re-sent on every round, and on an
  /// empty project every one that takes an id can only answer "no reference
  /// called that". generate_image takes none, and it is how the project stops
  /// being empty — so it is the exception, and the only one.
  assert.deepEqual(toolNames({}), ["generate_image"]);
});

test("generate_image is declared on every shape of project, and last", () => {
  /// Ungated is the whole point (§IV): the count that would gate it is the one
  /// count the tool does not read.
  for (const state of [{}, { photographs: 3 }, { crops: 2 }, { photographs: 5, boards: 1 }]) {
    const names = toolNames(state);
    assert.equal(names.at(-1), "generate_image", JSON.stringify(state));
  }
});

test("generate_image says what it is for, what it costs and what it is not preferred over", () => {
  assert.equal(GENERATE_IMAGE.name, "generate_image");
  assert.deepEqual(GENERATE_IMAGE.parameters.required, ["description"]);
  assert.deepEqual(Object.keys(GENERATE_IMAGE.parameters.properties as object), [
    "description",
    "aspect",
  ]);
  /// The gallery outranks the generator: a picture somebody chose beats a
  /// picture nobody took, and the model can only weigh that if it is told.
  assert.match(GENERATE_IMAGE.description, /Prefer a picture the user actually has/);
  /// Said rather than passed off as found — the honesty clause the instruction
  /// repeats, kept here too because this is what is read at the moment of the
  /// call.
  assert.match(GENERATE_IMAGE.description, /made rather than found/);
  /// The ceiling, said the way crop_reference says its own.
  assert.match(GENERATE_IMAGE.description, new RegExp(`at most ${GENERATE_CALL_LIMIT} a turn`));
});

/// The instruction's own copy of this sentence is gated on the same count, and
/// for the same reason: on the empty project it is about pictures that do not
/// exist, and it is read at the moment of the call by the one tool that works
/// before anything has been uploaded.
test("generate_image is told to prefer a photograph of theirs only where they have one", () => {
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0 }).description;
  assert.ok(!empty.includes("Prefer a picture the user actually has"));
  assert.ok(!empty.includes("  "));
  /// The rest of the description is unmoved — the sentence is dropped, not
  /// rewritten into something the empty project pays for instead.
  assert.match(empty, /only tool here that makes a picture/);
  assert.match(empty, /made rather than found/);

  for (const state of [
    { photographs: 1, crops: 0, boards: 0 },
    { photographs: 0, crops: 1, boards: 0 },
  ]) {
    assert.match(
      generateImageFor({ ...state, boards: 0 }).description,
      /Prefer a picture the user actually has/,
      JSON.stringify(state),
    );
  }
});

/// The empty project's premise one step on: it drew its way out of empty, so it
/// has pictures and none of them are the user's. The instruction's copy of this
/// is chosen off the same count, and this one is the copy read at the moment of
/// the call — by the only tool whose per-turn ceiling says nothing about the
/// turn after.
test("generate_image is steered to reuse its own drawings where they are all there is", () => {
  const drawn = generateImageFor({
    photographs: 2,
    crops: 0,
    boards: 0,
    generated: 2,
  }).description;

  assert.ok(!drawn.includes("Prefer a picture the user actually has"));
  assert.ok(!drawn.includes("  "));
  assert.match(drawn, /Look at what you have already drawn first/);
  assert.match(drawn, /comes back a different picture/);
  /// Everything else the description says is unmoved — one sentence is chosen,
  /// not the description rewritten.
  assert.match(drawn, /only tool here that makes a picture/);
  assert.match(drawn, /made rather than found/);

  /// One of theirs among the drawings is still something to prefer, and a
  /// caller that has not counted the drawings is not claiming there are none.
  assert.match(
    generateImageFor({ photographs: 2, crops: 1, boards: 0, generated: 2 }).description,
    /Prefer a picture the user actually has/,
  );
  assert.match(
    generateImageFor({ photographs: 2, crops: 0, boards: 0 }).description,
    /Prefer a picture the user actually has/,
  );

  /// And the empty project drops the sentence rather than picking the other one:
  /// it has nothing drawn to reach for either.
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0, generated: 0 }).description;
  assert.ok(!empty.includes("Look at what you have already drawn first"));
});

/// Ungated is about the *list*; what it says is still a function of what the
/// project holds, because the reason the id is worth a round is that something
/// can place it — and which tool places it changes.
test("generate_image names the door its id goes through next, and only where it is open", () => {
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0 }).description;
  assert.ok(!empty.includes("compose_moodboard"));
  assert.ok(!empty.includes("put_on_canvas"));
  assert.match(empty, /arrive with it, on the next round of this same turn/);

  const pictures = generateImageFor({ photographs: 3, crops: 0, boards: 0 }).description;
  assert.match(pictures, /compose_moodboard can build a board around it/);
  assert.ok(!pictures.includes("put_on_canvas"));

  const composed = generateImageFor({ photographs: 3, crops: 0, boards: 1 }).description;
  assert.match(composed, /put_on_canvas places it where the user said/);
});

test("generate_image's description parameter says the drawing model sees nothing else", () => {
  const properties = GENERATE_IMAGE.parameters.properties as Record<
    string,
    { description: string; enum?: string[] }
  >;
  /// The one failure mode of a generated prompt: a line written as if the model
  /// could see the board it is for.
  assert.match(properties.description!.description, /cannot see the project/);
  /// The aspect is crop_reference's dialect, both halves of it, listed rather
  /// than described so the model passes a value the parser reads — and named as
  /// that tool's only where that tool is declared.
  for (const id of [...CROP_ASPECT_IDS, ...LOOSE_SHAPE_IDS]) {
    assert.match(properties.aspect!.description, new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(properties.aspect!.description, /crop_reference/);
  const alone = generateImageFor({ photographs: 0, crops: 0, boards: 0 });
  const aloneAspect = (alone.parameters.properties as Record<string, { description: string }>)
    .aspect!.description;
  assert.ok(!aloneAspect.includes("crop_reference"));
  for (const id of [...CROP_ASPECT_IDS, ...LOOSE_SHAPE_IDS]) {
    assert.match(aloneAspect, new RegExp(id.replace(/\./g, "\\.")));
  }
  /// Optional, and said as the weak choice it is: the shape of a background is
  /// the one thing about it that cannot be fixed afterwards.
  assert.match(properties.aspect!.description, /shape genuinely does not matter/);
  assert.equal(properties.aspect!.enum, undefined);
});

/// The ceiling counts calls and the sentence is about pictures, so the turn
/// where every attempt was refused is the one the wording has to survive.
test("the generation ceiling is refused in terms of what was drawn, not what was paid for", () => {
  const all = generationCeilingSaid(GENERATE_CALL_LIMIT, GENERATE_CALL_LIMIT);
  assert.match(all, new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`));
  assert.match(all, /show the user what you drew/);

  /// Nothing exists to show, so nothing is claimed to.
  const none = generationCeilingSaid(GENERATE_CALL_LIMIT, 0);
  assert.match(none, /none of them could be drawn/);
  assert.ok(!none.includes("show the user what you drew"));
  assert.ok(!none.includes("already made"));

  const some = generationCeilingSaid(2, 1);
  assert.match(some, /1 of them was drawn/);
  assert.match(some, /show the user what you did draw/);
});

test("list_references is declared for any project with a picture in it", () => {
  /// The door to every picture and its properties, so the count that gates it is
  /// the pictures rather than the cuts. A project of photographs alone can still
  /// answer it — the priming makes that answer a repetition, which is a reason
  /// not to call it rather than a reason not to have it.
  assert.deepEqual(toolNames({ photographs: 3 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "compose_moodboard",
    "generate_image",
  ]);
  assert.deepEqual(toolNames({ photographs: 3, crops: 1 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "compose_moodboard",
    "generate_image",
  ]);
});

test("the board tools arrive with the first board, and compose_moodboard is there before it", () => {
  /// inspect_board and swap_on_board both take a board id, and the only ids
  /// there are come from the boards brief — so before the first board they are
  /// two tools that can only be called wrong. compose_moodboard is what makes it.
  assert.ok(!toolNames({ photographs: 5 }).includes("inspect_board"));
  assert.ok(toolNames({ photographs: 5 }).includes("compose_moodboard"));

  assert.deepEqual(toolNames({ photographs: 5, boards: 1 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "inspect_board",
    "add_page",
    "duplicate_page",
    "resize_page",
    "duplicate_board",
    "swap_on_board",
    "reword_on_board",
    "move_to_page",
    "read_canvas",
    "put_on_canvas",
    "remove_from_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "discard_page",
    "discard_board",
    "compose_moodboard",
    "generate_image",
  ]);
});

test("read_references says what it is the only door to, and that it asks for nothing", () => {
  assert.deepEqual(READ_REFERENCES.parameters.required, ["referenceIds"]);
  /// The reason it is worth a round beside list_references, said before the call:
  /// the palette and the rationale are dropped from every digest in the layer, so
  /// this is the only door to them.
  assert.match(READ_REFERENCES.description, /only door to the palette and the reasoning/);
  /// And what it is not: it used to send pictures to be read, and a model that
  /// still reads it that way tells the user a reading is on its way that
  /// nobody asked for.
  assert.match(READ_REFERENCES.description, /Nothing is read afresh/);
  assert.match(READ_REFERENCES.description, /properties panel/);
  assert.equal(READ_REFERENCES.description.includes("in the background"), false);
  assert.match(READ_REFERENCES.description, new RegExp(`At most ${READ_LIMIT} pictures a call`));
});

/// The gate was the stalled count, which is now exactly backwards: stalled is
/// the pictures with no properties, and properties are the whole of what this
/// answers with. So it moves onto the count the other doors are on — a project
/// agent 2 has finished with is the one this is most useful on, and it was the
/// one project it was withheld from.
test("read_references arrives with the first picture, whether or not anything is unread", () => {
  assert.ok(toolNames({ photographs: 3 }).includes("read_references"));
  assert.ok(toolNames({ crops: 1 }).includes("read_references"));
  assert.ok(!toolNames({}).includes("read_references"));
});

test("a cut is a picture: a project of nothing but crops can still be shown and composed", () => {
  assert.deepEqual(toolNames({ crops: 2 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "compose_moodboard",
    "generate_image",
  ]);
});

const toolsFor = (state: { photographs?: number; crops?: number; boards?: number }) =>
  orchestratorTools({ photographs: 0, crops: 0, boards: 0, ...state });

const declared = (
  state: { photographs?: number; crops?: number; boards?: number },
  name: string,
) => {
  const tool = toolsFor(state).find((declaration) => declaration.name === name);
  assert.ok(tool, `${name} is declared`);
  return {
    description: tool.description,
    properties: tool.parameters.properties as Record<
      string,
      { description?: string; type?: string } | undefined
    >,
  };
};

/// The gating that made the tool *list* a function of the project stops at the
/// declaration's edge unless it is carried inside it: eight of compose's thirteen
/// parameters are about rebuilding a board, which a project with none cannot do —
/// and a `pageId` is one of them twice over, since a page id only exists on a
/// board that has already been composed — as are `newPage` and `pageName`, which
/// are a page added to a board and a page of one renamed rather than a board.
test("the rebuild half of compose_moodboard arrives with the first board", () => {
  const before = declared({ photographs: 4 }, "compose_moodboard");
  for (const key of [
    "boardId",
    "pageId",
    "newPage",
    "pageName",
    "addReferenceIds",
    "removeReferenceIds",
    "addCaptions",
    "removeCaptions",
  ]) {
    assert.ok(!before.properties[key], `${key} is not offered before there is a board`);
  }
  /// And what stays is stated as the only shape of call there is, rather than as
  /// one of two — a "new board, or a rebuild" is a choice this project has not
  /// got.
  assert.ok(!before.description.includes("rebuild"));
  assert.ok(!before.properties.captions?.description?.includes("rebuild"));

  const after = declared({ photographs: 4, boards: 1 }, "compose_moodboard");
  for (const key of [
    "boardId",
    "pageId",
    "newPage",
    "pageName",
    "addReferenceIds",
    "removeReferenceIds",
    "addCaptions",
    "removeCaptions",
  ]) {
    assert.ok(after.properties[key], `${key} is offered once a board exists`);
  }
});

test("crop_reference takes a board only where there are boards, and a cut only where there are cuts", () => {
  const plain = declared({ photographs: 4 }, "crop_reference");
  assert.ok(!plain.properties.boardId, "no board to cut for");
  /// The nudge is reachable only through a cut's id, and there are none to pass.
  assert.ok(!plain.properties.referenceId?.description?.includes("*cut*"));

  const grown = declared({ photographs: 4, crops: 1, boards: 1 }, "crop_reference");
  assert.ok(grown.properties.boardId);
  assert.match(String(grown.properties.referenceId?.description), /Give the id of a \*cut\*/);
});

/// The instruction has been gated on these counts since it learned to be, and
/// the declarations it points at were not: four of them sent the model to
/// `list_references` for ids on projects that were never handed it. A tool named
/// in a description is a tool the model will try to call.
test("no declaration names a tool this project was not given", () => {
  const everyName = toolsFor({ photographs: 4, crops: 2, boards: 2 }).map(
    (tool) => tool.name,
  );

  for (const state of [
    { photographs: 4 },
    { photographs: 4, crops: 2 },
    { photographs: 4, boards: 2 },
    { photographs: 4, crops: 2, boards: 2 },
  ]) {
    const tools = toolsFor(state);
    const given = new Set(tools.map((tool) => tool.name));
    const said = JSON.stringify(tools);
    for (const name of everyName) {
      if (given.has(name)) continue;
      assert.ok(!said.includes(name), `${name} is named to a project that cannot call it`);
    }
  }
});

test("a board with no pictures left under it keeps the tools that read it", () => {
  /// The edge the counts are deliberately separate for: a board outlives the
  /// gallery it was composed from, and reading one is still a thing to do.
  assert.deepEqual(toolNames({ boards: 1 }), [
    "inspect_board",
    "add_page",
    "duplicate_page",
    "resize_page",
    "duplicate_board",
    "swap_on_board",
    "reword_on_board",
    "move_to_page",
    "read_canvas",
    "put_on_canvas",
    "remove_from_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "discard_page",
    "discard_board",
    "generate_image",
  ]);
});

/// The commonest two-tool turn about a board: the instruction tells the model to
/// read one before it changes one, so the read's tile and the edit's tile are the
/// same board a round apart. Drawing the first is drawing the board as it was
/// before the change the user asked for.
test("a board seen twice in one turn is drawn as it last stood, in the place it first appeared", () => {
  const read = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 2,
    thumbUrl: null,
  });
  const afterTheEdit = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "TRIPTYCH",
    images: 3,
    thumbUrl: null,
  });

  const merged = mergedAttachments([read, attachmentOf(reference({ id: "a" }))], [afterTheEdit]);

  assert.deepEqual(merged.map(attachmentKey), ["board:b1", "reference:a"]);
  assert.equal(merged[0]?.caption, "3 photographs · Triptych");
});

/// Only a board. A photograph's bytes do not change inside a turn and an offer is
/// keyed by its own box, so replacing either would be redrawing the same tile.
test("a picture shown twice keeps the first drawing of it", () => {
  const first = attachmentOf(reference({ id: "a", title: "Hallway" }));
  const again = attachmentOf(reference({ id: "a", title: "Renamed since" }));

  const merged = mergedAttachments([first], [again]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a"]);
  assert.equal(merged[0]?.title, "Hallway");
});

/// A board is pictures *and* text, and a reply about the headline came back with
/// a tile that said "4 photographs" beside a miniature drawing the line as a
/// featureless bar — the one thing that had just changed, invisible.
test("a board says what is written on it, not only how many pictures", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Dawn Study",
    layout: "POLAROID_SCATTER",
    images: 4,
    lines: ["ACT TWO"],
    thumbUrl: null,
  });

  assert.deepEqual(board.lines, ["ACT TWO"]);
  assert.equal(board.linesOver, 0);
  assert.equal(board.caption, "4 photographs · 1 line · Polaroid scatter");
});

test("a board carrying nothing written says nothing about lines", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 2,
    lines: ["   ", ""],
    thumbUrl: null,
  });

  assert.deepEqual(board.lines, []);
  assert.equal(board.caption, "2 photographs · Split");
});

/// A hand-arranged board has no bound on how much type the user dropped on
/// it, and the tile is a tile. What does not fit is counted rather than left off
/// the end, so the last line shown does not read as the last line there is.
test("a board of more lines than fit counts the rest", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Notes",
    page: { width: 1920, height: 1080 },
    images: 0,
    lines: ["one", "two", "three", "four", "five"],
    thumbUrl: null,
  });

  assert.deepEqual(board.lines, ["one", "two", "three"]);
  assert.equal(board.linesOver, 2);
  assert.equal(board.caption, "0 photographs · 5 lines · 1920×1080");
});

test("a line longer than the tile is cut with an ellipsis rather than wrapped", () => {
  const long = "the light comes over the ridge and everything below it goes to silhouette";
  const board = boardAttachmentOf({
    id: "b1",
    title: "Notes",
    images: 1,
    lines: [`  ${long}  `.replace("comes over", "comes  over")],
    thumbUrl: null,
  });

  const [shown] = board.lines;
  assert.equal(shown?.length, BOARD_LINE_CHARS);
  assert.ok(shown?.endsWith("…"));
  /// Whitespace normalised on the way in, so a retyped double space is not a
  /// different line and does not eat two of the characters that fit.
  assert.ok(shown?.startsWith("the light comes over the ridge"));
});
