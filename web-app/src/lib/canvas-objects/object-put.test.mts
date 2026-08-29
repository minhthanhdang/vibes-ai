import { test } from "node:test";
import assert from "node:assert/strict";

import { putObjects, type PutRequest } from "@/lib/canvas-objects/object-put";
import { transformObjects } from "@/lib/canvas-objects/object-transform";
import {
  LAYOUT_TEXT_MAX_FONT,
  LAYOUT_TEXT_MIN_FONT,
  PAGE_PRESETS,
} from "@/lib/layout/moodboard-layouts";
import { boardPages } from "@/lib/pages/board-pages";
import { FONT_FAMILIES } from "@/lib/canvas-objects/object-style";
import { renderFont } from "@/lib/render/render-plan";
import { setWidth } from "@/lib/render/text-set";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

type Box = { x: number; y: number; width: number; height: number };

function pageFrame(id: string, box: Box, name = "Page 1") {
  return { id, type: "frame", name, ...box, customData: { page: true } };
}

function photo(id: string, referenceId: string, box: Box, extra: object = {}) {
  return { id, type: "image", fileId: `ref:${referenceId}`, ...box, ...extra };
}

function line(id: string, text: string, box: Box, extra: object = {}) {
  return { id, type: "text", text, ...box, ...extra };
}

const SIZES: Record<string, { width: number; height: number }> = {
  "ref-square": { width: 1000, height: 1000 },
  "ref-wide": { width: 2000, height: 1000 },
};

function run(
  elements: SceneElement[],
  requests: PutRequest[],
  sizeOf: (id: string) => { width: number; height: number } | undefined = (id) => SIZES[id],
) {
  let n = 0;
  return putObjects(elements, requests, {
    defaultSize: { width: HD.width, height: HD.height },
    sizeOf,
    makeId: () => `id-${++n}`,
  });
}

function byId(elements: readonly SceneElement[] | null, id: string): SceneElement {
  const found = elements?.find((element) => element.id === id);
  assert.ok(found, `no element ${id}`);
  return found;
}

test("an image with no box joins the named page through the place rules — owned by the frame, immediately before it", () => {
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("m1", "ref-a", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
  ];
  const result = run(scene, [{ kind: "image", referenceId: "ref-square", pageId: "p1" }]);

  assert.deepEqual(result.put, [{ objectId: "id-1", kind: "image", pageId: "p1" }]);
  const joined = byId(result.elements, "id-1");
  assert.equal(joined.frameId, "p1");
  assert.equal(joined.status, "saved");
  assert.equal(joined.fileId, "ref:ref-square");
  const order = result.elements!.map((element) => element.id);
  assert.equal(order.indexOf("id-1"), order.indexOf("p1") - 1);
});

test("an image with no box and no page lands loose under the board's own arrangement", () => {
  const scene = [photo("l1", "ref-a", { x: 0, y: 0, width: 400, height: 300 })];
  const result = run(scene, [{ kind: "image", referenceId: "ref-square" }]);

  const joined = byId(result.elements, "id-1");
  assert.equal("frameId" in joined, false);
  assert.ok((joined.y as number) >= 300, "placed under what was there");
  assert.deepEqual(result.put, [{ objectId: "id-1", kind: "image" }]);
});

test("an image at a box on a page speaks thousandths and is contained at its own aspect, centred", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];
  const result = run(scene, [
    { kind: "image", referenceId: "ref-square", pageId: "p1", box: [0, 0, 500, 500] },
  ]);

  /// The asked box is 960×540 px; a square photo contains to 540×540, centred.
  const joined = byId(result.elements, "id-1");
  assert.deepEqual(
    { x: joined.x, y: joined.y, width: joined.width, height: joined.height },
    { x: 210, y: 0, width: 540, height: 540 },
  );
  assert.equal(joined.frameId, "p1");
  const order = result.elements!.map((element) => element.id);
  assert.equal(order.indexOf("id-1"), order.indexOf("p1") - 1);
  assert.deepEqual(result.put, [{ objectId: "id-1", kind: "image", pageId: "p1" }]);
});

