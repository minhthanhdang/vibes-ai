import { test } from "node:test";
import assert from "node:assert/strict";

import { ADD_PAGE, REWORD_ON_BOARD, SWAP_ON_BOARD } from "@/lib/agent/orchestrator/board-tools";
import { orchestratorTools } from "@/lib/agent/orchestrator/tools";
import {  } from "@/lib/layout/moodboard-layouts";

const toolNames = (state: { photographs?: number; crops?: number; boards?: number }) =>
  orchestratorTools({ photographs: 0, crops: 0, boards: 0, ...state }).map((tool) => tool.name);

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

/// The board half of the same declaration. Its "do not call swap_on_board"
/// clause was there before this change and reads as current on either wording,
/// which is what makes the rest of the sentence worth pinning: the swap used to
/// happen when the user accepted the cut, and it now happens in the call.
test("crop_reference's board parameters say the swap is made in the call", () => {
  const properties = declared({ photographs: 4, crops: 1, boards: 1 }, "crop_reference")
    .properties;
  const boardId = String(properties.boardId?.description);
  const pageId = String(properties.pageId?.description);

  assert.match(boardId, /takes that picture's place there in this same call/);
  assert.match(boardId, /do not call swap_on_board for it afterwards/);
  assert.match(pageId, /is swapped in there/);

  for (const [where, offered] of [
    [boardId, "the moment the user accepts it"],
    [boardId, "tell them to take the cut and the board follows"],
    [pageId, "lands there when the user takes it"],
  ] as const) {
    assert.ok(!where.includes(offered), `the model is still told “${offered}”`);
  }
});

test("a project with nothing in it is given the one tool that needs nothing", () => {
  /// Every declaration is schema and prose re-sent on every round, and on an
  /// empty project every one that takes an id can only answer "no reference
  /// called that". generate_image takes none, and it is how the project stops
  /// being empty — so it is the exception, and the only one.
  assert.deepEqual(toolNames({}), ["generate_image"]);
});

test("generate_image is declared on every shape of project, and last", () => {
  /// Ungated is the whole point: the count that would gate it is the one count
  /// the tool does not read.
  for (const state of [{}, { photographs: 3 }, { crops: 2 }, { photographs: 5, boards: 1 }]) {
    const names = toolNames(state);
    assert.equal(names.at(-1), "generate_image", JSON.stringify(state));
  }
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
  assert.ok(!toolNames({ photographs: 5 }).includes("list_boards"));
  assert.ok(toolNames({ photographs: 5 }).includes("compose_moodboard"));

  assert.deepEqual(toolNames({ photographs: 5, boards: 1 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "list_boards",
    "get_board_brief",
    "inspect_board",
    "add_page",
    "duplicate_page",
    "resize_page",
    "duplicate_board",
    "swap_on_board",
    "reword_on_board",
    "move_to_page",
    "set_page_background",
    "set_canvas_background",
    "read_canvas",
    "put_on_canvas",
    "remove_from_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "restyle_on_canvas",
    "discard_page",
    "discard_board",
    "compose_moodboard",
    "design_page",
    "generate_image",
  ]);
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

/// The routing rule, which is the whole reason this declaration is the largest
/// in the file: a model that cannot tell a design from a rebuild will
/// reach for the expensive one every time, and the expensive one is a loop.
test("design_page carries the three asks that are not compose_moodboard's", () => {
  const { description } = declared({ photographs: 4, boards: 1 }, "design_page");

  /// The kind of thing, the words a template cannot answer, and the page that
  /// needs judgement rather than reassignment.
  assert.match(description, /a sign, a banner, an album spread, a poster, a cover/);
  assert.match(description, /a template cannot answer/);
  assert.match(description, /judgement rather than reassignment/);

  /// And the other half of the decision, said as plainly: the cheap tool is
  /// still the right one for the ask it was built for.
  assert.match(description, /compose_moodboard stays the answer/);
  assert.match(description, /A grid of nine is not a design problem/);

  /// What it costs, before it is called rather than after — and the routing
  /// sentence that took the ceiling's place, which is what the ceiling was
  /// standing in for all along.
  assert.match(description, /order of magnitude/);
  assert.match(description, /call it for the page they actually asked for/);
});

test("design_page needs a board and the user's own words, and nothing else", () => {
  const tool = toolsFor({ photographs: 4, boards: 1 }).find(({ name }) => name === "design_page");
  assert.deepEqual(tool!.parameters.required, ["boardId", "intention"]);

  const { properties } = declared({ photographs: 4, boards: 1 }, "design_page");
  /// The page and the fresh page are both optional and mean different things
  /// together — the one pair of arguments in this call with four readings.
  assert.equal(properties.pageId?.type, "STRING");
  assert.equal(properties.newPage?.type, "BOOLEAN");
  assert.match(String(properties.pageId?.description), /With newPage it means something else/);
  /// The intention is passed rather than paraphrased: it is the only part of
  /// the ask the designer cannot read off the board for itself.
  assert.match(String(properties.intention?.description), /rather than a summary of it/);
});

/// The gate every other id parameter in this file is on, one tool over: a
/// project with no pictures has no ids to fill this with, and the designer can
/// draw its own — so the empty case is coherent rather than crippled.
test("design_page offers imageIds only where the project has pictures", () => {
  assert.ok(!declared({ boards: 1 }, "design_page").properties.imageIds);
  assert.ok(declared({ crops: 1, boards: 1 }, "design_page").properties.imageIds);
  assert.match(
    String(declared({ photographs: 2, boards: 1 }, "design_page").properties.imageIds?.description),
    /a decision taken away from the one tool here that is paid to make it/,
  );
});

/// The ceiling that is not there. `DESIGN_CALL_LIMIT` = 1 refused the turn's
/// second design *after* the first page was written, so "a poster and a banner"
/// came back as one page and a paragraph about the other — and the declaration
/// is the only place a per-turn number could still be claimed without one
/// existing, which is the failure this test is for.
test("the declaration claims no per-turn ceiling, because there is not one", () => {
  const { description } = declared({ photographs: 4, boards: 1 }, "design_page");
  assert.doesNotMatch(description, / a turn/);
  assert.doesNotMatch(description, /at most/);
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
    "list_boards",
    "get_board_brief",
    "inspect_board",
    "add_page",
    "duplicate_page",
    "resize_page",
    "duplicate_board",
    "swap_on_board",
    "reword_on_board",
    "move_to_page",
    "set_page_background",
    "set_canvas_background",
    "read_canvas",
    "put_on_canvas",
    "remove_from_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "restyle_on_canvas",
    "discard_page",
    "discard_board",
    /// Declared here and `compose_moodboard` is not: a design is put *onto* a
    /// board that already exists, and the picture on it can be one it draws.
    "design_page",
    "generate_image",
  ]);
});
