import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RENDER_BACKGROUND,
  RENDER_MAX_DIMENSION,
  boardRenderFrame,
  boardRenderPlan,
  clipToFrame,
  drawnBounds,
  pageRenderPlan,
  renderCanvas,
  renderFont,
  rotatedBounds,
  textOverflow,
  textAppearance,
  undrawnNote,
  DEFAULT_FONT_FAMILY,
  DEFAULT_RENDER_FONT,
  type RenderDraw,
  type RenderPlan,
  type TextDraw,
} from "@/lib/render/render-plan";
import { FONT_FAMILIES } from "@/lib/canvas-objects/object-style";
import { adjustedRoughness } from "@/lib/render/sketch";
import { boardPages, type BoardPage } from "@/lib/pages/board-pages";
import { setBlock, setWidth } from "@/lib/render/text-set";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

type Box = { x: number; y: number; width: number; height: number };

function page(id: string, box: Box, extra: Record<string, unknown> = {}): SceneElement {
  return { id, type: "frame", name: id, customData: { page: {} }, ...box, ...extra };
}

function image(id: string, referenceId: string | null, box: Box, extra: Record<string, unknown> = {}): SceneElement {
  return { id, type: "image", ...(referenceId ? { fileId: `ref:${referenceId}` } : {}), ...box, ...extra };
}

function shape(
  id: string,
  type: string,
  box: Box,
  extra: Record<string, unknown> = {},
): SceneElement {
  return { id, type, strokeColor: "#1e1e1e", strokeWidth: 2, ...box, ...extra };
}

function text(id: string, value: string, box: Box, extra: Record<string, unknown> = {}): SceneElement {
  return { id, type: "text", text: value, ...box, ...extra };
}

function onlyPage(elements: readonly SceneElement[]): BoardPage {
  const pages = boardPages(elements);
  assert.equal(pages.length, 1);
  return pages[0]!;
}

function byId(plan: RenderPlan, id: string): RenderDraw {
  const drawn = plan.draws.find((entry) => entry.id === id);
  assert.ok(drawn, `nothing drawn for ${id}`);
  return drawn;
}

const A4 = { x: 100, y: 200, width: 800, height: 1000 };

test("a page is drawn at its own rectangle, in its own coordinates", () => {
  const elements = [page("p1", A4), image("e1", "ref-a", { x: 150, y: 300, width: 400, height: 200 })];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.deepEqual(plan.frame, A4);
  assert.equal(plan.scale, 1);
  assert.equal(plan.width, 800);
  assert.equal(plan.height, 1000);
  assert.deepEqual(byId(plan, "e1").box, { x: 50, y: 100, width: 400, height: 200 });
});

test("the long edge is capped and the short one follows it, and nothing is upscaled", () => {
  assert.deepEqual(renderCanvas({ width: 3200, height: 1600 }), {
    scale: 0.5,
    width: 1600,
    height: 800,
  });
  assert.deepEqual(renderCanvas({ width: 200, height: 100 }), { scale: 1, width: 200, height: 100 });
  assert.equal(renderCanvas({ width: RENDER_MAX_DIMENSION, height: 10 }).scale, 1);
});

test("a downscaled page places and sizes everything by the same scale", () => {
  const big = { x: 0, y: 0, width: 3200, height: 1600 };
  const elements = [page("p1", big), image("e1", "ref-a", { x: 400, y: 200, width: 800, height: 400 })];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.equal(plan.scale, 0.5);
  assert.deepEqual(byId(plan, "e1").box, { x: 200, y: 100, width: 400, height: 200 });
});

test("a page only draws what is on it, and other pages' work stays off it", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    page("p2", { x: 500, y: 0, width: 400, height: 400 }),
    image("here", "ref-a", { x: 10, y: 10, width: 100, height: 100 }),
    image("there", "ref-b", { x: 510, y: 10, width: 100, height: 100 }),
    image("loose", "ref-c", { x: 2000, y: 2000, width: 100, height: 100 }),
  ];
  const first = boardPages(elements)[0]!;

  assert.deepEqual(
    pageRenderPlan(elements, first).draws.map((entry) => entry.id),
    ["here"],
  );
});

test("an element hanging over the page edge keeps its box, so the picture cuts it off", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    image("over", "ref-a", { x: 350, y: -20, width: 100, height: 100 }),
  ];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.deepEqual(byId(plan, "over").box, { x: 350, y: -20, width: 100, height: 100 });
});

test("an image says which reference, which region of it and which copy it needs", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    image("small", "ref-a", { x: 0, y: 0, width: 100, height: 100 }),
    image("large", "ref-b", { x: 0, y: 400, width: 700, height: 300 }),
    image("cropped", "ref-c", { x: 200, y: 0, width: 100, height: 100 }, {
      crop: { x: 0, y: 0, width: 500, height: 500, naturalWidth: 5000, naturalHeight: 5000 },
    }),
  ];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const small = byId(plan, "small");
  assert.equal(small.kind, "image");
  assert.equal(small.kind === "image" && small.referenceId, "ref-a");
  assert.equal(small.kind === "image" && small.variant, "thumb");
  assert.equal(small.kind === "image" && small.region, null);

  const large = byId(plan, "large");
  assert.equal(large.kind === "image" && large.variant, "full");

  const cropped = byId(plan, "cropped");
  assert.deepEqual(cropped.kind === "image" && cropped.region, {
    x: 0,
    y: 0,
    width: 0.1,
    height: 0.1,
  });
  /// A window onto a tenth of a photograph needs ten times the resolution of an
  /// uncropped one at the same size, which is the case a thumbnail is visibly
  /// wrong in.
  assert.equal(cropped.kind === "image" && cropped.variant, "full");
});

test("the copy is chosen against this picture's scale, not against a display", () => {
  const wide = { x: 0, y: 0, width: 6400, height: 3200 };
  const elements = [page("p1", wide), image("e1", "ref-a", { x: 0, y: 0, width: 1000, height: 1000 })];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const drawn = byId(plan, "e1");
  assert.equal(plan.scale, 0.25);
  assert.equal(drawn.kind === "image" && drawn.variant, "thumb");
});