test("an image with no recorded size takes the whole box, and a loose box crosses in scene pixels", () => {
  const result = run([], [{ kind: "image", referenceId: "ref-unknown", box: [100, 200, 400, 600] }]);

  const joined = byId(result.elements, "id-1");
  assert.deepEqual(
    { x: joined.x, y: joined.y, width: joined.width, height: joined.height },
    { x: 200, y: 100, width: 400, height: 300 },
  );
  assert.equal("frameId" in joined, false);
  assert.deepEqual(result.put, [{ objectId: "id-1", kind: "image" }]);
});

test("a box put lands in what geometry says it lands in — a section takes what it contains", () => {
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    { id: "sec", type: "frame", name: "Act one", x: 2500, y: 0, width: 800, height: 600 },
  ];
  const result = run(scene, [
    { kind: "image", referenceId: "ref-unknown", box: [100, 2600, 300, 2900] },
  ]);

  const joined = byId(result.elements, "id-1");
  assert.equal(joined.frameId, "sec");
  assert.deepEqual(result.put, [{ objectId: "id-1", kind: "image" }]);
});

test("a reference the target already carries is alreadyOn, never doubled — scoped to the page it was asked onto", () => {
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    pageFrame("p2", { x: HD.width + 120, y: 0, ...HD }, "Page 2"),
    photo("m1", "ref-a", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
  ];

  const doubled = run(scene, [{ kind: "image", referenceId: "ref-a", pageId: "p1" }]);
  assert.deepEqual(doubled.alreadyOn, ["ref-a"]);
  assert.equal(doubled.elements, null);

  const boxed = run(scene, [
    { kind: "image", referenceId: "ref-a", pageId: "p1", box: [0, 0, 400, 400] },
  ]);
  assert.deepEqual(boxed.alreadyOn, ["ref-a"]);

  const elsewhere = run(scene, [{ kind: "image", referenceId: "ref-a", pageId: "p2" }]);
  assert.deepEqual(elsewhere.put, [{ objectId: "id-1", kind: "image", pageId: "p2" }]);
});

test("a line with no box is set by the place rules; at a box the type follows the box height", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];
  const placed = run(scene, [{ kind: "text", text: "  ACT   ONE  ", pageId: "p1" }]);
  assert.deepEqual(placed.put, [{ objectId: "id-1", kind: "text", pageId: "p1" }]);
  assert.equal(byId(placed.elements, "id-1").text, "ACT ONE");

  const boxed = run([], [{ kind: "text", text: "ACT ONE", box: [0, 0, 100, 500] }]);
  const set = byId(boxed.elements, "id-1");
  assert.equal(set.fontSize, 80);
  assert.equal(set.height, 100);
  assert.equal(set.width, 500);
  assert.equal(set.originalText, "ACT ONE");
  assert.equal(set.autoResize, false);
});

test("a box too small for type still sets readable type — the font floor holds", () => {
  const result = run([], [{ kind: "text", text: "small", box: [0, 0, 10, 200] }]);
  assert.equal(byId(result.elements, "id-1").fontSize, 12);
});

test("a line the board already says is alreadyOn however it is retyped", () => {
  const scene = [line("t1", "Act One", { x: 0, y: 0, width: 400, height: 50 })];
  const result = run(scene, [{ kind: "text", text: "ACT  one" }]);
  assert.deepEqual(result.alreadyOn, ["ACT one"]);
  assert.equal(result.elements, null);
});

test("a page with no box is addPage's — named, and a page on a page is refused", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];
  const result = run(scene, [{ kind: "page", name: "Act two" }]);

  assert.deepEqual(result.put, [{ objectId: "id-1", kind: "page" }]);
  const frame = byId(result.elements, "id-1");
  assert.equal(frame.name, "Act two");
  assert.ok(
    boardPages(result.elements!).some((page) => page.id === "id-1"),
    "the new frame reads as a page",
  );

  const refused = run(scene, [{ kind: "page", name: "Act three", pageId: "p1" } as PutRequest]);
  assert.equal(refused.refused.length, 1);
  assert.match(refused.refused[0]!.reason, /page cannot be put on a page/);
});

