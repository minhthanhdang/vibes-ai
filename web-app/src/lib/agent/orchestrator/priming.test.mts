import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG_LIMIT, referenceDigest, type ToolReference } from "@/lib/agent/shared/reference";
import { boardLine, boardsList, catalogBrief, currentBoardBrief, PROJECT_BRIEF_LIMIT, projectBrief } from "@/lib/agent/orchestrator/priming";

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

/// The user's own words are the one thing in a turn nothing derived, and
/// they were the one thing the model was never given.
test("the project's brief is primed in the user's own words, with what to do about it", () => {
  const primed = projectBrief({ title: "Cold open", brief: "  Night exteriors,\n  sodium light.  " });

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
  const primed = projectBrief({ title: "Untitled", brief: "" });

  assert.match(primed, /has not written a brief for it\.$/);
  /// The note is the expensive half, and it is about a value this project does
  /// not have.
  assert.equal(primed.includes("wins where the two disagree"), false);
  assert.equal(projectBrief({ title: "  ", brief: null }).includes("“Untitled project”"), true);
});

/// The column holds 5,000 characters and every one of them is paid on every
/// model call of every turn — but a brief cut in silence is the model answering
/// from half of what the user wrote.
test("a brief longer than the limit is cut on a word, and the cut is said out loud", () => {
  const long = "sodium ".repeat(400).trim();
  const primed = projectBrief({ title: "Cold open", brief: long });
  const body = primed.split("\n")[1];

  assert.ok(body.length <= PROJECT_BRIEF_LIMIT);
  assert.equal(body.endsWith("sodium"), true);
  assert.match(primed, new RegExp(`first ${body.length} characters of a longer brief`));
});

