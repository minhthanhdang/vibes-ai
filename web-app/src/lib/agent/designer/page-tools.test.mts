import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { DISCARD_PAGE, DUPLICATE_PAGE, MOVE_LIMIT, MOVE_TO_PAGE, RESIZE_PAGE } from "@/lib/agent/orchestrator/board-tools";
import { DESIGNER_DISCARD_PAGE, DESIGNER_DUPLICATE_PAGE, DESIGNER_MOVE_TO_PAGE, DESIGNER_RESIZE_PAGE, GET_PAGE } from "@/lib/agent/designer/page-tools";

test("get_page takes both ids, since a duplicated board carries the same page ids", () => {
  assert.equal(GET_PAGE.name, "get_page");
  assert.deepEqual(GET_PAGE.parameters.required, ["boardId", "pageId"]);
  const { pageId } = GET_PAGE.parameters.properties as Record<string, { description: string }>;
  assert.match(pageId!.description, /never by this one alone/);
});

test("get_page says the picture is drawn on the call and what a box means", () => {
  /// The two things a model cannot work out for itself: that looking again after
  /// an edit shows the edit, and that 500 is halfway whatever the page's size is.
  assert.match(GET_PAGE.description, /after you change a page/);
  assert.match(GET_PAGE.description, /\[ymin, xmin, ymax, xmax\]/);
  assert.match(GET_PAGE.description, /thousandths of the page/);
  assert.match(GET_PAGE.description, /One page per call/);
});

test("get_page promises the words and the picture off one read, and says when there is none", () => {
  assert.match(GET_PAGE.description, /never describe different arrangements/);
  assert.match(GET_PAGE.description, /If the picture could not be drawn the answer says so/);
});

test("duplicate_page keeps agent 6's wire name and arguments", () => {
  /// One tool and one executor: the name and the arguments are the shared
  /// implementation's, and only the prose is agent 8's.
  assert.equal(DESIGNER_DUPLICATE_PAGE.name, DUPLICATE_PAGE.name);
  assert.deepEqual(
    DESIGNER_DUPLICATE_PAGE.parameters.required,
    DUPLICATE_PAGE.parameters.required,
  );
  const keys = (tool: ToolDeclaration) =>
    Object.keys(tool.parameters.properties as Record<string, unknown>);
  assert.deepEqual(keys(DESIGNER_DUPLICATE_PAGE), keys(DUPLICATE_PAGE));
});

test("duplicate_page names no tool agent 8 was not given", () => {
  /// The whole reason the description is written again. Agent 6's ends in five
  /// tools — three to change the copy with, two not to reach for — and agent 8
  /// holds none of them.
  for (const missing of [
    "swap_on_board",
    "reword_on_board",
    "compose_moodboard",
    "duplicate_board",
    "inspect_board",
  ]) {
    assert.doesNotMatch(DESIGNER_DUPLICATE_PAGE.description, new RegExp(missing));
    const { pageId } = DESIGNER_DUPLICATE_PAGE.parameters.properties as Record<
      string,
      { description: string }
    >;
    assert.doesNotMatch(pageId!.description, new RegExp(missing));
  }
});

test("duplicate_page sends agent 8 to the canvas tools it does hold, and to its own reads", () => {
  for (const held of [
    "put_on_canvas",
    "transform_on_canvas",
    "remove_from_canvas",
    "reorder_on_canvas",
  ]) {
    assert.match(DESIGNER_DUPLICATE_PAGE.description, new RegExp(held));
  }
  const { pageId } = DESIGNER_DUPLICATE_PAGE.parameters.properties as Record<
    string,
    { description: string }
  >;
  assert.match(pageId!.description, /read_canvas or get_page/);
});

test("duplicate_page says a copy is free and a copy by hand is not", () => {
  /// The argument for calling it at all. Agent 8 *can* place every picture of a
  /// page again itself, and the boxes it writes are the thing it is worst at —
  /// so the description says the copy lands where the pictures already were.
  assert.match(DESIGNER_DUPLICATE_PAGE.description, /lays nothing out again/);
  assert.match(DESIGNER_DUPLICATE_PAGE.description, /Copying by hand/);
  assert.match(DESIGNER_DUPLICATE_PAGE.description, /variation of a page/);
});