/// §XI.4: "add a page and paint it dark" is one ask, and this is the door it
/// arrives at first. The put refuses the whole request rather than landing a
/// page without the ground it was asked for — and now says which call paints it.
test("a page put with a fill on it is refused toward set_page_background", () => {
  const result = run([], [{ kind: "page", name: "Cover", fill: "#0c111c" } as PutRequest]);

  assert.equal(result.elements, null);
  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /set_page_background/);
});

test("a page at an explicit box is drawn there and adopts what it lands over", () => {
  const scene = [photo("l1", "ref-a", { x: 3000, y: 100, width: 400, height: 300 })];
  const result = run(scene, [{ kind: "page", box: [0, 2900, 1080, 4820] }]);

  const frame = byId(result.elements, "id-1");
  assert.deepEqual(
    { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
    { x: 2900, y: 0, width: 1920, height: 1080 },
  );
  assert.equal(byId(result.elements, "l1").frameId, "id-1");
  const order = result.elements!.map((element) => element.id);
  assert.equal(order.indexOf("l1"), order.indexOf("id-1") - 1);
});

/// The three presets are `resize_page`'s and the templates', never this door's.
/// Agent 8's instruction tells it the page's proportion is its own to decide —
/// a banner is long and short and no preset is — and this is the code that
/// sentence rests on, so a snap to the nearest preset added here would make the
/// instruction a lie in the one place nothing else would catch it.
test("a page at a box no preset has is that rectangle, and is not snapped to one", () => {
  const result = run([], [{ kind: "page", box: [0, 0, 600, 2400], name: "Hero" }]);

  const frame = byId(result.elements, "id-1");
  assert.deepEqual(
    { width: frame.width, height: frame.height },
    { width: 2400, height: 600 },
    "the page took a preset's shape instead of the box's",
  );
  for (const preset of Object.values(PAGE_PRESETS)) {
    assert.notDeepEqual({ width: frame.width, height: frame.height }, preset);
  }
  assert.equal(boardPages(result.elements!)[0]!.id, "id-1");
});

test("an unreadable box, an unknown page and an unknown kind are refused, never guessed", () => {
  const result = run([], [
    { kind: "image", referenceId: "ref-a", box: [500, 0, 100, 100] },
    { kind: "image", referenceId: "ref-b", pageId: "gone" },
    { kind: "text", text: "   " },
    { kind: "sticker" } as unknown as PutRequest,
  ]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.put, []);
  assert.equal(result.refused.length, 4);
  assert.match(result.refused[0]!.reason, /box is unreadable/);
  assert.match(result.refused[1]!.reason, /no page gone/);
  assert.match(result.refused[2]!.reason, /words to set/);
  assert.match(result.refused[3]!.reason, /kind must be/);
});

test("requests apply in order against the scene the one before left — the same reference twice lands once", () => {
  const result = run([], [
    { kind: "image", referenceId: "ref-square", box: [0, 0, 500, 500] },
    { kind: "image", referenceId: "ref-square", box: [0, 600, 500, 1100] },
  ]);

  assert.equal(result.put.length, 1);
  assert.deepEqual(result.alreadyOn, ["ref-square"]);
});

/// The type clamp, said rather than applied quietly. The ceiling is agent 4's
/// layout constant reached through a door two other agents write boxes at, and
/// what a caller reads back is an object shorter than the box it sent — so the
/// clamp comes back as a fact about the put and the caller decides whether it
/// has anything to say about it.

test("a box asking for type over the ceiling comes back as a clamp, not as a shorter box alone", () => {
  const result = run([], [{ kind: "text", text: "AMARA & INES", box: [0, 0, 200, 900] }]);

  assert.deepEqual(result.clamped, [{ objectId: "id-1", asked: 160, set: LAYOUT_TEXT_MAX_FONT }]);
  const set = byId(result.elements, "id-1");
  assert.equal(set.fontSize, LAYOUT_TEXT_MAX_FONT);
  /// The element is written at the height of the type it settled on: without
  /// the clamp beside it, a 200-tall box reading back 120 tall is the same
  /// answer as having asked for 120.
  assert.equal(set.height, 120);
});

test("the floor is a clamp too, and it is reported the same way", () => {
  const result = run([], [{ kind: "text", text: "small", box: [0, 0, 10, 200] }]);

  assert.deepEqual(result.clamped, [{ objectId: "id-1", asked: 8, set: LAYOUT_TEXT_MIN_FONT }]);
});

test("type inside the floor and the ceiling is no clamp at all", () => {
  const result = run([], [{ kind: "text", text: "ACT ONE", box: [0, 0, 100, 500] }]);

  assert.deepEqual(result.clamped, []);
});

test("a line placed by the house rules has no box to be clamped against", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];
  const result = run(scene, [{ kind: "text", text: "ACT ONE", pageId: "p1" }]);

  assert.deepEqual(result.clamped, []);
});