test("a brief that fits carries no truncation sentence", () => {
  assert.equal(
    projectBrief({ title: "Cold open", brief: "Night exteriors." }).includes("longer brief"),
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

/// The one board the priming carries, said by the id a rebuild is asked for by.
/// Every other board of the project is behind `list_boards` now, so this line is
/// the only id the model is handed for free — and it is the board the message is
/// nearly always about.
test("the brief names the board the user has open by the id a rebuild is asked for by", () => {
  const brief = currentBoardBrief(
    { id: "board-1", title: "Act two", width: 1920, height: 1080 },
    1,
  );
  const [head, line] = brief.split("\n");

  assert.equal(head, "The project holds 1 board. The one the user has open:");
  assert.equal(line, "board-1 · Act two · 1920×1080");
});

/// The count is the half of this that the line cannot say: a model told about
/// one board and nothing else would answer "which other boards?" out of the
/// conversation. It is said with the two tools that reach them, because a
/// number with no door behind it is the truncation the old brief was.
test("the brief says how many boards there are and how the others are reached", () => {
  const brief = currentBoardBrief(
    { id: "board-1", title: "Act two", width: 1920, height: 1080 },
    4,
  );

  assert.match(brief, /^The project holds 4 boards\. The one the user has open:/);
  assert.match(brief, /list_boards/);
  assert.match(brief, /get_board_brief/);
});

/// And not said on a project of one: the two tools could only answer the line
/// above them, and a tool named to a model is a round it will spend.
test("the only board there is comes with no offer to look for another", () => {
  const brief = currentBoardBrief(
    { id: "board-1", title: "Act two", width: 1920, height: 1080 },
    1,
  );
  assert.ok(!brief.includes("list_boards"));
  assert.ok(!brief.includes("get_board_brief"));
});

/// A message sent from a project page, or from a tab whose board was deleted in
/// another one — the id is not validated against the project, so both arrive
/// here as no board. What must not happen is the model reading that as a project
/// with no boards, so the count is said either way and the doors with it.
test("a message sent with no board open still says how many boards there are", () => {
  const brief = currentBoardBrief(null, 3);

  assert.match(brief, /^The project holds 3 boards, none of them open in front of the user\./);
  assert.match(brief, /list_boards/);
});

/// The template rides on the line so the model can tell a change of shape from a
/// change of contents before it asks for either — and a board with none is one
/// the user dragged together, which is a fact about it rather than a gap.
test("a board's template is on its line when it has one", () => {
  assert.equal(
    boardLine({ id: "board-1", title: "Act two", width: 1920, height: 1080, layout: "HERO_LEFT" }),
    "board-1 · Act two · 1920×1080 · HERO_LEFT",
  );
  assert.equal(
    boardLine({ id: "board-2", title: "Scraps", width: 1920, height: 1080, layout: null }),
    "board-2 · Scraps · 1920×1080",
  );
});

/// Every page-scoped tool tells the model to pass a pageId "on a board of more
/// than one page". Until the line said so there was nothing in the whole prompt
/// that could answer which boards those are.
test("a board of more than one page says so on its line", () => {
  assert.equal(
    boardLine({
      id: "board-1",
      title: "Act two",
      width: 1920,
      height: 1080,
      layout: "SPLIT",
      pages: 3,
    }),
    "board-1 · Act two · 1920×1080 · SPLIT · 3 pages",
  );
});

/// A board of one page *is* that page — its size is already on the line and
/// there is no id to choose between — so the segment is dropped rather than
/// written as "1 page", and every board in the app that has never been given a
/// second page keeps the line it always had.
test("a board of one page says nothing about pages", () => {
  assert.equal(
    boardLine({ id: "board-1", title: "Act two", width: 1920, height: 1080, pages: 1 }),
    "board-1 · Act two · 1920×1080",
  );
  assert.equal(
    boardLine({ id: "board-2", title: "Scraps", width: 1920, height: 1080, pages: 0 }),
    "board-2 · Scraps · 1920×1080",
  );
});

/// The names are what routes a sentence to a board: "put the stairwell on the
/// exteriors page" names no board and no id, and without them the model has to
/// read every spread in the project to find out which one the user meant.
test("a spread's line says what its pages are called", () => {
  /// The unnamed one by its ordinal and unquoted: quoting "Page 3" would put a
  /// name on the page the canvas does not draw above it.
  assert.equal(
    boardLine({
      id: "board-1",
      title: "Act two",
      width: 1920,
      height: 1080,
      layout: "SPLIT",
      pages: 3,
      pageNames: ["Act one", "Exteriors", ""],
    }),
    "board-1 · Act two · 1920×1080 · SPLIT · 3 pages: “Act one”, “Exteriors”, page 3",
  );
});

/// A row written before the names were stored carries none, and one whose names
/// disagree with its count would have the model choosing between pages that are
/// not the board's. Both degrade to the count alone, which is the line as it
/// stood before names reached the prompt.
test("a board whose names do not answer for its pages says only how many", () => {
  assert.equal(
    boardLine({ id: "board-1", title: "Act two", width: 1920, height: 1080, pages: 2, pageNames: [] }),
    "board-1 · Act two · 1920×1080 · 2 pages",
  );
  assert.equal(
    boardLine({
      id: "board-2",
      title: "Scraps",
      width: 1920,
      height: 1080,
      pages: 3,
      pageNames: ["Act one", "Exteriors"],
    }),
    "board-2 · Scraps · 1920×1080 · 3 pages",
  );
});

/// A board built up all week is not a line any more. What is dropped is counted,
/// which is the one cap left on this line now that the boards themselves have
/// none.
test("a board of many pages names the first few and counts the rest", () => {
  assert.equal(
    boardLine({
      id: "board-1",
      title: "Act two",
      width: 1920,
      height: 1080,
      pages: 8,
      pageNames: ["a", "b", "c", "d", "e", "f", "g", "h"],
    }),
    "board-1 · Act two · 1920×1080 · 8 pages: “a”, “b”, “c”, “d”, “e”, “f”, +2 more",
  );
});

/// A board of one page keeps the line it always had: the page is the board, and
/// naming it would be the board's own line said twice.
test("a board of one page is not named page by page", () => {
  assert.equal(
    boardLine({
      id: "board-1",
      title: "Act two",
      width: 1920,
      height: 1080,
      pages: 1,
      pageNames: ["Act one"],
    }),
    "board-1 · Act two · 1920×1080",
  );
});

test("a board nobody has named is still a pointable line", () => {
  assert.equal(
    boardLine({ id: "board-1", title: "  ", width: 2048, height: 2048 }),
    "board-1 · Untitled board · 2048×2048",
  );
});

/// The cap that used to sit here was on the instruction, where six was already
/// generous. `list_boards` is paid for once by the model that asked, so there is
/// no number at all — a project of forty boards answers with forty lines rather
/// than with six and a board the assistant cannot see.
test("the list of boards is capped at nothing and reads as the priming does", () => {
  const boards = Array.from({ length: 40 }, (_, index) => ({
    id: `board-${index}`,
    title: `Board ${index}`,
    width: 1920,
    height: 1080,
  }));
  const lines = boardsList(boards);

  assert.equal(lines.length, 40);
  assert.equal(lines[39], "board-39 · Board 39 · 1920×1080");
  /// The same text the priming carries, which is what lets the instruction say
  /// nothing about which of the two the model is holding.
  assert.ok(currentBoardBrief(boards[7]!, 40).includes(lines[7]!));
});

/// A project with no boards says nothing at all rather than a line about
/// nothing: the brief is appended to every message of every turn, and the empty
/// case is the common one.
test("a project with no boards adds nothing to the brief", () => {
  assert.equal(currentBoardBrief(null, 0), "");
  assert.deepEqual(boardsList([]), []);
});
