import { test } from "node:test";
import assert from "node:assert/strict";

import { ADD_PAGE, REWORD_ON_BOARD, SWAP_ON_BOARD } from "@/lib/agent/orchestrator/board-tools";
import {
  DESIGNER_REWORD_ON_BOARD,
  DESIGNER_SWAP_ON_BOARD,
} from "@/lib/agent/designer/board-tools";
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

/// The page tool whose neighbours are both destructive: `add_page` next to
/// `design_page`'s `pageId` (which re-decides a page that already exists) and
/// its `newPage` (which decides what goes on the new one). A model reading this
/// one as either of those has a board designed that nobody asked to have
/// designed.
test("add_page says it draws a page and lays nothing out, and never replaces the page it is given", () => {
  const properties = declared({ photographs: 4, boards: 1 }, "add_page").properties;

  assert.deepEqual(ADD_PAGE.parameters.required, ["boardId"]);
  assert.match(String(ADD_PAGE.description), /lays nothing out/);
  /// The one sentence that sends the hand-made board here rather than to a
  /// rebuild, which is the case the tool exists for.
  assert.match(String(ADD_PAGE.description), /arranged by hand/);
  /// And the boundary with the tool beside it: pictures on a new page is a
  /// design, an empty page is this.
  assert.match(String(ADD_PAGE.description), /design_page with newPage/);
  assert.match(String(properties.pageId?.description), /goes beside/);
  assert.match(String(properties.pageId?.description), /never replaces/);
  assert.ok(properties.name, "the user's own name for the page can be passed");
});

/// The two scene edits, on a board that is pages now. Both name what they change
/// by its content — a reference id, a quoted line — and a spread carries both
/// twice as a matter of course, so the page is the only thing that says which
/// copy the user meant.
///
/// Held over the *declarations* rather than over agent 6's list, because they
/// are not on that list any more: object-level editing is agent 8's, and these
/// two are what agent 8 was handed (`designer/board-tools.ts`). The shape they
/// are asserted in is unchanged, which is the point — one wire name, one
/// executor, one set of arguments.
test("swap_on_board and reword_on_board take the page the edit is on", () => {
  const properties = (declaration: typeof SWAP_ON_BOARD) =>
    declaration.parameters.properties as Record<string, { description?: string } | undefined>;
  const swap = properties(SWAP_ON_BOARD);
  const reword = properties(REWORD_ON_BOARD);

  /// Optional, because every board this app has filed until now is one page and
  /// asking for an id on those is a round spent learning what the board already
  /// said.
  assert.deepEqual(SWAP_ON_BOARD.parameters.required, ["boardId", "swaps"]);
  assert.deepEqual(REWORD_ON_BOARD.parameters.required, ["boardId", "rewordings"]);
  /// And agent 8's own descriptions take the same arguments in the same places.
  assert.deepEqual(DESIGNER_SWAP_ON_BOARD.parameters.required, SWAP_ON_BOARD.parameters.required);
  assert.deepEqual(
    DESIGNER_REWORD_ON_BOARD.parameters.required,
    REWORD_ON_BOARD.parameters.required,
  );

  /// What a model has to be told to reach for it: without a page the copy edited
  /// is the first the board carries, which is a guess.
  for (const said of [
    swap.pageId?.description,
    reword.pageId?.description,
    properties(DESIGNER_SWAP_ON_BOARD).pageId?.description,
    properties(DESIGNER_REWORD_ON_BOARD).pageId?.description,
  ]) {
    assert.match(String(said), /more than one page/);
  }
  /// And the one thing the swap's page scoping decides that is not obvious: a
  /// picture on another page joins this one rather than trading across the board.
  assert.match(String(swap.pageId?.description), /rather than trading across/);
});

