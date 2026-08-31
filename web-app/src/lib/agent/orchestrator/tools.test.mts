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

test("add_page says it draws a page and lays nothing out, and never replaces the page it is given", () => {
  const properties = declared({ photographs: 4, boards: 1 }, "add_page").properties;

  assert.deepEqual(ADD_PAGE.parameters.required, ["boardId"]);
  assert.match(String(ADD_PAGE.description), /lays nothing out/);
  assert.match(String(ADD_PAGE.description), /arranged by hand/);
  assert.match(String(ADD_PAGE.description), /design_page with newPage/);
  assert.match(String(properties.pageId?.description), /goes beside/);
  assert.match(String(properties.pageId?.description), /never replaces/);
  assert.ok(properties.name, "the user's own name for the page can be passed");
});

test("swap_on_board and reword_on_board take the page the edit is on", () => {
  const properties = (declaration: typeof SWAP_ON_BOARD) =>
    declaration.parameters.properties as Record<string, { description?: string } | undefined>;
  const swap = properties(SWAP_ON_BOARD);
  const reword = properties(REWORD_ON_BOARD);

  assert.deepEqual(SWAP_ON_BOARD.parameters.required, ["boardId", "swaps"]);
  assert.deepEqual(REWORD_ON_BOARD.parameters.required, ["boardId", "rewordings"]);
  assert.deepEqual(DESIGNER_SWAP_ON_BOARD.parameters.required, SWAP_ON_BOARD.parameters.required);
  assert.deepEqual(
    DESIGNER_REWORD_ON_BOARD.parameters.required,
    REWORD_ON_BOARD.parameters.required,
  );

  for (const said of [
    swap.pageId?.description,
    reword.pageId?.description,
    properties(DESIGNER_SWAP_ON_BOARD).pageId?.description,
    properties(DESIGNER_REWORD_ON_BOARD).pageId?.description,
  ]) {
    assert.match(String(said), /more than one page/);
  }
  assert.match(String(swap.pageId?.description), /rather than trading across/);
});

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
  assert.ok(given.has("read_canvas"));
  assert.ok(given.has("set_canvas_background"));
});

test("edit_reference's board parameters say the swap is made in the call", () => {
  const properties = declared({ photographs: 4, crops: 1, boards: 1 }, "edit_reference")
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
  assert.deepEqual(toolNames({}), ["add_board", "generate_image"]);
});

test("generate_image is declared on every shape of project, and last", () => {
  for (const state of [{}, { photographs: 3 }, { crops: 2 }, { photographs: 5, boards: 1 }]) {
    const names = toolNames(state);
    assert.equal(names.at(-1), "generate_image", JSON.stringify(state));
  }
});

test("list_references is declared for any project with a picture in it", () => {
  assert.deepEqual(toolNames({ photographs: 3 }), [
    "list_references",
    "show_references",
    "edit_reference",
    "discard_reference",
    "read_references",
    "add_board",
    "generate_image",
  ]);
  assert.deepEqual(toolNames({ photographs: 3, crops: 1 }), [
    "list_references",
    "show_references",
    "edit_reference",
    "discard_reference",
    "read_references",
    "add_board",
    "generate_image",
  ]);
});

test("the board tools arrive with the first board, and add_board is there before it", () => {
  assert.ok(!toolNames({ photographs: 5 }).includes("inspect_board"));
  assert.ok(!toolNames({ photographs: 5 }).includes("list_boards"));
  assert.ok(!toolNames({ photographs: 5 }).includes("design_page"));
  assert.ok(toolNames({ photographs: 5 }).includes("add_board"));

  assert.deepEqual(toolNames({ photographs: 5, boards: 1 }), [
    "list_references",
    "show_references",
    "edit_reference",
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

test("read_references arrives with the first picture, whether or not anything is unread", () => {
  assert.ok(toolNames({ photographs: 3 }).includes("read_references"));
  assert.ok(toolNames({ crops: 1 }).includes("read_references"));
  assert.ok(!toolNames({}).includes("read_references"));
});

test("a cut is a picture: a project of nothing but crops can still be shown and designed onto", () => {
  assert.deepEqual(toolNames({ crops: 2 }), [
    "list_references",
    "show_references",
    "edit_reference",
    "discard_reference",
    "read_references",
    "add_board",
    "generate_image",
  ]);
});

test("design_page says it is the only way a page is laid out, and what to call it for", () => {
  const { description } = declared({ photographs: 4, boards: 1 }, "design_page");

  assert.match(description, /the only way a page is laid out/);
  assert.match(description, /a moodboard, a grid, a sign, a banner, an album spread/);
  assert.match(description, /a template cannot answer|nothing else here can act on/);

  for (const retired of ["swap_on_board", "move_to_page", "reword_on_board", "put_on_canvas"]) {
    assert.ok(!description.includes(retired), `${retired} is named and cannot be called`);
  }
  assert.match(description, /the only way anything already standing on a page is changed/);
  assert.match(description, /which one thing they asked to change/);

  assert.match(description, /call it for the page they actually asked for/);

  assert.match(description, /add_board is where a board comes from/);

  assert.match(description, /a read of the page it left/);

  assert.ok(!description.includes("compose_moodboard"));
});

test("design_page needs a board and the user's own words, and nothing else", () => {
  const tool = toolsFor({ photographs: 4, boards: 1 }).find(({ name }) => name === "design_page");
  assert.deepEqual(tool!.parameters.required, ["boardId", "intention"]);

  const { properties } = declared({ photographs: 4, boards: 1 }, "design_page");
  assert.equal(properties.pageId?.type, "STRING");
  assert.equal(properties.newPage?.type, "BOOLEAN");
  assert.match(String(properties.pageId?.description), /With newPage it means something else/);
  assert.match(String(properties.intention?.description), /rather than a summary of it/);
});

test("design_page offers imageIds only where the project has pictures", () => {
  assert.ok(!declared({ boards: 1 }, "design_page").properties.imageIds);
  assert.ok(declared({ crops: 1, boards: 1 }, "design_page").properties.imageIds);
  assert.match(
    String(declared({ photographs: 2, boards: 1 }, "design_page").properties.imageIds?.description),
    /a decision taken away from the one tool here that is paid to make it/,
  );
});

test("the declaration claims no per-turn ceiling, because there is not one", () => {
  const { description } = declared({ photographs: 4, boards: 1 }, "design_page");
  assert.doesNotMatch(description, / a turn/);
  assert.doesNotMatch(description, /at most/);
});

test("edit_reference takes a board only where there are boards, and a cut only where there are cuts", () => {
  const plain = declared({ photographs: 4 }, "edit_reference");
  assert.ok(!plain.properties.boardId, "no board to cut for");
  assert.ok(!plain.properties.referenceId?.description?.includes("*cut*"));

  const grown = declared({ photographs: 4, crops: 1, boards: 1 }, "edit_reference");
  assert.ok(grown.properties.boardId);
  assert.match(String(grown.properties.referenceId?.description), /Give the id of a \*cut\*/);
});

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
  "compose_moodboard",
];

test("no declaration names a tool this project was not given", () => {
  const everyName = [
    ...toolsFor({ photographs: 4, crops: 2, boards: 2 }).map((tool) => tool.name),
    ...RETIRED,
  ];

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
    "design_page",
    "add_board",
    "generate_image",
  ]);
});
