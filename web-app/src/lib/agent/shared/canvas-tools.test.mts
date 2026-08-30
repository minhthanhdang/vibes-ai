import { test } from "node:test";
import assert from "node:assert/strict";

import { CANVAS_PUT_LIMIT, CANVAS_REMOVE_LIMIT, CANVAS_REORDER_LIMIT, CANVAS_RESTYLE_LIMIT, CANVAS_TRANSFORM_LIMIT, ORCHESTRATOR_READ_CANVAS, PUT_ON_CANVAS, READ_CANVAS, REMOVE_FROM_CANVAS, REORDER_ON_CANVAS, RESTYLE_ON_CANVAS, SET_CANVAS_BACKGROUND, SET_PAGE_BACKGROUND, TRANSFORM_ON_CANVAS } from "@/lib/agent/shared/canvas-tools";
import { CANVAS_STROKE_MAX, CANVAS_TEXT_MAX_FONT, FONT_NAMES,  } from "@/lib/canvas-objects/object-style";
import { LAYOUT_TEXT_MAX_FONT,  } from "@/lib/layout/moodboard-layouts";

test("set_page_background says why a ground is not a rectangle you draw", () => {
  assert.equal(SET_PAGE_BACKGROUND.name, "set_page_background");
  assert.deepEqual(SET_PAGE_BACKGROUND.parameters.required, ["boardId", "pageId", "colour"]);
  assert.match(SET_PAGE_BACKGROUND.description, /never a rectangle placed on top of one/);
  assert.match(SET_PAGE_BACKGROUND.description, /moved, restacked and picked up by accident/);
  assert.match(SET_PAGE_BACKGROUND.description, /Nothing on the page moves and nothing is taken off/);
  assert.match(SET_PAGE_BACKGROUND.description, /near-black lettering on a page painted near-black/);
  assert.match(SET_PAGE_BACKGROUND.description, /repaints the page rather than stacking one ground on another/);
  assert.match(SET_PAGE_BACKGROUND.description, /Read the board with read_canvas first/);
  for (const named of ["inspect_board", "design_page"]) {
    assert.ok(!SET_PAGE_BACKGROUND.description.includes(named), `${named} is agent 6's alone`);
  }
  const colour = (SET_PAGE_BACKGROUND.parameters.properties as Record<string, { description: string }>)
    .colour!;
  assert.match(colour.description, /"none"/);
  assert.match(colour.description, /A word for a colour is not a colour here/);
});

test("set_canvas_background says which of the two grounds it is", () => {
  assert.equal(SET_CANVAS_BACKGROUND.name, "set_canvas_background");
  assert.deepEqual(SET_CANVAS_BACKGROUND.parameters.required, ["boardId", "colour"]);
  assert.match(SET_CANVAS_BACKGROUND.description, /the canvas itself, the surface every page on it sits on/);
  assert.match(
    SET_CANVAS_BACKGROUND.description,
    /When they mean one page rather than the board, that is design_page's/,
  );
  assert.match(SET_CANVAS_BACKGROUND.description, /a page painted its own colour keeps it/);
  assert.match(SET_CANVAS_BACKGROUND.description, /this is what an unpainted page is drawn on/);
  assert.match(SET_CANVAS_BACKGROUND.description, /nothing on it moved|moves nothing and takes nothing off/);
  assert.match(SET_CANVAS_BACKGROUND.description, /already that colour is left alone and said so/);
  const colour = (
    SET_CANVAS_BACKGROUND.parameters.properties as Record<string, { description: string }>
  ).colour!;
  assert.match(colour.description, /"default"/);
  assert.match(colour.description, /A word for a colour is not a colour here/);
});

test("read_canvas says what it is instead of, and that the handles come from it", () => {
  assert.equal(READ_CANVAS.name, "read_canvas");
  assert.deepEqual(READ_CANVAS.parameters.required, ["boardId"]);
  assert.match(
    READ_CANVAS.description,
    /before transform_on_canvas, restyle_on_canvas, reorder_on_canvas, remove_from_canvas, swap_on_board or reword_on_board/,
  );
  assert.ok(!READ_CANVAS.description.includes("inspect_board"));
  assert.match(READ_CANVAS.description, /colour, size, family and alignment it is set in/);
  assert.match(READ_CANVAS.description, /opacity on anything faded below whole/);
  assert.match(READ_CANVAS.description, /boxUnit/);
  assert.match(READ_CANVAS.description, /\[ymin, xmin, ymax, xmax\]/);
  assert.match(READ_CANVAS.description, /placed twice is two objects/);
});