/// Neither is declared to agent 6 any more, and the rule that took them off is
/// one sentence: agent 6 interacts with boards and pages, and object-level
/// editing is agent 8's. A swap replaces one picture object and a reword
/// rewrites one text object.
test("agent 6 is handed no tool that edits a thing standing on a page", () => {
  const given = new Set(toolNames({ photographs: 4, crops: 2, boards: 2 }));
  for (const retired of [
    "swap_on_board",
    "reword_on_board",
    "move_to_page",
    "set_page_background",
    "put_on_canvas",
    "remove_from_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "restyle_on_canvas",
  ]) {
    assert.ok(!given.has(retired), `${retired} is still agent 6's`);
  }
  /// The read stays: "which of these did they mean" is a question agent 6 has to
  /// answer without buying a design.
  assert.ok(given.has("read_canvas"));
  /// And so does the board's own ground, which is the surface rather than a
  /// thing standing on it.
  assert.ok(given.has("set_canvas_background"));
});

/// The board half of the same declaration. Its "do not call swap_on_board"
/// clause was there before this change and read as current on either wording,
/// which is what made the rest of the sentence worth pinning: the swap used to
/// happen when the user accepted the cut, and it now happens in the call.
///
/// The clause itself is gone with the tool — agent 6 has no swap to be warned
/// off, and this call is the one edit to a thing standing on a page it still
/// makes for itself. What is asserted is the fact under it, which never changed.
test("crop_reference's board parameters say the swap is made in the call", () => {
  const properties = declared({ photographs: 4, crops: 1, boards: 1 }, "crop_reference")
    .properties;
  const boardId = String(properties.boardId?.description);
  const pageId = String(properties.pageId?.description);

  assert.match(boardId, /takes that picture's place there in this same call/);
  assert.match(boardId, /the exchange is already made/);
  assert.ok(!boardId.includes("swap_on_board"));
  assert.match(pageId, /is swapped in there/);

  for (const [where, offered] of [
    [boardId, "the moment the user accepts it"],
    [boardId, "tell them to take the cut and the board follows"],
    [pageId, "lands there when the user takes it"],
  ] as const) {
    assert.ok(!where.includes(offered), `the model is still told “${offered}”`);
  }
});

test("a project with nothing in it is given the two tools that need nothing", () => {
  /// Every declaration is schema and prose re-sent on every round, and on an
  /// empty project every one that takes an id can only answer "no reference
  /// called that". These two take none: `generate_image` is how the project
  /// stops having no pictures and `add_board` is how it stops having no boards,
  /// so between them they are the whole of what an empty project can be
  /// answered by.
  assert.deepEqual(toolNames({}), ["add_board", "generate_image"]);
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
    "add_board",
    "generate_image",
  ]);
  assert.deepEqual(toolNames({ photographs: 3, crops: 1 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "add_board",
    "generate_image",
  ]);
});

