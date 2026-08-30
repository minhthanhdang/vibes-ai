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

test("the project's brief is primed in the user's own words, with what to do about it", () => {
  const primed = projectBrief({ title: "Cold open", brief: "  Night exteriors,\n  sodium light.  " });

  assert.match(primed, /This project is called “Cold open”\./);
  assert.match(primed, /Night exteriors, sodium light\./);
  assert.match(primed, /What they say in this conversation wins/);
  assert.match(primed, /You cannot write or change the brief/);
});

test("a project with no brief says so rather than saying nothing", () => {
  const primed = projectBrief({ title: "Untitled", brief: "" });

  assert.match(primed, /has not written a brief for it\.$/);
  assert.equal(primed.includes("wins where the two disagree"), false);
  assert.equal(projectBrief({ title: "  ", brief: null }).includes("“Untitled project”"), true);
});

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

test("a picture the user starred is marked, and an ordinary one carries nothing", () => {
  const [, starred] = catalogBrief([reference({ favorite: true })]).split("\n");
  assert.equal(starred, "ref-1 · Hallway · starred · 16:9");

  const [, plain] = catalogBrief([reference()]).split("\n");
  assert.equal(plain, "ref-1 · Hallway · 16:9");
  assert.equal(referenceDigest(reference({ favorite: false })).favorite, undefined);
});

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

test("the note under the list appears only when something is marked", () => {
  const marked = catalogBrief([reference({ unread: "pending" }), reference({ id: "ref-2" })]);
  assert.match(marked, /1 of these has not been read by the property analyzer/);
  assert.match(marked, /still being read and will have tags in a moment/);
  assert.match(marked, /can still be shown, cropped and put on a board/);

  const clean = catalogBrief([reference(), reference({ id: "ref-2" })]);
  assert.equal(clean.includes("property analyzer"), false);
  assert.equal(clean.split("\n").length, 3);
});

test("the note gives a waiting run and a stalled one different next steps", () => {
  const failed = catalogBrief([reference({ unread: "failed" })]);
  assert.match(failed, /1 of these has not been read/);
  assert.equal(failed.includes("in a moment"), false);
  assert.match(failed, /will not get tags on their own/);

  const pending = catalogBrief([reference({ unread: "pending" })]);
  assert.match(pending, /in a moment/);
  assert.equal(pending.includes("will not get tags on their own"), false);
});

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

test("the brief names the board the user has open by the id a rebuild is asked for by", () => {
  const brief = currentBoardBrief(
    { id: "board-1", title: "Act two", width: 1920, height: 1080 },
    1,
  );
  const [head, line] = brief.split("\n");

  assert.equal(head, "The project holds 1 board. The one the user has open:");
  assert.equal(line, "board-1 · Act two · 1920×1080");
});

test("the brief says how many boards there are and how the others are reached", () => {
  const brief = currentBoardBrief(
    { id: "board-1", title: "Act two", width: 1920, height: 1080 },
    4,
  );

  assert.match(brief, /^The project holds 4 boards\. The one the user has open:/);
  assert.match(brief, /list_boards/);
  assert.match(brief, /get_board_brief/);
});

test("the only board there is comes with no offer to look for another", () => {
  const brief = currentBoardBrief(
    { id: "board-1", title: "Act two", width: 1920, height: 1080 },
    1,
  );
  assert.ok(!brief.includes("list_boards"));
  assert.ok(!brief.includes("get_board_brief"));
});

test("a message sent with no board open still says how many boards there are", () => {
  const brief = currentBoardBrief(null, 3);

  assert.match(brief, /^The project holds 3 boards, none of them open in front of the user\./);
  assert.match(brief, /list_boards/);
});

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

test("a spread's line says what its pages are called", () => {
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
  assert.ok(currentBoardBrief(boards[7]!, 40).includes(lines[7]!));
});

test("a project with no boards adds nothing to the brief", () => {
  assert.equal(currentBoardBrief(null, 0), "");
  assert.deepEqual(boardsList([]), []);
});