test("a flipped image says so rather than being drawn the wrong way round", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    image("e1", "ref-a", { x: 0, y: 0, width: 100, height: 100 }, { scale: [-1, 1] }),
  ];
  const drawn = byId(pageRenderPlan(elements, onlyPage(elements)), "e1");

  assert.equal(drawn.kind === "image" && drawn.flipX, true);
  assert.equal(drawn.kind === "image" && drawn.flipY, false);
});

/// §XI.2 widened `rounded` to a picture, and the corner rides on the plan for
/// the reason a shape's does: `getCornerRadius`'s ceiling is in scene units and
/// this is the one place holding the scale.
test("a rounded image carries the same scaled corner a rounded box does, and a square one carries none", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 3200, height: 1600 }),
    image("soft", "ref-a", { x: 0, y: 0, width: 800, height: 600 }, { roundness: { type: 3 } }),
    image("hard", "ref-b", { x: 900, y: 0, width: 800, height: 600 }),
  ];
  const plan = pageRenderPlan(elements, onlyPage(elements));
  const scale = plan.width / 3200;
  assert.ok(scale < 1);

  const soft = byId(plan, "soft");
  assert.equal(soft.kind === "image" && soft.radius, 32 * scale);
  const hard = byId(plan, "hard");
  assert.equal(hard.kind === "image" && hard.radius, 0);
});

test("an image naming bytes the project never stored is an outline, not a hole", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    image("pasted", null, { x: 0, y: 0, width: 100, height: 100 }, { fileId: "abc123" }),
  ];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.equal(byId(plan, "pasted").kind, "outline");
  assert.deepEqual(plan.undrawn, [{ id: "pasted", type: "image" }]);
});

/// One reader of these four columns or two, and two is how a headline the
/// picture draws in white gets listed to the model in excalidraw's near-black
/// (§XI.5). The draw is built from this, so the read taking it can never drift.
test("what a line of type is set in is one reading, and the draw is built from it", () => {
  const set = {
    fontSize: 40,
    fontFamily: FONT_FAMILIES.rounded,
    strokeColor: "#8b5cf6",
    textAlign: "center",
  };
  const elements = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    text("t1", "Ada & Sam", { x: 0, y: 0, width: 400, height: 60 }, set),
  ];
  const drawn = byId(pageRenderPlan(elements, onlyPage(elements)), "t1");
  const type = textAppearance({ type: "text", ...set });

  assert.deepEqual(type, {
    colour: "#8b5cf6",
    fontSize: 40,
    fontFamily: FONT_FAMILIES.rounded,
    align: "center",
  });
  assert.equal(drawn.kind === "text" && drawn.colour, type.colour);
  assert.equal(drawn.kind === "text" && drawn.align, type.align);
  assert.equal(drawn.kind === "text" && drawn.font.dir, renderFont(type.fontFamily).dir);
});

/// The family the read names has to be the one the picture *draws*, not the one
/// the element stores: a family the mirror has no files for falls back to
/// Excalifont in the rasteriser, so a read repeating the stored integer would
/// name a face nothing set.
test("a family the mirror has no files for reads as the one it is drawn in", () => {
  assert.equal(textAppearance({ fontFamily: 42 }).fontFamily, DEFAULT_FONT_FAMILY);
  assert.equal(textAppearance({}).fontFamily, DEFAULT_FONT_FAMILY);
  assert.equal(renderFont(DEFAULT_FONT_FAMILY).dir, DEFAULT_RENDER_FONT.dir);
  /// And one it does have files for is left exactly where it is.
  assert.equal(textAppearance({ fontFamily: 1 }).fontFamily, 1);
});

test("text carries its size, its family and its colour, scaled with everything else", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 3200, height: 800 }),
    text("t1", "Ada & Sam", { x: 0, y: 0, width: 400, height: 60 }, {
      fontSize: 40,
      fontFamily: 6,
      strokeColor: "#8b5cf6",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.5,
    }),
  ];
  const drawn = byId(pageRenderPlan(elements, onlyPage(elements)), "t1");

  assert.equal(drawn.kind, "text");
  if (drawn.kind !== "text") return;
  assert.equal(drawn.text, "Ada & Sam");
  assert.equal(drawn.fontSize, 20);
  assert.equal(drawn.font.dir, "Nunito");
  assert.equal(drawn.colour, "#8b5cf6");
  assert.equal(drawn.align, "center");
  assert.equal(drawn.verticalAlign, "middle");
  assert.equal(drawn.lineHeight, 1.5);
});

test("an empty text element is nothing to draw and nothing to report", () => {
  const elements = [page("p1", { x: 0, y: 0, width: 400, height: 400 }), text("t1", "", { x: 0, y: 0, width: 10, height: 10 })];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.deepEqual(plan.draws, []);
  assert.deepEqual(plan.undrawn, []);
});

/// A drawn line on its own, since the overflow is asked of the draw rather than
/// of the scene it came out of.
function line(value: string, box: Box, extra: Partial<TextDraw> = {}): TextDraw {
  return {
    id: "t1",
    kind: "text",
    box,
    angle: 0,
    opacity: 1,
    clip: null,
    text: value,
    fontSize: 40,
    font: DEFAULT_RENDER_FONT,
    lineHeight: 1.25,
    colour: "#000000",
    align: "center",
    verticalAlign: "middle",
    ...extra,
  };
}

const HEADLINE = "MOUNT REYES LIGHTHOUSE";

test("a line that fits the box it was written into spills nowhere", () => {
  assert.deepEqual(textOverflow(line("Ada & Sam", { x: 0, y: 0, width: 400, height: 60 })), {
    x: 0,
    y: 0,
  });
});

test("a headline too long for its box spills either side of it rather than being cut", () => {
  /// 22 characters of 40, generously at three quarters of the size each: 660
  /// set into 300, and a centred line puts half the difference on each side.
  assert.deepEqual(textOverflow(line(HEADLINE, { x: 0, y: 0, width: 300, height: 60 })), {
    x: 180,
    y: 0,
  });
});

test("a line on a left or a right edge spills the whole difference one way", () => {
  const box = { x: 0, y: 0, width: 300, height: 60 };
  assert.equal(textOverflow(line(HEADLINE, box, { align: "left" })).x, 360);
  assert.equal(textOverflow(line(HEADLINE, box, { align: "right" })).x, 360);
});