test("resize_page keeps agent 6's wire name, arguments and preset enum", () => {
  /// One tool and one executor. The enum is the part worth pinning beyond the
  /// keys: the three names are what `pagePresetSize` resolves, so a fork that
  /// dropped one would be a shape agent 8 could not ask for at all.
  assert.equal(DESIGNER_RESIZE_PAGE.name, RESIZE_PAGE.name);
  assert.deepEqual(DESIGNER_RESIZE_PAGE.parameters.required, RESIZE_PAGE.parameters.required);
  const props = (tool: ToolDeclaration) =>
    tool.parameters.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(Object.keys(props(DESIGNER_RESIZE_PAGE)), Object.keys(props(RESIZE_PAGE)));
  assert.deepEqual(props(DESIGNER_RESIZE_PAGE).preset!.enum, props(RESIZE_PAGE).preset!.enum);
});

test("resize_page names no tool agent 8 was not given", () => {
  /// The reason the other three page tools are forked, and it is true of this
  /// one twice over: agent 6's sends the model to `inspect_board` for the ids
  /// and warns it off `compose_moodboard` in a clause about templates it does
  /// not have.
  for (const missing of ["inspect_board", "compose_moodboard", "add_page", "duplicate_board"]) {
    assert.doesNotMatch(JSON.stringify(DESIGNER_RESIZE_PAGE), new RegExp(missing));
  }
});

test("resize_page gives the preset names and no page size in pixels", () => {
  /// The other half of the page-shape anchor. The instruction stopped
  /// printing the two shapes agent 8 kept making (`instruction.ts`, above
  /// `PAGES`); this declaration is the other place a design reads them on every
  /// round, and it is agent 6's, so the numbers come out of the copy rather
  /// than out of the original. The names stay: naming one is how the call is
  /// made.
  const written = JSON.stringify(DESIGNER_RESIZE_PAGE);
  for (const preset of ["LANDSCAPE_HD", "PORTRAIT_HD", "SQUARE"]) {
    assert.ok(written.includes(preset), `${preset} is missing or misspelled`);
  }
  assert.deepEqual(written.match(/\b\d{3,4} ?[x\u00d7] ?\d{3,4}\b/g) ?? [], []);
  assert.match(JSON.stringify(RESIZE_PAGE), /1920/);
});

test("resize_page sends the shape decision back to put_on_canvas", () => {
  /// What replaces the pixels rather than merely their absence: three shapes is
  /// a fixed menu and a page agent 8 is about to *make* is not on it, so the
  /// proportion is chosen at the box `put_on_canvas` takes. Both halves of the
  /// declaration say it, because a model that reads only the argument is the one
  /// choosing a shape.
  assert.match(DESIGNER_RESIZE_PAGE.description, /put_on_canvas takes a box of any proportion/);
  const { preset, pageId } = DESIGNER_RESIZE_PAGE.parameters.properties as Record<
    string,
    { description: string }
  >;
  assert.match(preset!.description, /These three and no others/);
  assert.match(preset!.description, /put with put_on_canvas at that box/);
  assert.match(pageId!.description, /read_canvas or get_page/);
});

test("resize_page keeps what agent 6's says about a reshape moving nothing", () => {
  /// The facts of the call, which the fork is not allowed to lose: one executor
  /// answers both agents and a description that promised a different act would
  /// be a second contract over one write.
  assert.match(DESIGNER_RESIZE_PAGE.description, /lay nothing out again/);
  assert.match(DESIGNER_RESIZE_PAGE.description, /a page made smaller leaves pictures beside it/);
  assert.match(
    DESIGNER_RESIZE_PAGE.description,
    /a page made larger takes in whatever it now covers/,
  );
  assert.match(DESIGNER_RESIZE_PAGE.description, /costs nothing and makes no model call/);
});

test("move_to_page keeps agent 6's wire name and arguments", () => {
  assert.equal(DESIGNER_MOVE_TO_PAGE.name, MOVE_TO_PAGE.name);
  assert.deepEqual(DESIGNER_MOVE_TO_PAGE.parameters.required, MOVE_TO_PAGE.parameters.required);
  const keys = (tool: ToolDeclaration) =>
    Object.keys(tool.parameters.properties as Record<string, unknown>);
  assert.deepEqual(keys(DESIGNER_MOVE_TO_PAGE), keys(MOVE_TO_PAGE));
});

