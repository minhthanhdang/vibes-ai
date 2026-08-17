import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG_LIMIT,
  COMPOSE_MOODBOARD,
  DISCARD_BOARD,
  DISCARD_REFERENCE,
  DUPLICATE_BOARD,
  INSPECT_BOARD,
  CROP_REFERENCE,
  LIST_REFERENCES,
  READ_LIMIT,
  READ_REFERENCES,
  SHOWN_LIMIT,
  SHOW_REFERENCES,
  REWORD_ON_BOARD,
  SWAP_ON_BOARD,
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
  mergedAttachments,
  orchestratorTools,
  pickReferences,
  referenceCatalog,
  referenceDigest,
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

test("a photograph's shape is said by the name a director uses for it", () => {
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

/// The director's own words are the one thing in a turn nothing derived, and
/// they were the one thing the model was never given.
test("the project's brief is primed in the director's own words, with what to do about it", () => {
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
/// from half of what the director wrote.
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

/// The star is the one thing in a digest the director said themselves. Without
/// it the model is deciding "which of these matters" from tags a machine read,
/// while the answer is sitting in a column that already sorts the list it is
/// being shown.
test("a picture the director starred is marked, and an ordinary one carries nothing", () => {
  const [, starred] = catalogBrief([reference({ favorite: true })]).split("\n");
  assert.equal(starred, "ref-1 · Hallway · starred · 16:9");

  const [, plain] = catalogBrief([reference()]).split("\n");
  assert.equal(plain, "ref-1 · Hallway · 16:9");
  assert.equal(referenceDigest(reference({ favorite: false })).favorite, undefined);
});

test("what the star means is said once, and only to a project that has one", () => {
  const starred = catalogBrief([reference({ favorite: true }), reference({ id: "ref-2" })]);
  assert.match(starred, /the director starred in the gallery/);
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

/// The next step a stalled picture is given has to be one the model can take.
/// It used to be "the director can ask again from the properties panel" — a
/// capability the assistant could see, name and not reach. It is now a call, and
/// the sentence is gated on exactly what the declaration is, so the instruction
/// never names a tool this turn was not handed.
test("a stalled picture is pointed at the call that reads it, and a waiting one is not", () => {
  assert.match(catalogBrief([reference({ unread: "never" })]), /call read_references with their ids/);
  assert.equal(
    catalogBrief([reference({ unread: "pending" })]).includes("read_references"),
    false,
  );
  assert.equal(catalogBrief([reference()]).includes("read_references"), false);
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
/// the director dragged together, which is a fact about it rather than a gap.
test("a board's template is on its line when it has one", () => {
  const brief = boardsBrief([
    { id: "board-1", title: "Act two", width: 1920, height: 1080, layout: "HERO_LEFT" },
    { id: "board-2", title: "Scraps", width: 1920, height: 1080, layout: null },
  ]);
  const [, composed, dragged] = brief.split("\n");

  assert.equal(composed, "board-1 · Act two · 1920×1080 · HERO_LEFT");
  assert.equal(dragged, "board-2 · Scraps · 1920×1080");
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
  /// The thing a director is owed the truth about: a new page costs them nothing
  /// they already have.
  assert.match(String(properties.newPage?.description), /moved or written over/);
  /// And the other way round, on the parameter that does write over a page: what
  /// `pageId` means changes when the two are passed together, so it says so
  /// rather than being read as the page to replace.
  assert.match(String(properties.pageId?.description), /newPage/);
});

test("crop_reference takes any shape a director names, not only the usual ones", () => {
  assert.equal(CROP_REFERENCE.name, "crop_reference");
  assert.deepEqual(CROP_REFERENCE.parameters.required, ["referenceId", "intention"]);

  const properties = CROP_REFERENCE.parameters.properties as Record<
    string,
    { enum?: string[]; description?: string }
  >;
  /// Not an enum. The spec asks for "a specific ratio, or loose square/rectangle"
  /// and an enum of six is narrower than that — a director asking for 5:4 would
  /// have been answered with the nearest of six and told nothing about it.
  assert.equal(properties.aspect?.enum, undefined);
  /// The usual ones are still named, because they are what most asks are and a
  /// model given no examples invents its own spelling of them.
  for (const id of CROP_ASPECT_IDS) {
    assert.match(String(properties.aspect?.description), new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(String(properties.aspect?.description), /5:4/);
  /// And the loose half of the same spec sentence: the words a director says
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
/// and a board the director rearranged is no longer the shape it started as. The
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
  /// the director is looking at, so the copy has to be made *before* the change.
  assert.match(DUPLICATE_BOARD.description, /leave the original untouched/);
  assert.match(DUPLICATE_BOARD.description, /then change the copy/);
});

test("discard_board offers rather than deletes, and says so before it is called", () => {
  assert.equal(DISCARD_BOARD.name, "discard_board");
  assert.deepEqual(DISCARD_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(DISCARD_BOARD.parameters.properties as object), ["boardId"]);
  /// The whole tool is in its description, where it is obeyed before the call:
  /// it deletes nothing, the director presses the button, and a model that reads
  /// it as a deletion writes "I have deleted that board" over a board that is
  /// still there.
  assert.match(DISCARD_BOARD.description, /This deletes nothing/);
  assert.match(DISCARD_BOARD.description, /never that the board is gone/);
  /// And the ceiling that matters for an act nothing can undo: the board they
  /// named, not the ones it would be tidy to be rid of.
  assert.match(DISCARD_BOARD.description, /Offer only the board they named/);
  assert.match(DISCARD_BOARD.description, /takes none of its photographs out of the gallery/);
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

const toolNames = (state: {
  photographs?: number;
  crops?: number;
  boards?: number;
  stalled?: number;
}) =>
  orchestratorTools({ photographs: 0, crops: 0, boards: 0, stalled: 0, ...state }).map(
    (tool) => tool.name,
  );

test("a project with nothing in it is given no tools at all", () => {
  /// Every declaration is schema and prose re-sent on every round, and on an
  /// empty project every one of them can only answer "no reference called that".
  assert.deepEqual(toolNames({}), []);
});

test("list_references is only declared once there are cuts to list", () => {
  /// The photographs are primed into the instruction; the tool exists for what
  /// priming cannot carry. A project nobody has cropped has nothing for it.
  assert.deepEqual(toolNames({ photographs: 3 }), [
    "show_references",
    "crop_reference",
    "discard_reference",
    "compose_moodboard",
  ]);
  assert.deepEqual(toolNames({ photographs: 3, crops: 1 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "compose_moodboard",
  ]);
});

test("the board tools arrive with the first board, and compose_moodboard is there before it", () => {
  /// inspect_board and swap_on_board both take a board id, and the only ids
  /// there are come from the boards brief — so before the first board they are
  /// two tools that can only be called wrong. compose_moodboard is what makes it.
  assert.ok(!toolNames({ photographs: 5 }).includes("inspect_board"));
  assert.ok(toolNames({ photographs: 5 }).includes("compose_moodboard"));

  assert.deepEqual(toolNames({ photographs: 5, boards: 1 }), [
    "show_references",
    "crop_reference",
    "discard_reference",
    "inspect_board",
    "duplicate_board",
    "swap_on_board",
    "reword_on_board",
    "discard_board",
    "compose_moodboard",
  ]);
});

test("read_references says in its description that no tags come back in the answer", () => {
  assert.deepEqual(READ_REFERENCES.parameters.required, ["referenceIds"]);
  /// The one thing about this tool that is unlike every other: it is answered by
  /// an agent the reply does not wait for. A model that reads the call as "and
  /// now I know what these look like" writes a paragraph about pictures nobody
  /// has read — the exact failure the unread marks exist to prevent.
  assert.match(READ_REFERENCES.description, /in the background/);
  assert.match(READ_REFERENCES.description, /no tags come back in this reply/);
  /// The routing is stated before the call rather than refused after it: a
  /// picture already on its way needs nothing, and the ceiling is a number the
  /// model can respect for free.
  assert.match(READ_REFERENCES.description, /already on their way/);
  assert.match(READ_REFERENCES.description, new RegExp(`At most ${READ_LIMIT} a turn`));
});

/// The tool exists for the pictures agent 2 will not get to on its own. A
/// project it has finished with has nothing for it, and — the distinction worth
/// pinning — neither does one whose readings are simply still running: those
/// arrive without anybody asking, so declaring the schema for them would be a
/// cost paid on every round of the window right after an upload.
test("read_references arrives only for pictures that will not be read on their own", () => {
  assert.ok(!toolNames({ photographs: 3 }).includes("read_references"));
  assert.ok(!toolNames({ photographs: 3, stalled: 0 }).includes("read_references"));

  assert.deepEqual(toolNames({ photographs: 3, stalled: 2 }), [
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "compose_moodboard",
  ]);
});

test("a cut is a picture: a project of nothing but crops can still be shown and composed", () => {
  assert.deepEqual(toolNames({ crops: 2 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "compose_moodboard",
  ]);
});

const toolsFor = (state: {
  photographs?: number;
  crops?: number;
  boards?: number;
  stalled?: number;
}) => orchestratorTools({ photographs: 0, crops: 0, boards: 0, stalled: 0, ...state });

const declared = (
  state: { photographs?: number; crops?: number; boards?: number; stalled?: number },
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
/// declaration's edge unless it is carried inside it: seven of compose's twelve
/// parameters are about rebuilding a board, which a project with none cannot do —
/// and a `pageId` is one of them twice over, since a page id only exists on a
/// board that has already been composed — as is `newPage`, which is a page added
/// to a board rather than a board.
test("the rebuild half of compose_moodboard arrives with the first board", () => {
  const before = declared({ photographs: 4 }, "compose_moodboard");
  for (const key of [
    "boardId",
    "pageId",
    "newPage",
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
  const everyName = toolsFor({ photographs: 4, crops: 2, boards: 2, stalled: 2 }).map(
    (tool) => tool.name,
  );

  for (const state of [
    { photographs: 4 },
    { photographs: 4, crops: 2 },
    { photographs: 4, boards: 2 },
    { photographs: 4, crops: 2, boards: 2, stalled: 2 },
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
    "duplicate_board",
    "swap_on_board",
    "reword_on_board",
    "discard_board",
  ]);
});

/// The commonest two-tool turn about a board: the instruction tells the model to
/// read one before it changes one, so the read's tile and the edit's tile are the
/// same board a round apart. Drawing the first is drawing the board as it was
/// before the change the director asked for.
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

/// A hand-arranged board has no bound on how much type the director dropped on
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
