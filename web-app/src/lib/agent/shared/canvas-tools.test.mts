import { test } from "node:test";
import assert from "node:assert/strict";

import { CANVAS_PUT_LIMIT, CANVAS_REMOVE_LIMIT, CANVAS_REORDER_LIMIT, CANVAS_RESTYLE_LIMIT, CANVAS_TRANSFORM_LIMIT, PUT_ON_CANVAS, READ_CANVAS, REMOVE_FROM_CANVAS, REORDER_ON_CANVAS, RESTYLE_ON_CANVAS, SET_CANVAS_BACKGROUND, SET_PAGE_BACKGROUND, TRANSFORM_ON_CANVAS } from "@/lib/agent/shared/canvas-tools";
import { CANVAS_STROKE_MAX, CANVAS_TEXT_MAX_FONT, FONT_NAMES,  } from "@/lib/canvas-objects/object-style";
import { LAYOUT_TEXT_MAX_FONT,  } from "@/lib/layout/moodboard-layouts";

/// The declaration has to argue against the call the model would otherwise
/// make, because `put_on_canvas` can draw a page-sized rectangle and the result
/// looks identical in the picture — and is an object with a handle, which is
/// the whole difference.
test("set_page_background says why a ground is not a rectangle you draw", () => {
  assert.equal(SET_PAGE_BACKGROUND.name, "set_page_background");
  /// Nothing falls back: a colour with no page is a page the user did not name.
  assert.deepEqual(SET_PAGE_BACKGROUND.parameters.required, ["boardId", "pageId", "colour"]);
  assert.match(SET_PAGE_BACKGROUND.description, /never a rectangle placed on top of one/);
  assert.match(SET_PAGE_BACKGROUND.description, /moved, restacked and picked up by accident/);
  /// The two facts the counts in the answer do not carry: nothing moves, and a
  /// page painted under type it was not chosen for is a page gone blank.
  assert.match(SET_PAGE_BACKGROUND.description, /Nothing on the page moves and nothing is taken off/);
  assert.match(SET_PAGE_BACKGROUND.description, /near-black lettering on a page painted near-black/);
  /// One per page, said at the door rather than discovered by stacking two.
  assert.match(SET_PAGE_BACKGROUND.description, /repaints the page rather than stacking one ground on another/);
  /// Both agents hold `read_canvas`, which is why this description is not
  /// forked for agent 8 the way the other four page tools are.
  assert.match(SET_PAGE_BACKGROUND.description, /Read the board with read_canvas first/);
  for (const named of ["inspect_board", "design_page"]) {
    assert.ok(!SET_PAGE_BACKGROUND.description.includes(named), `${named} is agent 6's alone`);
  }
  const colour = (SET_PAGE_BACKGROUND.parameters.properties as Record<string, { description: string }>)
    .colour!;
  assert.match(colour.description, /"none"/);
  assert.match(colour.description, /A word for a colour is not a colour here/);
});

/// The one thing this declaration has to do is keep itself apart from the
/// page's own ground: the two calls are one word apart, the sentence a user
/// says for either is "make that dark", and the wrong one paints five pages the
/// user was not talking about.
test("set_canvas_background says which of the two grounds it is", () => {
  assert.equal(SET_CANVAS_BACKGROUND.name, "set_canvas_background");
  /// Nothing falls back: a colour with no board is not a board the user named.
  assert.deepEqual(SET_CANVAS_BACKGROUND.parameters.required, ["boardId", "colour"]);
  assert.match(SET_CANVAS_BACKGROUND.description, /the canvas itself, the surface every page on it sits on/);
  /// The routing, both ways round — which sentence means this one, and the tool
  /// that answers the sentence that does not.
  assert.match(SET_CANVAS_BACKGROUND.description, /Use set_page_background instead when they mean one page/);
  assert.match(SET_CANVAS_BACKGROUND.description, /a page painted its own colour keeps it/);
  /// What it costs to get right, said before the call rather than found in the
  /// picture afterwards: this is what an unpainted page is drawn on.
  assert.match(SET_CANVAS_BACKGROUND.description, /this is what an unpainted page is drawn on/);
  assert.match(SET_CANVAS_BACKGROUND.description, /nothing on it moved|moves nothing and takes nothing off/);
  /// Free, and said so where every other free call in this file says it.
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
  /// The split from inspect_board is the whole reason the tool exists, and it
  /// has to be in the declaration — by the time the model has called the wrong
  /// read it has spent the round the split was meant to save.
  assert.match(READ_CANVAS.description, /not inspect_board/);
  /// The instruction seam: read before any direct edit, the way inspect_board
  /// is read before a content edit, and by name so the routing is followable.
  assert.match(
    READ_CANVAS.description,
    /before transform_on_canvas, restyle_on_canvas, reorder_on_canvas or remove_from_canvas/,
  );
  /// The read is what a restyle is made against, so it has to say that it
  /// carries what a restyle takes: a family named in the answer is the
  /// difference between a design changing a headline and a design changing it
  /// back.
  assert.match(READ_CANVAS.description, /colour, size, family and alignment it is set in/);
  assert.match(READ_CANVAS.description, /opacity on anything faded below whole/);
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
  /// The routing against the design, both directions: a named place is this
  /// tool's, a whole page arranged is `design_page`'s.
  assert.match(PUT_ON_CANVAS.description, /the place is already known/);
  assert.match(PUT_ON_CANVAS.description, /that is design_page's/);
  /// Contain, never stretch — the put has no stretch switch at all.
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
    "shape",
    "fill",
    "stroke",
    "strokeWidth",
    "strokeStyle",
    "rounded",
    "colour",
    "font",
    "align",
    "fontSize",
    "opacity",
  ]);
  /// Only the kind is required: which other field an object needs depends on
  /// what it is, and the executor answers a mismatch rather than the schema.
  assert.deepEqual(properties.objects!.items!.required, ["kind"]);
  assert.deepEqual(properties.objects!.items!.properties!.kind!.enum, [
    "image",
    "text",
    "shape",
    "page",
  ]);
});