test("more lines than the box is tall spill above and below it", () => {
  const box = { x: 0, y: 0, width: 4000, height: 60 };
  assert.equal(textOverflow(line("one\ntwo\nthree", box)).y, 45);
  assert.equal(textOverflow(line("one\ntwo\nthree", box, { verticalAlign: "top" })).y, 90);
});

test("the longest line is the one the width is measured on", () => {
  const box = { x: 0, y: 0, width: 300, height: 400 };
  assert.equal(textOverflow(line(`hi\n${HEADLINE}`, box)).x, 180);
});

/// What the same headline actually sets at, measured rather than guessed:
/// twenty capitals, an `M` among them, and two spaces (`setWidth`).
const HEADLINE_SET = setWidth(HEADLINE, 40);

test("a drawn text is measured at the rectangle it sets in, not at its own box", () => {
  /// The same headline in a 300x60 box: centred, it stands from -136.8 to
  /// 436.8 across and fills 50 of the 60 down, which is the rectangle the
  /// picture shows and the one a band read has to count. `textOverflow` says
  /// 660 and leaves room for 660; this is where the ink lands.
  assert.deepEqual(drawnBounds(line(HEADLINE, { x: 0, y: 0, width: 300, height: 60 })), {
    x: (300 - HEADLINE_SET) / 2,
    y: 5,
    width: HEADLINE_SET,
    height: 50,
  });
});

test("a short line in a wide box is measured at the words, not at the room they were given", () => {
  /// The half the pad could never have found. `put_on_canvas` writes the box the
  /// design asked for and sets the words into it, so a two-character line in a
  /// slot the width of the page is a page-wide rectangle of ink to every reading
  /// off this — 208 of the 579 text draws on the development database are
  /// measured at over twice the ink they hold, and one at 19x.
  const box = { x: 100, y: 0, width: 720, height: 120 };
  const wide = drawnBounds(line("&", box, { fontSize: 94, align: "left", verticalAlign: "top" }));

  assert.equal(wide.width, setWidth("&", 94));
  assert.ok(wide.width < box.width / 4);
  assert.deepEqual([wide.x, wide.y, wide.height], [100, 0, 94 * 1.25]);
});

test("a paragraph broken to the box it was given spills nowhere, whatever the pad says", () => {
  /// The reading that split the two numbers. The put door breaks a block to the
  /// width it was handed (`text-set.ts`), so a wrapped paragraph is inside its
  /// own box by construction — and the flat pad said 112 of the 132 blocks on
  /// the development database hung over theirs.
  const words = "Grown in rich volcanic red soil on the slopes above the valley floor.";
  const block = setBlock(words, 300, 14);
  const box = { x: 0, y: 0, width: 300, height: block.height };
  const wrapped = line(block.text, box, { fontSize: 14, align: "left", verticalAlign: "top" });
  const drawn = drawnBounds(wrapped);

  assert.ok(textOverflow(wrapped).x > 0);
  assert.equal(drawn.height, box.height);
  /// Inside its own box on the axis the break was taken on, rather than equal to
  /// it: the last line of a broken paragraph ends where its words end.
  assert.deepEqual([drawn.x, drawn.y], [box.x, box.y]);
  assert.ok(drawn.width > 0 && drawn.width <= box.width);
});

test("a set line hangs over the side its anchor sends it, and never over the other one", () => {
  const box = { x: 100, y: 0, width: 300, height: 60 };
  const left = drawnBounds(line(HEADLINE, box, { align: "left" }));
  assert.deepEqual([left.x, left.width], [100, HEADLINE_SET]);

  const right = drawnBounds(line(HEADLINE, box, { align: "right" }));
  assert.deepEqual([right.x, right.width], [400 - HEADLINE_SET, HEADLINE_SET]);

  const below = drawnBounds(line("one\ntwo\nthree", box, { verticalAlign: "top" }));
  assert.deepEqual([below.y, below.height], [0, 150]);

  const above = drawnBounds(line("one\ntwo\nthree", box, { verticalAlign: "bottom" }));
  assert.deepEqual([above.y, above.height], [-90, 150]);
});

test("anything that is not text is drawn at its own box, turned", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const outline = {
    kind: "outline",
    type: "diamond",
    id: "d1",
    box,
    angle: 0,
    opacity: 1,
    clip: null,
  } satisfies RenderDraw;

  assert.deepEqual(drawnBounds(outline), box);
  assert.deepEqual(
    drawnBounds({ ...outline, angle: Math.PI / 2 }),
    rotatedBounds(box, Math.PI / 2),
  );
});

test("a turned headline is measured at its set rectangle turned, not its box turned", () => {
  const box = { x: 0, y: 0, width: 300, height: 60 };
  const turned = drawnBounds(line(HEADLINE, box, { angle: Math.PI / 2 }));
  assert.deepEqual(
    turned,
    rotatedBounds({ x: (300 - HEADLINE_SET) / 2, y: 5, width: HEADLINE_SET, height: 50 }, Math.PI / 2),
  );
});

test("every font number the picker offers maps to a mirrored family, and anything else falls back", () => {
  assert.deepEqual(
    [1, 2, 3, 5, 6, 7, 8, 9].map((family) => renderFont(family).dir),
    ["Virgil", "Liberation", "Cascadia", "Excalifont", "Nunito", "Lilita", "ComicShanns", "Liberation"],
  );
  assert.equal(renderFont(undefined).dir, "Excalifont");
  assert.equal(renderFont(999).dir, "Excalifont");
});