test("agent 6's read_canvas says what it is instead of, and sends edits to design_page", () => {
  assert.equal(ORCHESTRATOR_READ_CANVAS.name, READ_CANVAS.name);
  assert.deepEqual(ORCHESTRATOR_READ_CANVAS.parameters, READ_CANVAS.parameters);
  assert.match(ORCHESTRATOR_READ_CANVAS.description, /not inspect_board/);
  assert.match(ORCHESTRATOR_READ_CANVAS.description, /the one on the left/);
  assert.match(ORCHESTRATOR_READ_CANVAS.description, /changed with design_page/);
  for (const retired of [
    "transform_on_canvas",
    "restyle_on_canvas",
    "reorder_on_canvas",
    "remove_from_canvas",
    "swap_on_board",
    "reword_on_board",
  ]) {
    assert.ok(!ORCHESTRATOR_READ_CANVAS.description.includes(retired), `${retired} is named`);
  }
});

test("put_on_canvas routes by whether the user named the place, and says its cap", () => {
  assert.deepEqual(PUT_ON_CANVAS.parameters.required, ["boardId", "objects"]);
  assert.match(PUT_ON_CANVAS.description, new RegExp(`At most ${CANVAS_PUT_LIMIT} objects a call`));
  assert.match(PUT_ON_CANVAS.description, /the place is already known/);
  assert.match(PUT_ON_CANVAS.description, /that is design_page's/);
  assert.match(PUT_ON_CANVAS.description, /keeps its own shape inside the box/);
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
    "shape",
    "fill",
    "stroke",
    "strokeWidth",
    "strokeStyle",
    "rounded",
    "colour",
    "font",
    "weight",
    "italic",
    "align",
    "fontSize",
    "opacity",
  ]);
  assert.deepEqual(properties.objects!.items!.required, ["kind"]);
  assert.deepEqual(properties.objects!.items!.properties!.kind!.enum, [
    "image",
    "text",
    "shape",
    "page",
  ]);
});

test("put_on_canvas says the style vocabulary the executor holds, and both type ceilings", () => {
  const fields = (PUT_ON_CANVAS.parameters.properties as Record<
    string,
    { items?: { properties?: Record<string, { enum?: string[]; description?: string }> } }
  >).objects!.items!.properties!;

  assert.deepEqual(fields.shape!.enum, ["rectangle", "ellipse", "line"]);
  assert.equal(fields.font!.enum, undefined);
  assert.match(fields.font!.description!, /Google Fonts family/);
  assert.match(fields.font!.description!, new RegExp(FONT_NAMES.join(", ")));
  assert.match(fields.weight!.description!, /100–900/);
  assert.match(fields.italic!.description!, /italic/);
  assert.deepEqual(fields.strokeStyle!.enum, ["solid", "dashed", "dotted"]);
  assert.deepEqual(fields.align!.enum, ["left", "center", "right"]);
  assert.match(fields.fontSize!.description!, new RegExp(`${CANVAS_TEXT_MAX_FONT}`));
  assert.match(fields.fontSize!.description!, new RegExp(`capped at ${LAYOUT_TEXT_MAX_FONT}`));
  assert.match(fields.strokeWidth!.description!, new RegExp(`up to ${CANVAS_STROKE_MAX}`));
  assert.match(PUT_ON_CANVAS.description, /a shape, which always names its box/);
  assert.match(PUT_ON_CANVAS.description, /a rule is a line with the same ymin and ymax/);
  assert.match(PUT_ON_CANVAS.description, /refused with the reason rather than dropped/);
});