/// The reason the note agent 8 gets names a second tool: the ceiling belongs to
/// the put and to nothing else on the scene. A resize scales `fontSize` with the
/// box and clamps nothing, so the size the put refused is one transform away —
/// and if that ever stops being true, the sentence in `designer/canvas.ts` is a
/// lie this test is the only thing standing between.
test("what put_on_canvas clamps, transform_on_canvas sets — the ceiling is one door's", () => {
  const put = run([], [{ kind: "text", text: "AMARA & INES", box: [0, 0, 200, 900] }]);
  assert.equal(byId(put.elements, "id-1").fontSize, LAYOUT_TEXT_MAX_FONT);

  const resized = transformObjects(put.elements!, [
    { objectId: "id-1", size: [200, 1500] },
  ]);

  assert.deepEqual(resized.transformed, ["id-1"]);
  const set = byId(resized.elements, "id-1");
  assert.ok(
    Number(set.fontSize) > LAYOUT_TEXT_MAX_FONT,
    `resized type is ${set.fontSize}, no larger than the put's ceiling`,
  );
});

test("a shape lands as exactly its box, flat and hard-edged", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];
  const result = run(scene, [
    { kind: "shape", shape: "rectangle", pageId: "p1", box: [0, 0, 500, 1000], fill: "#ffcc00" },
  ]);

  assert.deepEqual(result.put, [{ objectId: "id-1", kind: "shape", pageId: "p1" }]);
  const block = byId(result.elements, "id-1");
  assert.equal(block.type, "rectangle");
  assert.deepEqual(
    { x: block.x, y: block.y, width: block.width, height: block.height },
    { x: 0, y: 0, width: HD.width, height: HD.height / 2 },
  );
  assert.equal(block.backgroundColor, "#ffcc00");
  assert.equal(block.fillStyle, "solid");
  assert.equal(block.roughness, 0);
  /// A fill with no stroke asked is a colour field, not a box with a line
  /// round it — the palette's own reading, at the agents' door.
  assert.equal(block.strokeColor, "transparent");
  assert.equal(block.frameId, "p1");
});

/// The shape a designer reaches for most is the one a box with area cannot
/// describe. `readableItems` learned this on the read side in stage 0; the put
/// is the same rule at the other door.
test("a rule is a flat box, and it is drawn from its own points", () => {
  const result = run([], [{ kind: "shape", shape: "line", box: [400, 100, 400, 1000], stroke: "#1e1e1e" }]);

  const rule = byId(result.elements, "id-1");
  assert.equal(rule.type, "line");
  assert.equal(rule.height, 0);
  assert.equal(rule.width, 900);
  assert.deepEqual(rule.points, [[0, 0], [900, 0]]);
});

test("a box with no extent at all is still unreadable, shape or not", () => {
  const result = run([], [{ kind: "shape", shape: "line", box: [400, 100, 400, 100] }]);

  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /the box is unreadable/);
});

test("a shape names its box — there is no house rule for where a colour field goes", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];
  const result = run(scene, [{ kind: "shape", shape: "rectangle", pageId: "p1" }]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.refused, [
    {
      object: "rectangle",
      reason:
        "a shape put names its box — a photograph and a headline have a house rule for where they go and a colour field does not",
    },
  ]);
});