test("the board tools arrive with the first board, and add_board is there before it", () => {
  /// inspect_board, swap_on_board and design_page all take a board id, and the
  /// only ids there are come from the boards brief — so before the first board
  /// they are tools that can only be called wrong. add_board is what makes it,
  /// and it is the one that cannot be gated on the count it creates.
  assert.ok(!toolNames({ photographs: 5 }).includes("inspect_board"));
  assert.ok(!toolNames({ photographs: 5 }).includes("list_boards"));
  assert.ok(!toolNames({ photographs: 5 }).includes("design_page"));
  assert.ok(toolNames({ photographs: 5 }).includes("add_board"));

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
    "set_canvas_background",
    "read_canvas",
    "discard_page",
    "discard_board",
    "design_page",
    "add_board",
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

test("a cut is a picture: a project of nothing but crops can still be shown and designed onto", () => {
  assert.deepEqual(toolNames({ crops: 2 }), [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "read_references",
    "add_board",
    "generate_image",
  ]);
});

/// The routing rule this declaration used to carry — when to reach for a design
/// rather than for `compose_moodboard` — is gone with agent 4. What is left is
/// the pair of facts that were never about routing: there is one way a page is
/// laid out, and it is the dearest call in the table, so the free scene edits
/// are what a one-thing change reaches for.
test("design_page says it is the only way a page is laid out, and what that costs", () => {
  const { description } = declared({ photographs: 4, boards: 1 }, "design_page");

  assert.match(description, /the only way a page is laid out/);
  /// Every kind of thing, rather than the kinds a template could not do.
  assert.match(description, /a moodboard, a grid, a sign, a banner, an album spread/);
  assert.match(description, /a template cannot answer|nothing else here can act on/);

  /// It used to name the cheap edits so that a page was not re-decided to move
  /// one picture. Those tools are agent 8's now, so the sentence is the other
  /// way round: this is the only door to a thing standing on a page, and it has
  /// to say it takes a one-thing change as readily as a whole page — or a model
  /// reading "the dearest call you have" talks the user out of a typo fix.
  for (const retired of ["swap_on_board", "move_to_page", "reword_on_board", "put_on_canvas"]) {
    assert.ok(!description.includes(retired), `${retired} is named and cannot be called`);
  }
  assert.match(description, /the only way anything already standing on a page is changed/);
  assert.match(description, /which one thing they asked to change/);

  /// What it costs, before it is called rather than after.
  assert.match(description, /order of magnitude/);
  assert.match(description, /call it for the page they actually asked for/);

  /// The tool that has to come first on a project with no board, since the gate
  /// is a count only that tool can change.
  assert.match(description, /add_board is where a board comes from/);

  /// And the report, which is the half of the answer agent 6 writes its reply
  /// off — the thing a compose used to hand back and a design did not.
  assert.match(description, /a read of the page it left/);

  /// The retired neighbour is named nowhere.
  assert.ok(!description.includes("compose_moodboard"));
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
/// The names that were agent 6's and are not any more. Written out rather than
/// derived, because the test below builds its list from the *surviving* tools —
/// so a name that stops being declared stops being checked, which is exactly the
/// moment a description naming it becomes a round the model spends calling
/// something it has not got. Every one of these is still a real tool: agent 8
/// holds it, and the executor still answers to it.
const RETIRED = [
  "swap_on_board",
  "reword_on_board",
  "move_to_page",
  "set_page_background",
  "put_on_canvas",
  "remove_from_canvas",
  "transform_on_canvas",
  "reorder_on_canvas",
  "restyle_on_canvas",
  /// Retired with agent 4, before any of the above.
  "compose_moodboard",
];

test("no declaration names a tool this project was not given", () => {
  const everyName = [
    ...toolsFor({ photographs: 4, crops: 2, boards: 2 }).map((tool) => tool.name),
    ...RETIRED,
  ];

  /// The one exception, and it is the rule's own reason inverted: `add_board`
  /// names `design_page` on a project with no boards, and calling `add_board` is
  /// exactly what makes `design_page` declarable on the round after. The
  /// declarations are resolved per round, so this is a tool the model *will* be
  /// able to call and not one it will try and fail to. Every other declaration
  /// is held to the rule.
  const routesToItsOwnGate = new Map([["add_board", "design_page"]]);

  for (const state of [
    { photographs: 4 },
    { photographs: 4, crops: 2 },
    { photographs: 4, boards: 2 },
    { photographs: 4, crops: 2, boards: 2 },
  ]) {
    const tools = toolsFor(state);
    const given = new Set(tools.map((tool) => tool.name));
    for (const tool of tools) {
      const allowed = routesToItsOwnGate.get(tool.name);
      const said = JSON.stringify(tool);
      for (const name of everyName) {
        if (given.has(name) || name === allowed) continue;
        assert.ok(
          !said.includes(name),
          `${tool.name} names ${name}, which this project cannot call`,
        );
      }
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
    "set_canvas_background",
    "read_canvas",
    "discard_page",
    "discard_board",
    /// A design is put *onto* a board that already exists, and the picture on
    /// it can be one it draws — so a board with an empty gallery is still a
    /// board this can work.
    "design_page",
    /// Ungated, so it is here as well: a project with a board can still want a
    /// second one.
    "add_board",
    "generate_image",
  ]);
});