test("rectangles, ellipses, lines, arrows and section frames are drawn as themselves", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 100, strokeColor: "#000", backgroundColor: "#eee" },
    { id: "el1", type: "ellipse", x: 0, y: 100, width: 100, height: 100 },
    { id: "l1", type: "line", x: 0, y: 200, width: 100, height: 50, points: [[0, 0], [100, 50]] },
    { id: "a1", type: "arrow", x: 0, y: 300, width: 100, height: 50, points: [[0, 0], [50, 50], [100, 0]], endArrowhead: "arrow" },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.deepEqual(
    plan.draws.map((entry) => [entry.kind, entry.kind === "shape" ? entry.shape : null]),
    [
      ["shape", "rectangle"],
      ["shape", "ellipse"],
      ["shape", "line"],
      ["shape", "arrow"],
    ],
  );
  assert.deepEqual(plan.undrawn, []);

  const arrow = byId(plan, "a1");
  assert.deepEqual(arrow.kind === "shape" && arrow.points, [[0, 0], [50, 50], [100, 0]]);
  assert.equal(arrow.kind === "shape" && arrow.arrowheads.end, "arrow");
});

test("a line's path is scaled with the picture, so a bent arrow still points where it did", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 3200, height: 800 }),
    { id: "a1", type: "arrow", x: 0, y: 0, width: 200, height: 100, points: [[0, 0], [200, 100]] },
  ] satisfies SceneElement[];
  const drawn = byId(pageRenderPlan(elements, onlyPage(elements)), "a1");

  assert.deepEqual(drawn.kind === "shape" && drawn.points, [[0, 0], [100, 50]]);
});

test("a stroke never thins below a pixel, however far the picture is scaled down", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 16000, height: 800 }),
    { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 100, strokeWidth: 2 },
  ] satisfies SceneElement[];
  const drawn = byId(pageRenderPlan(elements, onlyPage(elements)), "r1");

  assert.equal(drawn.kind === "shape" && drawn.strokeWidth, 1);
});

test("anything this cannot draw is an outline and is named", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    { id: "f1", type: "freedraw", x: 0, y: 0, width: 100, height: 100 },
    { id: "f2", type: "freedraw", x: 100, y: 0, width: 100, height: 100 },
    { id: "d1", type: "diamond", x: 200, y: 0, width: 100, height: 100 },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.deepEqual(plan.draws.map((entry) => entry.kind), ["outline", "outline", "outline"]);
  assert.deepEqual(plan.undrawn, [
    { id: "f1", type: "freedraw" },
    { id: "f2", type: "freedraw" },
    { id: "d1", type: "diamond" },
  ]);
  assert.equal(
    undrawnNote(plan.undrawn),
    "Drawn as empty outlines because this renderer cannot draw them: 2 freedraw, 1 diamond.",
  );
});

test("nothing undrawn is nothing said", () => {
  assert.equal(undrawnNote([]), "");
});

test("opacity crosses as a fraction and angle as the scene's own radians", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    image("e1", "ref-a", { x: 0, y: 0, width: 100, height: 100 }, { opacity: 30, angle: 0.5 }),
    image("e2", "ref-b", { x: 100, y: 0, width: 100, height: 100 }),
  ];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.equal(byId(plan, "e1").opacity, 0.3);
  assert.equal(byId(plan, "e1").angle, 0.5);
  assert.equal(byId(plan, "e2").opacity, 1);
  assert.equal(byId(plan, "e2").angle, 0);
});

test("the board's frame is everything on it, padded, and nothing is not a picture", () => {
  assert.deepEqual(
    boardRenderFrame([image("e1", "ref-a", { x: 100, y: 100, width: 200, height: 100 })]),
    { x: 76, y: 76, width: 248, height: 148 },
  );
  assert.equal(boardRenderFrame([]), null);
  assert.equal(boardRenderPlan([]), null);
});

test("a frame reserves the room the export leaves above it for its name", () => {
  /// `addFrameLabelsAsTextElements` puts the frame's title into the export as a
  /// real text element `3 + 14 × 1.25` units over the top edge, and the export's
  /// bounding box takes it in — so a board whose topmost thing is a page is
  /// framed higher than any element on it says.
  assert.deepEqual(boardRenderFrame([page("p1", { x: 0, y: 100, width: 400, height: 300 })]), {
    x: -24,
    y: 55.5,
    width: 448,
    height: 368.5,
  });

  /// Only a frame reaches outside its own rectangle: the same box as an image is
  /// the padding and nothing else.
  assert.deepEqual(
    boardRenderFrame([image("e1", "ref-a", { x: 0, y: 100, width: 400, height: 300 })]),
    { x: -24, y: 76, width: 448, height: 348 },
  );
});

test("a page's members do not widen the board's frame — they are drawn clipped to it", () => {
  const overhanging = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    image("e1", "ref-a", { x: 250, y: 250, width: 200, height: 200 }),
  ];

  /// The photograph reaches 450 and is drawn cut off at the page's own edge, so
  /// counting its whole box here would reserve fifty units of blank board beside
  /// ink that is never drawn. Excalidraw's export frames itself the same way —
  /// `getCanvasSize` is handed `getRootElements`.
  assert.deepEqual(boardRenderFrame(overhanging), {
    x: -24,
    y: -44.5,
    width: 448,
    height: 468.5,
  });

  /// Loose on the canvas rather than on a page, so nothing clips it and it is
  /// part of the picture's own rectangle.
  const loose = [...overhanging, image("e2", "ref-b", { x: 600, y: 0, width: 100, height: 100 })];
  assert.equal(boardRenderFrame(loose)!.width, 748);

  /// One walk decides both, so the plan cannot frame itself around a different
  /// set than it draws.
  assert.deepEqual(boardRenderPlan(overhanging)!.frame, boardRenderFrame(overhanging));
});

test("the picture's pixel size drops the fraction, as the export's canvas does", () => {
  /// `canvas.width = width * scale` on an `unsigned long`, so 933.6 is 933 and
  /// not 934 — the one pixel is what makes the two pictures the same crop.
  assert.deepEqual(renderCanvas({ width: 1968, height: 1148.5 }, 1600), {
    scale: 1600 / 1968,
    width: 1600,
    height: 933,
  });

  /// Never nothing: a rule half a pixel high at a board-wide downscale is still
  /// a picture.
  assert.equal(renderCanvas({ width: 1000, height: 0.4 }, 1000).height, 1);
});