test("three shapes and not ten — an arrow is refused by name", () => {
  const result = run([], [{ kind: "shape", shape: "arrow", box: [0, 0, 100, 100] }]);

  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /rectangle, ellipse, line/);
});

test("a style field asked of the wrong kind takes the whole put down rather than landing it bare", () => {
  const result = run([], [{ kind: "text", text: "ACT ONE", box: [0, 0, 100, 500], fill: "#ffcc00" }]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.put, []);
  assert.match(result.refused[0]!.reason, /fill is a shape's/);
});

test("a line lands in the ink, family and alignment it was put in", () => {
  const result = run([], [
    { kind: "text", text: "AMARA & INES", box: [0, 0, 100, 900], colour: "#ffffff", font: "display", align: "left" },
  ]);

  const set = byId(result.elements, "id-1");
  assert.equal(set.strokeColor, "#ffffff");
  assert.equal(set.fontFamily, 7);
  assert.equal(set.textAlign, "left");
});

/// Requirement 4 said as an assertion at the door agent 4 composes through: a
/// put naming no style field writes the element it wrote yesterday, column for
/// column. Every appearance column here is one this stage added.
test("a put naming no style field writes no appearance column at all", () => {
  const result = run([], [
    { kind: "text", text: "ACT ONE", box: [0, 0, 100, 500] },
    { kind: "image", referenceId: "ref-square", box: [200, 0, 400, 200] },
  ]);

  for (const id of ["id-1", "id-2"]) {
    const element = byId(result.elements, id);
    for (const column of ["strokeColor", "fontFamily", "opacity", "backgroundColor", "fillStyle", "roughness"]) {
      assert.equal(element[column], undefined, `${id} carries ${column}`);
    }
  }
  assert.equal(byId(result.elements, "id-1").textAlign, "center");
});

test("a photograph takes opacity and its corner, and nothing else — a scrim with no element added to the page", () => {
  const result = run([], [{ kind: "image", referenceId: "ref-square", box: [0, 0, 400, 400], opacity: 40 }]);

  assert.equal(byId(result.elements, "id-1").opacity, 40);
});

/// The second door on the same vocabulary: a picture put down rounded lands
/// rounded, rather than the model having to place it and then restyle it.
test("a photograph put rounded lands rounded", () => {
  const result = run([], [
    { kind: "image", referenceId: "ref-square", box: [0, 0, 400, 400], rounded: true },
  ]);

  assert.deepEqual(result.refused, []);
  assert.deepEqual(byId(result.elements, "id-1").roundness, { type: 3 });
});

test("an explicit size is honoured past the box-derived ceiling, and is not a clamp", () => {
  const result = run([], [
    { kind: "text", text: "AMARA & INES", box: [0, 0, 200, 900], fontSize: 240 },
  ]);

  const set = byId(result.elements, "id-1");
  assert.equal(set.fontSize, 240);
  /// The drawn height follows the size, as it does on the derived path — and
  /// the lines, because 240px of `AMARA & INES` is twice the width of the box
  /// it was asked for and the words break rather than run out of it.
  assert.equal(set.text, "AMARA\n& INES");
  assert.equal(set.height, Math.round(240 * 1.25) * 2);
  assert.deepEqual(result.clamped, []);
});

test("the derived path keeps its own ceiling exactly where it was", () => {
  const asked = run([], [{ kind: "text", text: "AMARA & INES", box: [0, 0, 200, 900] }]);
  assert.equal(byId(asked.elements, "id-1").fontSize, LAYOUT_TEXT_MAX_FONT);
  assert.equal(asked.clamped.length, 1);
});

test("a size said on a line with no box overrides the house size, and the height follows it", () => {
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("m1", "ref-a", { x: 100, y: 400, width: 300, height: 200 }, { frameId: "p1" }),
  ];
  const result = run(scene, [
    { kind: "text", text: "ACT ONE", pageId: "p1", fontSize: 64, colour: "#ffffff" },
  ]);

  const set = byId(result.elements, "id-1");
  assert.equal(set.fontSize, 64);
  assert.equal(set.height, Math.round(64 * 1.25));
  assert.equal(set.strokeColor, "#ffffff");
});