/// The style dialect at the door. The vocabularies are the ones `object-style`
/// enforces — a declaration naming a family or a stroke style the executor
/// would refuse is a round spent learning the table — and the two type ceilings
/// are said apart, because a model that believes the derived 96 is the only one
/// never asks for a headline.
test("put_on_canvas says the style vocabulary the executor holds, and both type ceilings", () => {
  const fields = (PUT_ON_CANVAS.parameters.properties as Record<
    string,
    { items?: { properties?: Record<string, { enum?: string[]; description?: string }> } }
  >).objects!.items!.properties!;

  assert.deepEqual(fields.shape!.enum, ["rectangle", "ellipse", "line"]);
  assert.deepEqual(fields.font!.enum, FONT_NAMES);
  assert.deepEqual(fields.strokeStyle!.enum, ["solid", "dashed", "dotted"]);
  assert.deepEqual(fields.align!.enum, ["left", "center", "right"]);
  assert.match(fields.fontSize!.description!, new RegExp(`${CANVAS_TEXT_MAX_FONT}`));
  assert.match(fields.fontSize!.description!, new RegExp(`capped at ${LAYOUT_TEXT_MAX_FONT}`));
  assert.match(fields.strokeWidth!.description!, new RegExp(`up to ${CANVAS_STROKE_MAX}`));
  /// A shape always names its box, and a rule is a flat one — the two rules a
  /// model cannot work out from the field list.
  assert.match(PUT_ON_CANVAS.description, /a shape, which always names its box/);
  assert.match(PUT_ON_CANVAS.description, /a rule is a line with the same ymin and ymax/);
  /// Refused with the reason, never dropped: the promise the executor keeps.
  assert.match(PUT_ON_CANVAS.description, /refused with the reason rather than dropped/);
});

/// The sixth tool at the door. Same vocabulary as the put's, asserted
/// separately: two declarations naming one set of words are two places for the
/// set to drift, and the whole premise of the pair is that it does not fork.
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
  assert.deepEqual(fields.properties!.font!.enum, FONT_NAMES);
  assert.deepEqual(fields.properties!.strokeStyle!.enum, ["solid", "dashed", "dotted"]);
  assert.deepEqual(fields.properties!.align!.enum, ["left", "center", "right"]);
  assert.match(fields.properties!.fontSize!.description!, new RegExp(`${CANVAS_TEXT_MAX_FONT}`));
  assert.match(fields.properties!.strokeWidth!.description!, new RegExp(`up to ${CANVAS_STROKE_MAX}`));
  /// No box, no shape, no kind: the tool that answers how a thing looks takes
  /// nothing about where it is — that is the transform's.
  for (const geometry of ["box", "to", "size", "angle", "shape", "kind"]) {
    assert.equal(geometry in fields.properties!, false, `${geometry} is not a restyle's`);
  }
  /// The style table, said where the model reads it — and the per-field
  /// remainder, which is the one promise the put does not make.
  assert.match(RESTYLE_ON_CANVAS.description, /fill, stroke, strokeWidth and strokeStyle are a shape's/);
  /// The one field of the table that belongs to two kinds besides `opacity`,
  /// said as both rather than as a shape's alone.
  assert.match(RESTYLE_ON_CANVAS.description, /rounded is a shape's or a picture's/);
  assert.match(RESTYLE_ON_CANVAS.description, /the rest of that change is still made/);
  /// The reason it is not a remove and a put: the object keeps everything the
  /// other five decide about it.
  assert.match(RESTYLE_ON_CANVAS.description, /keeps its place, its size and its stacking/);
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
  assert.match(TRANSFORM_ON_CANVAS.description, /prefer it over design_page/);
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
  assert.match(REORDER_ON_CANVAS.description, /prefer it over design_page/);
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