test("a board draws its pages' members in a run behind their page, clipped to it", () => {
  const elements = [
    image("early", "ref-a", { x: 20, y: 20, width: 100, height: 100 }),
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    image("loose", "ref-b", { x: 600, y: 0, width: 100, height: 100 }),
  ];
  const plan = boardRenderPlan(elements, { max: 100_000 })!;

  /// `early` sits on the page and is drawn after it, whatever the array says.
  assert.deepEqual(plan.draws.map((entry) => entry.id), ["p1", "early", "loose"]);
  assert.equal(byId(plan, "loose").clip, null);
  assert.deepEqual(byId(plan, "early").clip, {
    x: 0 - plan.frame.x,
    y: 0 - plan.frame.y,
    width: 400,
    height: 400,
  });
});

test("the board's background is the scene's own, and white when it has none", () => {
  const elements = [image("e1", "ref-a", { x: 0, y: 0, width: 100, height: 100 })];

  assert.equal(boardRenderPlan(elements)!.background, RENDER_BACKGROUND);
  assert.equal(boardRenderPlan(elements, { background: "#1e1e1e" })!.background, "#1e1e1e");
  assert.equal(boardRenderPlan(elements, { background: 42 })!.background, RENDER_BACKGROUND);
});

test("a rotated box grows into the bounding one a compositor is handed", () => {
  assert.deepEqual(rotatedBounds({ x: 0, y: 0, width: 100, height: 100 }, 0), {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });

  const square = rotatedBounds({ x: 0, y: 0, width: 100, height: 100 }, Math.PI / 4);
  assert.ok(Math.abs(square.width - Math.SQRT2 * 100) < 1e-9);
  assert.ok(Math.abs(square.height - Math.SQRT2 * 100) < 1e-9);
  /// Grown about the centre, so the box moves up and to the left by half of it.
  assert.ok(Math.abs(square.x - (100 - Math.SQRT2 * 100) / 2) < 1e-9);
});

test("a box inside the picture is placed whole", () => {
  assert.deepEqual(clipToFrame({ x: 10, y: 20, width: 30, height: 40 }, { width: 100, height: 100 }), {
    left: 10,
    top: 20,
    sourceLeft: 0,
    sourceTop: 0,
    width: 30,
    height: 40,
  });
});

test("a box over the top-left edge is cut rather than placed at a negative offset", () => {
  assert.deepEqual(clipToFrame({ x: -10, y: -5, width: 30, height: 40 }, { width: 100, height: 100 }), {
    left: 0,
    top: 0,
    sourceLeft: 10,
    sourceTop: 5,
    width: 20,
    height: 35,
  });
});

test("a box over the bottom-right edge keeps only what fits", () => {
  assert.deepEqual(clipToFrame({ x: 90, y: 80, width: 30, height: 40 }, { width: 100, height: 100 }), {
    left: 90,
    top: 80,
    sourceLeft: 0,
    sourceTop: 0,
    width: 10,
    height: 20,
  });
});

test("a box entirely off the picture is not drawn at all", () => {
  assert.equal(clipToFrame({ x: 200, y: 0, width: 30, height: 40 }, { width: 100, height: 100 }), null);
  assert.equal(clipToFrame({ x: -50, y: 0, width: 30, height: 40 }, { width: 100, height: 100 }), null);
});

/// The disagreement `npm run render:check` found against excalidraw's own
/// export on every real board: a page's row carries a near-black stroke that
/// the editor and the export both ignore in favour of `FRAME_STYLE`, so
/// following the row put a heavy border around a page the user sees a pale one
/// around. A board render is where it shows — a page render is *of* the page,
/// so the page's own frame is the picture rather than a shape in it.
test("a page frame is drawn in excalidraw's own frame style rather than the row's", () => {
  const elements = [
    page(
      "p1",
      { x: 0, y: 0, width: 800, height: 800 },
      { strokeColor: "#1e1e1e", strokeWidth: 8, strokeStyle: "dashed", roundness: { type: 3 } },
    ),
  ] satisfies SceneElement[];
  const plan = boardRenderPlan(elements);
  assert.ok(plan);
  const drawn = byId(plan, "p1");

  assert.equal(drawn.kind === "shape" && drawn.stroke, "#bbb");
  assert.equal(drawn.kind === "shape" && drawn.strokeWidth, 2);
  assert.equal(drawn.kind === "shape" && drawn.strokeStyle, "solid");
  assert.equal(drawn.kind === "shape" && drawn.radius, 0);
});

/// A section is a frame too and the editor draws it in the same grey, so the
/// restyling is by element type rather than by whether the frame is a page.
test("a section frame takes the frame style as well", () => {
  const elements = [
    {
      id: "s1",
      type: "frame",
      name: "left half",
      x: 0,
      y: 0,
      width: 400,
      height: 800,
      strokeColor: "#ff0000",
      strokeWidth: 6,
    },
  ] satisfies SceneElement[];
  const plan = boardRenderPlan(elements);
  assert.ok(plan);
  const drawn = byId(plan, "s1");

  assert.equal(drawn.kind === "shape" && drawn.shape, "frame");
  assert.equal(drawn.kind === "shape" && drawn.stroke, "#bbb");
  assert.equal(drawn.kind === "shape" && drawn.strokeWidth, 2);
});

test("a rectangle beside it still keeps its own stroke, so only frames are restyled", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    {
      id: "r1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: "#ff0000",
      strokeWidth: 4,
      strokeStyle: "dashed",
    },
  ] satisfies SceneElement[];
  const drawn = byId(pageRenderPlan(elements, onlyPage(elements)), "r1");

  assert.equal(drawn.kind === "shape" && drawn.stroke, "#ff0000");
  /// 4.5 rather than 4 because the stroke is dashed — the half unit excalidraw
  /// adds back after turning roughjs's second pass off. The number the model set
  /// is still 4 and `shapeAppearance` still says so.
  assert.equal(drawn.kind === "shape" && drawn.strokeWidth, 4.5);
  assert.equal(drawn.kind === "shape" && drawn.strokeStyle, "dashed");
});