/// Body copy in a card (`compositor-v2.md` §IX.5, "a line of type is not a
/// paragraph"). The box is the one a real Vibes page asked for: 440 by 9
/// thousandths of a 1080x1920 page is 475 units wide and one line tall, and the
/// sentence sent to it is 185 characters long.

test("a sentence too long for its box is broken to the box's width, and the block grows down", () => {
  const copy =
    "Each lot is test-profiled in three-kilo micro-batches to isolate origin character before it is released to the counter, so the cup you are poured is the cup the roaster signed off on.";
  const scene = [pageFrame("p1", { x: 0, y: 0, width: 1080, height: 1920 })];
  const result = run(scene, [
    { kind: "text", text: copy, pageId: "p1", box: [500, 100, 509, 540] },
  ]);

  const set = byId(result.elements, "id-1");
  const lines = String(set.text).split("\n");
  assert.ok(lines.length > 1, "the sentence was broken");
  for (const one of lines) assert.ok(setWidth(one, set.fontSize as number) <= 475.2, one);
  /// What was typed is kept whole, so editing the block re-wraps the sentence
  /// rather than resurrecting this door's guess at where it broke.
  assert.equal(set.originalText, copy);
  assert.equal(lines.join(" "), copy);
  /// The width is the box's and the height is the block's — excalidraw's own
  /// behaviour for an `autoResize: false` element, and the only reading that
  /// keeps the type at the size the box asked for.
  assert.equal(set.width, 475.2);
  assert.equal(set.fontSize, 14);
  assert.equal(set.height, Math.round(lines.length * 14 * 1.25));
  assert.deepEqual(result.wrapped, [
    { objectId: "id-1", lines: lines.length, asked: 17.28, set: set.height },
  ]);
});

test("a line that fits its box is not broken and is not reported", () => {
  const result = run([], [{ kind: "text", text: "ACT ONE", box: [0, 0, 100, 500] }]);

  assert.equal(byId(result.elements, "id-1").text, "ACT ONE");
  assert.deepEqual(result.wrapped, []);
});

test("a sentence stored broken is still the same line to the alreadyOn check", () => {
  const copy = "Sourced directly from smallholder farms and washed at altitude in the dry season";
  const scene = [pageFrame("p1", { x: 0, y: 0, width: 1080, height: 1920 })];
  const first = run(scene, [{ kind: "text", text: copy, pageId: "p1", box: [500, 100, 509, 540] }]);
  assert.ok(String(byId(first.elements, "id-1").text).includes("\n"));

  const again = run(first.elements!, [
    { kind: "text", text: `  ${copy.toUpperCase()}  `, pageId: "p1", box: [600, 100, 609, 540] },
  ]);
  assert.deepEqual(again.alreadyOn, [copy.toUpperCase()]);
  assert.equal(again.elements, null);
});

test("a line placed by the house rules is never broken — only a box is a width", () => {
  const copy =
    "Each lot is test-profiled in three-kilo micro-batches to isolate origin character before it is released to the counter.";
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];
  const result = run(scene, [{ kind: "text", text: copy, pageId: "p1" }]);

  assert.equal(byId(result.elements, "id-1").text, copy);
  assert.deepEqual(result.wrapped, []);
});

/// The face the words are broken in. Both of these fail against the single
/// Helvetica table `text-set.ts` used to break every line on, because the whole
/// defect is that the door promised the box in one face and took it in another.