test("move_to_page names no tool agent 8 was not given", () => {
  const said = [
    DESIGNER_MOVE_TO_PAGE.description,
    ...Object.values(
      DESIGNER_MOVE_TO_PAGE.parameters.properties as Record<string, { description: string }>,
    ).map(({ description }) => description),
  ].join("\n");
  for (const missing of ["compose_moodboard", "swap_on_board", "inspect_board", "add_page"]) {
    assert.doesNotMatch(said, new RegExp(missing));
  }
});

test("move_to_page argues against the arithmetic rather than against a rebuild", () => {
  /// Agent 6 is told to prefer this over `compose_moodboard`, because a rebuild
  /// is what it would otherwise reach for. Agent 8 would reach for
  /// `transform_on_canvas`, and there the objection is that a box is in
  /// thousandths of the page holding it — so a move across pages is a sum in two
  /// coordinate frames, which is what this agent gets wrong.
  assert.match(DESIGNER_MOVE_TO_PAGE.description, /Do not do it with transform_on_canvas/);
  assert.match(DESIGNER_MOVE_TO_PAGE.description, /thousandths of the page holding it/);
  /// And what it lands as: below what is there rather than composed into it, so
  /// the arranging afterwards is agent 8's own.
  assert.match(DESIGNER_MOVE_TO_PAGE.description, /get_page afterwards/);
  assert.match(
    DESIGNER_MOVE_TO_PAGE.description,
    new RegExp(`At most ${MOVE_LIMIT} pictures a call`),
  );
});

test("move_to_page takes its ids from the reads agent 8 has", () => {
  const { fromPageId, referenceIds } = DESIGNER_MOVE_TO_PAGE.parameters.properties as Record<
    string,
    { description: string }
  >;
  assert.match(fromPageId!.description, /read_canvas or get_page/);
  /// A photograph rather than a handle: the shared implementation moves every
  /// copy of a referenceId off the page, which is not what an objectId means.
  assert.match(referenceIds!.description, /by referenceId rather than by objectId/);
});

test("discard_page keeps agent 6's wire name and arguments", () => {
  assert.equal(DESIGNER_DISCARD_PAGE.name, DISCARD_PAGE.name);
  assert.deepEqual(DESIGNER_DISCARD_PAGE.parameters.required, DISCARD_PAGE.parameters.required);
  const keys = (tool: ToolDeclaration) =>
    Object.keys(tool.parameters.properties as Record<string, unknown>);
  assert.deepEqual(keys(DESIGNER_DISCARD_PAGE), keys(DISCARD_PAGE));
});

test("discard_page names no tool agent 8 was not given", () => {
  const said = [
    DESIGNER_DISCARD_PAGE.description,
    ...Object.values(
      DESIGNER_DISCARD_PAGE.parameters.properties as Record<string, { description: string }>,
    ).map(({ description }) => description),
  ].join("\n");
  /// `discard_board` twice and `inspect_board` once in agent 6's, and agent 8
  /// holds neither — a board is not something it can offer to lose at all.
  for (const missing of ["discard_board", "inspect_board", "add_page"]) {
    assert.doesNotMatch(said, new RegExp(missing));
  }
  assert.match(said, /read_canvas or get_page/);
});

test("discard_page tells agent 8 the answer is the whole of the offer, not half of it", () => {
  /// The one fork that is not about tool names. Agent 6's says the user presses
  /// a button; nothing agent 8 does reaches a user, so the offer is the words
  /// of its closing line — the same sentence `discard_image` carries.
  assert.match(DESIGNER_DISCARD_PAGE.description, /nothing you call ever will/i);
  assert.doesNotMatch(DESIGNER_DISCARD_PAGE.description, /button/i);
  assert.match(DESIGNER_DISCARD_PAGE.description, /closing line/);
  assert.match(DESIGNER_DISCARD_PAGE.description, /never say the page is gone, removed or deleted/);
});

test("discard_page sends the smaller acts to the tools that do them for free", () => {
  /// A page discarded because a few pictures on it are wrong is the loss the
  /// user did not ask for, and both cheaper acts are calls agent 8 holds.
  assert.match(DESIGNER_DISCARD_PAGE.description, /that is remove_from_canvas/);
  assert.match(DESIGNER_DISCARD_PAGE.description, /is move_to_page/);
});