/// Excalidraw's dash is a fixed length whatever the stroke and only the gap
/// grows with it — the opposite of the proportional pair this renderer drew for
/// as long as nothing could ask for a dashed border. A hairline came out at a
/// quarter of the export's period and a heavy one with dashes four times too
/// long.
test("a dashed and a dotted stroke take excalidraw's own runs, and a solid one takes none", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    {
      id: "dashed",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 2,
      strokeStyle: "dashed",
    },
    {
      id: "dotted",
      type: "rectangle",
      x: 0,
      y: 200,
      width: 100,
      height: 100,
      strokeWidth: 2,
      strokeStyle: "dotted",
    },
    {
      id: "solid",
      type: "rectangle",
      x: 0,
      y: 400,
      width: 100,
      height: 100,
      strokeWidth: 2,
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const dashed = byId(plan, "dashed");
  assert.deepEqual(dashed.kind === "shape" && dashed.dash, [8, 10]);
  const dotted = byId(plan, "dotted");
  assert.deepEqual(dotted.kind === "shape" && dotted.dash, [1.5, 8]);
  const solid = byId(plan, "solid");
  assert.equal(solid.kind === "shape" && solid.dash, null);
  /// The bump goes with the dash and only with it.
  assert.equal(dashed.kind === "shape" && dashed.strokeWidth, 2.5);
  assert.equal(solid.kind === "shape" && solid.strokeWidth, 2);
});

/// The run is in scene units in excalidraw and in output pixels here, so it has
/// to travel with everything else the plan scales — a dash left unscaled draws
/// a board-wide downscale as a nearly solid line.
test("a dash scales down with the picture the way the stroke does", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 3200, height: 1600 }),
    {
      id: "rule",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      strokeWidth: 2,
      strokeStyle: "dashed",
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));
  const scale = plan.width / 3200;
  assert.ok(scale < 1);

  const drawn = byId(plan, "rule");
  assert.deepEqual(drawn.kind === "shape" && drawn.dash, [8 * scale, 10 * scale]);
});

/// A frame is drawn in `FRAME_STYLE` whatever it carries (§XI.4), and that is
/// the one style with no dash in it — so a page whose element happens to hold a
/// dashed stroke is still the solid hairline both renderers draw a page as.
test("a page's own frame takes neither the dash nor the bump", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }, { strokeStyle: "dashed", strokeWidth: 6 }),
  ] satisfies SceneElement[];
  const plan = boardRenderPlan(elements);
  assert.ok(plan);
  const drawn = byId(plan, "p1");

  assert.equal(drawn.kind === "shape" && drawn.dash, null);
  assert.equal(drawn.kind === "shape" && drawn.strokeStyle, "solid");
  assert.equal(drawn.kind === "shape" && drawn.strokeWidth, 2, "the frame's own width, unbumped");
});

/// Excalidraw's adaptive radius is a ceiling in *scene* units, and this file
/// held it as a ceiling in output pixels for as long as the arithmetic lived in
/// the rasteriser. Every box past the cutoff came out with the same 32px corner
/// however far the picture was scaled down — 144 of the 189 rounded rectangles
/// on the development database, a median 1.23x too round and one 6.6x.
test("the adaptive ceiling is a scene-unit ceiling and scales with the picture", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 3200, height: 1600 }),
    {
      id: "panel",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      roundness: { type: 3 },
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));
  const scale = plan.width / 3200;
  assert.ok(scale < 1);

  const drawn = byId(plan, "panel");
  assert.equal(drawn.kind === "shape" && drawn.radius, 32 * scale);
});

/// Below the cutoff the ceiling is not reached and the corner is a quarter of
/// the shorter side — which is the half of the rule that made the defect hard to
/// see, because a chip small enough to be under the ceiling was always drawn
/// right.
test("a box under the cutoff takes a quarter of its shorter side", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    { id: "chip", type: "rectangle", x: 0, y: 0, width: 200, height: 80, roundness: { type: 3 } },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.equal(plan.scale, 1);
  const chip = byId(plan, "chip");
  assert.equal(chip.kind === "shape" && chip.radius, 20);
});

/// The other roundness model, which `restyle_on_canvas` writes on a line
/// (`object-style.ts`) and excalidraw writes on a diamond: a quarter of the
/// shorter side however large the box, with no ceiling at all. A ceiling applied
/// here would square off the corners of anything page-sized.
test("the proportional model takes its quarter uncapped", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    { id: "wide", type: "rectangle", x: 0, y: 0, width: 600, height: 400, roundness: { type: 2 } },
    { id: "old", type: "rectangle", x: 0, y: 500, width: 600, height: 400, roundness: { type: 1 } },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const wide = byId(plan, "wide");
  const old = byId(plan, "old");
  assert.equal(wide.kind === "shape" && wide.radius, 100);
  assert.equal(old.kind === "shape" && old.radius, 100);
});

/// The ceiling is a field on the element rather than a constant, and it moves
/// the cutoff with it — excalidraw does not offer the field in its UI, but a
/// scene pasted in from anywhere may carry one and the two numbers are one rule.
test("a roundness carrying its own value moves both the ceiling and the cutoff", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    {
      id: "big",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      roundness: { type: 3, value: 12 },
    },
    {
      id: "small",
      type: "rectangle",
      x: 0,
      y: 500,
      width: 600,
      height: 40,
      roundness: { type: 3, value: 12 },
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const big = byId(plan, "big");
  const small = byId(plan, "small");
  assert.equal(big.kind === "shape" && big.radius, 12);
  assert.equal(small.kind === "shape" && small.radius, 10);
});

/// The frame's stroke scales with the picture like every other one, and stops
/// at a pixel for the same reason: a page frame the model cannot see is a page
/// whose edge it has to infer from where the photographs stop.
test("a frame's stroke scales down with the picture and stops at a pixel", () => {
  const elements = [page("p1", { x: 0, y: 0, width: 16000, height: 800 })] satisfies SceneElement[];
  const plan = boardRenderPlan(elements);
  assert.ok(plan);
  const drawn = byId(plan, "p1");

  assert.equal(drawn.kind === "shape" && drawn.strokeWidth, 1);
});

