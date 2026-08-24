import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSE_MOODBOARD,
  composeMoodboardFor,
} from "@/lib/agent/orchestrator/deprecated/compose-tools";
import { LAYOUT_REQUESTS, LAYOUTS_WITH_TEXT } from "@/lib/layout/moodboard-layouts";

/// Agent 4's declaration, retired and unreachable — nothing lists it and
/// nothing dispatches it. Tested anyway, and for the reason the file is kept at
/// all: these are the assertions that say what a template-shaped compositor had
/// to be told, and the day one is wanted again they are worth more than the diff
/// that deleted them. The three that follow used to live in
/// `orchestrator/tools.test.mts` and read the declaration out of
/// `orchestratorTools`; they read it off `composeMoodboardFor` now, which is the
/// only door left.
const declared = (state: { photographs?: number; crops?: number; boards?: number }) => {
  const tool = composeMoodboardFor({ photographs: 0, crops: 0, boards: 0, ...state });
  return {
    description: tool.description,
    properties: tool.parameters.properties as Record<
      string,
      { description?: string; type?: string } | undefined
    >,
  };
};

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
  const properties = declared({ photographs: 4, boards: 1 }).properties;

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
  const properties = declared({ photographs: 4, boards: 1 }).properties;

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

/// The gating that made the tool *list* a function of the project stops at the
/// declaration's edge unless it is carried inside it: eight of compose's thirteen
/// parameters are about rebuilding a board, which a project with none cannot do —
/// and a `pageId` is one of them twice over, since a page id only exists on a
/// board that has already been composed — as are `newPage` and `pageName`, which
/// are a page added to a board and a page of one renamed rather than a board.
test("the rebuild half of compose_moodboard arrives with the first board", () => {
  const before = declared({ photographs: 4 });
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

  const after = declared({ photographs: 4, boards: 1 });
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
