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
  undrawnNote,
  DEFAULT_RENDER_FONT,
  type RenderDraw,
  type RenderPlan,
  type TextDraw,
} from "@/lib/render/render-plan";
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

test("an image naming bytes the project never stored is an outline, not a hole", () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 400, height: 400 }),
    image("pasted", null, { x: 0, y: 0, width: 100, height: 100 }, { fileId: "abc123" }),
  ];
  const plan = pageRenderPlan(elements, onlyPage(elements));

  assert.equal(byId(plan, "pasted").kind, "outline");
  assert.deepEqual(plan.undrawn, [{ id: "pasted", type: "image" }]);
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
  assert.equal(drawn.kind === "shape" && drawn.rounded, false);
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
  assert.equal(drawn.kind === "shape" && drawn.strokeWidth, 4);
  assert.equal(drawn.kind === "shape" && drawn.strokeStyle, "dashed");
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