/// The toolbar puts its current background colour on every new element, so an
/// open line carrying one is what a user's own board looks like — and
/// excalidraw paints none of it. Everything that reads a fill reads this one.
test("an open line's stored fill is not a fill, and a closed loop's is", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    {
      id: "rule",
      type: "line",
      x: 0,
      y: 100,
      width: 700,
      height: 0,
      backgroundColor: "#ffcc00",
      points: [[0, 0], [350, 0], [700, 0]],
    },
    {
      id: "loop",
      type: "line",
      x: 0,
      y: 200,
      width: 200,
      height: 200,
      backgroundColor: "#ffcc00",
      points: [[0, 0], [200, 0], [200, 200], [0, 0]],
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const rule = byId(plan, "rule");
  const loop = byId(plan, "loop");
  assert.equal(rule.kind === "shape" && rule.fill, "transparent");
  assert.equal(loop.kind === "shape" && loop.fill, "#ffcc00");
});

test("an arrow and a frame never take a fill, whatever the scene stores on them", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }, { backgroundColor: "#ffcc00" }),
    {
      id: "a1",
      type: "arrow",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      backgroundColor: "#ffcc00",
      points: [[0, 0], [200, 0], [200, 200], [0, 0]],
    },
  ] satisfies SceneElement[];
  const plan = boardRenderPlan(elements);
  assert.ok(plan);

  const arrow = byId(plan, "a1");
  const frame = byId(plan, "p1");
  assert.equal(arrow.kind === "shape" && arrow.fill, "transparent");
  assert.equal(frame.kind === "shape" && frame.fill, "transparent");
});

/// Excalidraw's own `isPathALoop`: three points as well as the gap, because a
/// two-point line whose ends coincide is a dot, and eight scene units because
/// that is where the editor decides the hand meant to close the path.
test("a loop is three points with ends within eight units, and nothing looser", () => {
  const shut = (points: [number, number][], id: string): SceneElement => ({
    id,
    type: "line",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    backgroundColor: "#ffcc00",
    points,
  });
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    shut([[0, 0], [200, 0], [0, 0]], "three"),
    shut([[0, 0], [200, 0], [8, 0]], "eight"),
    shut([[0, 0], [200, 0], [9, 0]], "nine"),
    shut([[0, 0], [0, 0]], "two"),
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));
  const fillOf = (id: string) => {
    const drawn = byId(plan, id);
    return drawn.kind === "shape" ? drawn.fill : null;
  };

  assert.deepEqual(
    ["three", "eight", "nine", "two"].map(fillOf),
    ["#ffcc00", "#ffcc00", "transparent", "transparent"],
  );
});

/// The ink is measured in the face the picture draws, which is the read half of
/// the same rule the write doors keep (`font-set.ts`). A model told its headline
/// clears the right margin by a fifth of the page, in a face that sets a fifth
/// wider than the measure said, is being told about a page that does not exist.
test("a line's ink is measured in the face it is drawn in", () => {
  const box = { x: 0, y: 0, width: 900, height: 60 };
  const words = "made by hand in small batches";
  const inFace = (family: number) =>
    drawnBounds(line(words, box, { fontSize: 40, font: renderFont(family), align: "left" })).width;

  const mono = inFace(FONT_FAMILIES.mono);
  const display = inFace(FONT_FAMILIES.display);
  assert.equal(mono, setWidth(words, 40, renderFont(FONT_FAMILIES.mono).set));
  assert.ok(mono > display * 1.1, `${mono} is not comfortably over ${display}`);
  /// And the family nothing names is the one the plan defaults to, so a scene
  /// element with no `fontFamily` is measured as excalidraw draws it.
  assert.equal(inFace(NaN), setWidth(words, 40, DEFAULT_RENDER_FONT.set));
});

/// The line tool's own default is round edges (`currentItemRoundness`), so the
/// ordinary three-point line a user draws carries `roundness` and excalidraw
/// hands it to roughjs's `curve` rather than its `linearPath` — a bend where
/// this renderer drew a dogleg. The picture the model judges and the picture the
/// user sees were different shapes (§III.2.1).
test("a bent line carrying roundness is planned as a curve", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    {
      id: "bent",
      type: "line",
      x: 100,
      y: 100,
      width: 400,
      height: 200,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [200, 200],
        [400, 0],
      ],
    },
    {
      id: "dogleg",
      type: "line",
      x: 100,
      y: 400,
      width: 400,
      height: 200,
      points: [
        [0, 0],
        [200, 200],
        [400, 0],
      ],
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const bent = byId(plan, "bent");
  const dogleg = byId(plan, "dogleg");
  assert.equal(bent.kind === "shape" && bent.curve, true);
  assert.equal(dogleg.kind === "shape" && dogleg.curve, false);
});

/// The spline through two points is that chord, so the plan says false and the
/// rasteriser keeps its polyline: a plan that described the same picture two
/// ways would be a second thing to keep in step for no gain. All 110 lines on
/// the development database are two-point, which is why nothing rendered today
/// moves.
test("a two-point line is straight however its roundness is stored", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    {
      id: "rule",
      type: "line",
      x: 100,
      y: 100,
      width: 400,
      height: 0,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [400, 0],
      ],
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const rule = byId(plan, "rule");
  assert.equal(rule.kind === "shape" && rule.curve, false);
});

/// An elbowed arrow goes down a third branch of excalidraw's own switch, which
/// rounds its right angles by a fixed sixteen units and is not a spline at all.
/// Reading its roundness as a curve would draw a bowed arrow where the export
/// draws a square-shouldered one.
test("an elbowed arrow is not splined", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 800 }),
    {
      id: "elbow",
      type: "arrow",
      x: 100,
      y: 100,
      width: 400,
      height: 200,
      elbowed: true,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [400, 0],
        [400, 200],
      ],
    },
    {
      id: "free",
      type: "arrow",
      x: 100,
      y: 400,
      width: 400,
      height: 200,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [400, 0],
        [400, 200],
      ],
    },
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const elbow = byId(plan, "elbow");
  const free = byId(plan, "free");
  assert.equal(elbow.kind === "shape" && elbow.curve, false);
  assert.equal(free.kind === "shape" && free.curve, true);
});