test("a line is broken in the face it will be drawn in, not in Helvetica", () => {
  /// A line that fits a 280-wide box in Liberation and does not fit it in
  /// Excalifont — which is what excalidraw draws a text element carrying no
  /// family in, and so what every put with no `font` lands as.
  const copy = "Made by hand in small batches";
  const scene = [pageFrame("p1", { x: 0, y: 0, width: 1080, height: 1920 })];
  const result = run(scene, [
    { kind: "text", text: copy, pageId: "p1", box: [100, 0, 130, 259], fontSize: 20 },
  ]);

  const set = byId(result.elements, "id-1");
  const lines = String(set.text).split("\n");
  assert.ok(lines.length > 1, "the line was broken");
  for (const one of lines) {
    assert.ok(setWidth(one, 20, renderFont(undefined).set) <= (set.width as number), one);
  }
  /// And the break is the face's doing rather than the box's: measured as
  /// Helvetica the whole sentence would have been left on one line, inside a
  /// box it overruns in the picture.
  assert.ok(setWidth(copy, 20, renderFont(FONT_FAMILIES.sans).set) <= (set.width as number));
});

test("a font asked for on the put is the font the words are broken to", () => {
  /// A monospace sets its lowercase wider than any proportional face here, so
  /// the same call with `font` and without it break in different places.
  const copy = "Made by hand in small batches";
  const scene = [pageFrame("p1", { x: 0, y: 0, width: 1080, height: 1920 })];
  const box: [number, number, number, number] = [100, 0, 130, 300];
  const plain = run(scene, [{ kind: "text", text: copy, pageId: "p1", box, fontSize: 20 }]);
  const mono = run(scene, [
    { kind: "text", text: copy, pageId: "p1", box, fontSize: 20, font: "mono" },
  ]);

  assert.equal(String(byId(plain.elements, "id-1").text), copy);
  const broken = String(byId(mono.elements, "id-1").text).split("\n");
  assert.ok(broken.length > 1, "the monospace line was broken");
  for (const one of broken) {
    assert.ok(setWidth(one, 20, renderFont(FONT_FAMILIES.mono).set) <= 324, one);
  }
});

/// The Google-font round trip: a put through the injected lookup lands the
/// integer and the ride, the wrap breaks in the face's own widths, and the
/// read says the family back by name with its cut — one vocabulary, both
/// directions (§XI.2's premise on the widest table it has carried).
test("a Google variant lands on the element and reads back by name, weight and slope", async () => {
  const { canvasRead } = await import("@/lib/canvas-objects/object-read");
  const playfair = {
    int: 1_333_019_802,
    font: {
      family: "Playfair Display",
      weight: 700,
      italic: true,
      set: { space: 0.255, narrow: 0.344, wide: 0.859, upper: 0.688, digit: 0.525, other: 0.517 },
      fallback: "serif",
    },
  };
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })] as SceneElement[];
  let n = 0;
  const edit = putObjects(
    scene,
    [
      {
        kind: "text",
        text: "A quiet table",
        pageId: "p1",
        box: [100, 100, 160, 900],
        font: "Playfair Display",
        weight: 700,
        italic: true,
      } as PutRequest,
    ],
    {
      defaultSize: { width: HD.width, height: HD.height },
      sizeOf: () => undefined,
      makeId: () => `id-${++n}`,
      fonts: new Map([["playfair display|700|true", playfair]]),
    },
  );

  assert.deepEqual(edit.refused, []);
  const element = byId(edit.elements, "id-1");
  assert.equal(element.fontFamily, playfair.int);
  assert.deepEqual(element.customData, { font: playfair.font });

  const read = canvasRead(edit.elements);
  assert.ok(read);
  const block = read.objects.find((object) => object.objectId === "id-1");
  assert.ok(block && block.kind === "text");
  assert.equal(block.font, "Playfair Display");
  assert.equal(block.weight, 700);
  assert.equal(block.italic, true);
});

/// The same put with no lookup — a path the library never reached — refuses
/// the whole object rather than landing it in a face nothing can draw.
test("a Google family with no library behind it refuses the put whole", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })] as SceneElement[];
  const edit = run(scene as SceneElement[], [
    { kind: "text", text: "A quiet table", pageId: "p1", font: "Playfair Display" } as PutRequest,
  ]);
  assert.equal(edit.put.length, 0);
  assert.match(edit.refused[0]!.reason, /library could not be consulted/);
});