test("restyle_on_canvas says the same style vocabulary the put does, and the field table", () => {
  assert.deepEqual(RESTYLE_ON_CANVAS.parameters.required, ["boardId", "changes"]);
  assert.match(
    RESTYLE_ON_CANVAS.description,
    new RegExp(`At most ${CANVAS_RESTYLE_LIMIT} objects a call`),
  );

  const fields = (RESTYLE_ON_CANVAS.parameters.properties as Record<
    string,
    { items?: { required?: string[]; properties?: Record<string, { enum?: string[]; description?: string }> } }
  >).changes!.items!;

  assert.deepEqual(fields.required, ["objectId"]);
  assert.equal(fields.properties!.font!.enum, undefined);
  assert.match(fields.properties!.font!.description!, /Google Fonts family/);
  assert.match(fields.properties!.font!.description!, new RegExp(FONT_NAMES.join(", ")));
  assert.match(fields.properties!.weight!.description!, /keeps the family/);
  assert.deepEqual(fields.properties!.strokeStyle!.enum, ["solid", "dashed", "dotted"]);
  assert.deepEqual(fields.properties!.align!.enum, ["left", "center", "right"]);
  assert.match(fields.properties!.fontSize!.description!, new RegExp(`${CANVAS_TEXT_MAX_FONT}`));
  assert.match(fields.properties!.strokeWidth!.description!, new RegExp(`up to ${CANVAS_STROKE_MAX}`));
  for (const geometry of ["box", "to", "size", "angle", "shape", "kind"]) {
    assert.equal(geometry in fields.properties!, false, `${geometry} is not a restyle's`);
  }
  assert.match(RESTYLE_ON_CANVAS.description, /fill, stroke, strokeWidth and strokeStyle are a shape's/);
  assert.match(RESTYLE_ON_CANVAS.description, /rounded is a shape's or a picture's/);
  assert.match(RESTYLE_ON_CANVAS.description, /the rest of that change is still made/);
  assert.match(RESTYLE_ON_CANVAS.description, /keeps its place, its size and its stacking/);
});

test("remove_from_canvas says every selector form, and that the gallery is untouched", () => {
  assert.deepEqual(REMOVE_FROM_CANVAS.parameters.required, ["boardId", "objects"]);
  assert.match(
    REMOVE_FROM_CANVAS.description,
    new RegExp(`At most ${CANVAS_REMOVE_LIMIT} selectors a call`),
  );
  assert.match(REMOVE_FROM_CANVAS.description, /objectId from read_canvas first/);
  assert.match(REMOVE_FROM_CANVAS.description, /every copy of that picture/);
  assert.match(REMOVE_FROM_CANVAS.description, /words of a line/);
  assert.match(REMOVE_FROM_CANVAS.description, /discard_page offers with a button/);
  assert.match(REMOVE_FROM_CANVAS.description, /Nothing leaves the project/);
  assert.match(REMOVE_FROM_CANVAS.description, /notOnBoard/);
});

test("transform_on_canvas carries the refusal rules, and routes geometry away from a rebuild", () => {
  assert.deepEqual(TRANSFORM_ON_CANVAS.parameters.required, ["boardId", "changes"]);
  assert.match(
    TRANSFORM_ON_CANVAS.description,
    new RegExp(`At most ${CANVAS_TRANSFORM_LIMIT} changes a call`),
  );
  assert.match(TRANSFORM_ON_CANVAS.description, /prefer it over design_page/);
  assert.match(TRANSFORM_ON_CANVAS.description, /read_canvas first/);
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
  assert.match(REORDER_ON_CANVAS.description, /prefer it over design_page/);
  assert.match(REORDER_ON_CANVAS.description, /own company/);
  assert.match(REORDER_ON_CANVAS.description, /page cannot be reordered/);

  const properties = REORDER_ON_CANVAS.parameters.properties as Record<
    string,
    { items?: { properties?: Record<string, { enum?: string[] }>; required?: string[] } }
  >;
  assert.deepEqual(Object.keys(properties.moves!.items!.properties!), [
    "objectId",
    "to",
    "above",
    "below",
  ]);
  assert.deepEqual(properties.moves!.items!.properties!.to!.enum, ["front", "back"]);
  assert.deepEqual(properties.moves!.items!.required, ["objectId"]);
});