/// The sketched stroke (`render/sketch.ts`). Excalidraw's own
/// `DEFAULT_ELEMENT_PROPS.roughness` is 1, so the box a user drew with the
/// toolbar has a hand-drawn outline and this renderer drew an exact rectangle.
/// The style dialect writes 0 on everything the agents put down, which is why
/// nothing the app made moves.
test("a shape carrying excalidraw's own roughness is planned as a hand-drawn walk", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 600 }),
    shape("exact", "rectangle", { x: 50, y: 50, width: 300, height: 200 }, { roughness: 0 }),
    shape("hand", "rectangle", { x: 400, y: 50, width: 300, height: 200 }, { roughness: 1, seed: 7 }),
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  const exact = byId(plan, "exact");
  const hand = byId(plan, "hand");
  assert.equal(exact.kind === "shape" && exact.sketch, null);
  assert.ok(hand.kind === "shape" && hand.sketch);
  assert.deepEqual(
    hand.kind === "shape" ? hand.sketch?.paths.map((path) => path.role) : null,
    ["stroke"],
  );
});

/// The rule iterations 41 and 42 landed the dash run and the corner radius on,
/// asked of the third thing that has to obey it. roughjs displaces a hand-drawn
/// edge by absolute units — `maxRandomnessOffset` is 2, not 2% — so a walk
/// generated on an already-scaled box wobbles by the same pixels at every zoom,
/// which on a whole-board picture is every shape drawn as if it were a metre
/// across. Generated in scene units and scaled, the same element at half the
/// picture's size is the same walk at half the size.
test("the sketch is generated in scene units and scaled with the picture", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 600 }),
    shape("hand", "rectangle", { x: 50, y: 50, width: 300, height: 200 }, { roughness: 1, seed: 7 }),
  ] satisfies SceneElement[];

  const whole = pageRenderPlan(elements, onlyPage(elements), { max: 800 });
  const half = pageRenderPlan(elements, onlyPage(elements), { max: 400 });
  assert.equal(whole.scale, 1);
  assert.equal(half.scale, 0.5);

  const numbers = (plan: RenderPlan) => {
    const draw = byId(plan, "hand");
    const d = draw.kind === "shape" ? (draw.sketch?.paths[0]?.d ?? "") : "";
    return d.split(/[^-\d.]+/).filter(Boolean).map(Number);
  };
  const full = numbers(whole);
  const small = numbers(half);
  assert.ok(full.length > 8);
  assert.equal(small.length, full.length);
  for (const [at, value] of full.entries()) {
    assert.ok(Math.abs(small[at]! - value / 2) <= 0.01, `${small[at]} is not half of ${value}`);
  }
});

/// Excalidraw's `adjustRoughness`: the same two-unit wobble that reads as a hand
/// on a page-wide panel is an illegible scribble on a chip, so a small shape is
/// drawn less roughly than it says. Three ways to be big enough and two
/// divisors below that.
test("a small shape is drawn less roughly than it says", () => {
  assert.equal(adjustedRoughness(1, "rectangle", 300, 200, false), 1);
  /// Both sides relatively big is the first test — 19 wide fails it however
  /// long the box is.
  assert.equal(adjustedRoughness(1, "rectangle", 19, 400, false), 0.5);
  /// Rounded and above 15 is the second, and a `line` is in excalidraw's
  /// `canChangeRoundness` where an `ellipse` is not.
  assert.equal(adjustedRoughness(1, "rectangle", 16, 16, true), 1);
  assert.equal(adjustedRoughness(1, "ellipse", 16, 16, true), 0.5);
  /// A long linear element is the third, and it is the only one an arrow can
  /// pass on its own.
  assert.equal(adjustedRoughness(1, "arrow", 60, 2, false), 1);
  /// Under ten units it is divided by three rather than by two, and the whole
  /// is capped at 2.5 whatever was asked.
  assert.equal(adjustedRoughness(3, "rectangle", 9, 9, false), 1);
  assert.equal(adjustedRoughness(9, "rectangle", 40, 40, false), 2.5);
});

/// A frame takes none of it for the reason it takes neither the dash nor the
/// radius: excalidraw draws every frame in `FRAME_STYLE` (§XI.4), so a page
/// whose element carries a roughness is still a plain grey rectangle. An
/// elbowed arrow takes none because this renderer draws its dogleg rather than
/// excalidraw's rounded shoulders (§XI.2) — sketching the wrong path would put
/// a hand on a shape that is already in the wrong place.
///
/// The elbow is the half that bites: a frame is refused twice over, by name in
/// the plan and by `drawable`'s switch, which knows only the shapes excalidraw
/// hands roughjs at all. The frame line is the guard on the day one of those
/// two goes.
test("a frame and an elbowed arrow take no sketch", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 600 }, { roughness: 2, seed: 3 }),
    {
      id: "elbow",
      type: "arrow",
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      roughness: 1,
      seed: 3,
      elbowed: true,
      points: [
        [0, 0],
        [300, 0],
        [300, 200],
      ],
    },
  ] satisfies SceneElement[];
  const plan = boardRenderPlan(elements);
  assert.ok(plan);

  const frame = byId(plan, "p1");
  const elbow = byId(plan, "elbow");
  assert.equal(frame.kind === "shape" && frame.sketch, null);
  assert.equal(elbow.kind === "shape" && elbow.sketch, null);
});

/// The other half of what roughness turns on: a non-solid `fillStyle` is not
/// paint at all, it is lines. roughjs strokes them at `fillWeight`, which
/// excalidraw pins to half the element's stroke width so that the half unit it
/// adds back for a dashed border does not thicken the shading inside it too.
test("a hachured fill is planned as lines at roughjs's own weight", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 800, height: 600 }),
    shape(
      "hatched",
      "rectangle",
      { x: 50, y: 50, width: 300, height: 200 },
      { roughness: 1, seed: 7, fillStyle: "hachure", backgroundColor: "#ff0000", strokeWidth: 4 },
    ),
  ] satisfies SceneElement[];
  const plan = pageRenderPlan(elements, onlyPage(elements), { max: 400 });
  assert.equal(plan.scale, 0.5);

  const draw = byId(plan, "hatched");
  assert.ok(draw.kind === "shape" && draw.sketch);
  assert.deepEqual(
    draw.kind === "shape" ? draw.sketch?.paths.map((path) => path.role) : null,
    ["hachure", "stroke"],
  );
  assert.equal(draw.kind === "shape" ? draw.sketch?.hachureWidth : null, 1);
});
