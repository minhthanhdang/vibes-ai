import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { rasterise } = await import("./rasterise");
const { boardRenderPlan, pageRenderPlan, RENDER_BACKGROUND } = await import(
  "@/lib/render/render-plan"
);
const { boardPages } = await import("@/lib/pages/board-pages");
const { BOARD_RENDER_PADDING } = await import("@/lib/scene/moodboard-render");

type SceneElement = Record<string, unknown> & { id: string; type: string };
type Box = { x: number; y: number; width: number; height: number };

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];

function page(id: string, box: Box, extra: Record<string, unknown> = {}): SceneElement {
  return { id, type: "frame", name: id, customData: { page: {} }, ...box, ...extra };
}

function image(id: string, referenceId: string, box: Box, extra: Record<string, unknown> = {}) {
  return { id, type: "image", fileId: `ref:${referenceId}`, ...box, ...extra } as SceneElement;
}

/// A frame in one colour with a marker block in its top-left quarter, so a draw
/// can be checked for showing the part of the photograph it was asked for rather
/// than merely a rectangle of the right size.
async function photo(width: number, height: number, background = "#ff0000") {
  const marker = await sharp({
    create: {
      width: Math.round(width / 2),
      height: Math.round(height / 2),
      channels: 3,
      background: "#00ff00",
    },
  })
    .png()
    .toBuffer();

  const bytes = await sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: marker, left: 0, top: 0 }])
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

const bytesFrom =
  (pictures: Record<string, Uint8Array>) => async (referenceId: string) =>
    pictures[referenceId] ?? null;

const nothing = async () => null;

async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { data } = await sharp(bytes)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}

const near = (a: number[], b: number[], slack = 24) =>
  a.every((value, index) => Math.abs(value - b[index]!) <= slack);

async function assertPixel(
  bytes: Uint8Array,
  x: number,
  y: number,
  expected: number[],
  slack?: number,
) {
  const found = await pixel(bytes, x, y);
  assert.ok(near(found, expected, slack), `at ${x},${y} expected ${expected} and found ${found}`);
}

/// How much of the picture is not the paper it was drawn on — enough to tell
/// "something was drawn here" from "nothing was", which is all several of these
/// cases need.
async function inked(bytes: Uint8Array, box: Box) {
  const { data, info } = await sharp(bytes)
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let count = 0;
  for (let at = 0; at < data.length; at += info.channels) {
    if (!near([data[at]!, data[at + 1]!, data[at + 2]!], WHITE, 8)) count += 1;
  }
  return count;
}

const A4 = { x: 0, y: 0, width: 400, height: 400 };
const onlyPage = (elements: SceneElement[]) => boardPages(elements as never)[0]!;

test("the picture is the plan's own size, on the plan's own background", async () => {
  const elements = [page("p1", A4, { backgroundColor: "#ffffff" })];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, nothing);

  const size = await sharp(bytes).metadata();
  assert.deepEqual({ width: size.width, height: size.height }, { width: 400, height: 400 });
  assert.equal(plan.background, RENDER_BACKGROUND);
  await assertPixel(bytes, 5, 5, WHITE);
});

test("a photograph lands inside its own box and nowhere else", async () => {
  const elements = [page("p1", A4), image("e1", "ref-a", { x: 100, y: 100, width: 200, height: 100 })];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes, undrawn } = await rasterise(plan, bytesFrom({ "ref-a": await photo(40, 40, "#0000ff") }));

  assert.deepEqual(undrawn, []);
  await assertPixel(bytes, 250, 150, BLUE);
  await assertPixel(bytes, 90, 150, WHITE);
  await assertPixel(bytes, 250, 210, WHITE);
});

test("a cropped element shows the region it names rather than the whole frame", async () => {
  const whole = { x: 0, y: 0, width: 200, height: 200 };
  const elements = [
    page("p1", A4),
    image("whole", "ref-a", whole),
    image("region", "ref-a", { x: 200, y: 200, width: 200, height: 200 }, {
      crop: { x: 0, y: 0, width: 50, height: 50, naturalWidth: 100, naturalHeight: 100 },
    }),
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, bytesFrom({ "ref-a": await photo(100, 100) }));

  /// The uncropped copy keeps the marker in its own top-left quarter and red
  /// elsewhere; the cropped one shows the marker quarter over its whole box.
  await assertPixel(bytes, 50, 50, GREEN);
  await assertPixel(bytes, 150, 150, RED);
  await assertPixel(bytes, 300, 300, GREEN);
  await assertPixel(bytes, 380, 380, GREEN);
});

test("an element hanging over the top-left edge is cut, not shifted inwards", async () => {
  const elements = [page("p1", A4), image("over", "ref-a", { x: -50, y: -50, width: 100, height: 100 })];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, bytesFrom({ "ref-a": await photo(40, 40, "#0000ff") }));

  await assertPixel(bytes, 2, 2, BLUE);
  await assertPixel(bytes, 45, 45, BLUE);
  await assertPixel(bytes, 60, 60, WHITE);
});

test("on a board, a page's member is clipped to that page's rectangle", async () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 200, height: 200 }, { backgroundColor: "#ffffff" }),
    /// Its centre is on the page, which is what makes it a member of it, and
    /// its right edge is not — so the page rect is what cuts it.
    image("over", "ref-a", { x: 100, y: 50, width: 150, height: 100 }),
  ];
  const plan = boardRenderPlan(elements as never);
  assert.ok(plan);
  const { bytes } = await rasterise(plan, bytesFrom({ "ref-a": await photo(40, 40, "#0000ff") }));

  /// The board frame is padded, so the page's own left edge sits at the pad.
  const pad = BOARD_RENDER_PADDING;
  await assertPixel(bytes, pad + 190, pad + 120, BLUE);
  await assertPixel(bytes, pad + 210, pad + 120, WHITE);
});

test("an image whose bytes never arrive is outlined and named as undrawn", async () => {
  const box = { x: 100, y: 100, width: 200, height: 100 };
  const elements = [page("p1", A4), image("gone", "ref-a", box)];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes, undrawn } = await rasterise(plan, nothing);

  assert.deepEqual(undrawn, [{ id: "gone", type: "image" }]);
  assert.ok((await inked(bytes, box)) > 0, "nothing was drawn where the photograph was");
  await assertPixel(bytes, 200, 150, WHITE);
});

test("a reader that throws is the same answer as one that finds nothing", async () => {
  const elements = [
    page("p1", A4),
    image("gone", "ref-a", { x: 100, y: 100, width: 200, height: 100 }),
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { undrawn } = await rasterise(plan, async () => {
    throw new Error("the bucket said no");
  });

  assert.deepEqual(undrawn, [{ id: "gone", type: "image" }]);
});

test("the plan's own undrawn list is carried through and its outline is drawn", async () => {
  const box = { x: 50, y: 50, width: 200, height: 200 };
  const elements = [page("p1", A4), { id: "scribble", type: "freedraw", ...box } as SceneElement];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes, undrawn } = await rasterise(plan, nothing);

  assert.deepEqual(undrawn, [{ id: "scribble", type: "freedraw" }]);
  assert.ok((await inked(bytes, box)) > 0, "the freedraw was not outlined");
});

test("a rectangle is drawn filled and stroked", async () => {
  const elements = [
    page("p1", A4),
    {
      id: "r1",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      backgroundColor: "#0000ff",
      strokeColor: "#ff0000",
      strokeWidth: 8,
    } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes, undrawn } = await rasterise(plan, nothing);

  assert.deepEqual(undrawn, []);
  await assertPixel(bytes, 200, 200, BLUE);
  await assertPixel(bytes, 200, 100, RED);
  await assertPixel(bytes, 200, 50, WHITE);
});

/// Where the gaps in a dashed border fall, which is the whole of what a dash
/// is. Excalidraw's run is a fixed 8 units of ink and a gap of 8 plus the
/// stroke, so at width 4 the second dash starts at 20 — this renderer used to
/// draw 16 on and 16 off, which puts ink exactly where the export puts paper
/// and paper exactly where it puts ink.
test("a dashed border's gaps fall where excalidraw's own run puts them", async () => {
  const elements = [
    page("p1", A4),
    {
      id: "r1",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      backgroundColor: "transparent",
      strokeColor: "#ff0000",
      strokeWidth: 4,
      strokeStyle: "dashed",
    } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, nothing);

  /// The top edge runs right from the corner the dash is measured from.
  await assertPixel(bytes, 100, 100, RED);
  await assertPixel(bytes, 114, 100, WHITE);
  await assertPixel(bytes, 124, 100, RED);
});

/// Excalidraw's export puts `stroke-linecap: round` on every shape it draws, so
/// a rule ends in a half-round of its own weight rather than square on its last
/// point. Invisible on a closed path, which is why it survived: it is half a
/// stroke at each end of every line on every board.
test("a rule ends in a round cap, past its own last point", async () => {
  const elements = [
    page("p1", A4),
    {
      id: "l1",
      type: "line",
      x: 100,
      y: 200,
      width: 200,
      height: 0,
      strokeColor: "#ff0000",
      strokeWidth: 20,
      points: [
        [0, 0],
        [200, 0],
      ],
    } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, nothing);

  await assertPixel(bytes, 300, 200, RED);
  await assertPixel(bytes, 305, 200, RED);
  await assertPixel(bytes, 315, 200, WHITE);
});

/// The other half of a filled loop, and the only place the two fill rules draw
/// different pictures: a path that crosses itself. Excalidraw's export sets
/// `fill-rule: evenodd` on one, so the middle of a star drawn with the line tool
/// is paper — the default rule fills it in.
test("a star drawn with the line tool is hollow at the centre, the way the export draws it", async () => {
  const elements = [
    page("p1", A4),
    {
      id: "star",
      type: "line",
      x: 100,
      y: 100,
      width: 195,
      height: 181,
      backgroundColor: "#0000ff",
      strokeColor: "#ff0000",
      strokeWidth: 2,
      points: [
        [100, 0],
        [158.8, 180.9],
        [4.9, 69.1],
        [195.1, 69.1],
        [41.2, 180.9],
        [100, 0],
      ],
    } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, nothing);

  await assertPixel(bytes, 200, 140, BLUE);
  await assertPixel(bytes, 200, 200, WHITE);
});

test("a transparent background leaves the paper showing through", async () => {
  const elements = [
    page("p1", A4),
    {
      id: "r1",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      backgroundColor: "transparent",
      strokeColor: "#ff0000",
      strokeWidth: 8,
    } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, nothing);

  await assertPixel(bytes, 200, 200, WHITE);
  await assertPixel(bytes, 200, 100, RED);
});

test("text is set inside its own box, in a face that loads or one that stands in for it", async () => {
  const box = { x: 40, y: 40, width: 320, height: 60 };
  const elements = [
    page("p1", A4),
    { id: "t1", type: "text", text: "Save the date", fontSize: 36, strokeColor: "#000000", ...box } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes, undrawn } = await rasterise(plan, nothing);

  assert.deepEqual(undrawn, []);
  assert.ok((await inked(bytes, box)) > 200, "no ink where the words are");
  assert.equal(await inked(bytes, { x: 40, y: 200, width: 320, height: 60 }), 0);
});

test("two lines of text are set one under the other", async () => {
  const box = { x: 40, y: 40, width: 320, height: 120 };
  const elements = [
    page("p1", A4),
    { id: "t1", type: "text", text: "Save\nthe date", fontSize: 36, strokeColor: "#000000", ...box } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, nothing);

  assert.ok((await inked(bytes, { x: 40, y: 40, width: 320, height: 60 })) > 100, "no first line");
  assert.ok((await inked(bytes, { x: 40, y: 100, width: 320, height: 60 })) > 100, "no second line");
});

/// A headline written into a box narrower than its own words, which is the
/// ordinary case rather than the odd one: `put_on_canvas` takes the type size
/// from the box's height and never measures the string against its width.
const HEADLINE = { text: "MOUNT REYES LIGHTHOUSE", fontSize: 72 };
const CENTRED = { textAlign: "center", verticalAlign: "middle" };

test("a headline wider than its box is set whole, spilling either side of it", async () => {
  const wide = { x: 0, y: 0, width: 1200, height: 500 };
  const box = { x: 400, y: 150, width: 400, height: 90 };
  const elements = [
    page("p1", wide),
    { id: "t1", type: "text", ...HEADLINE, strokeColor: "#000000", ...CENTRED, ...box } as SceneElement,
  ];
  const { bytes } = await rasterise(pageRenderPlan(elements as never, onlyPage(elements)), nothing);

  const band = { y: 150, width: 180, height: 100 };
  assert.ok((await inked(bytes, { x: 200, ...band })) > 0, "cut off at the left of its box");
  assert.ok((await inked(bytes, { x: 820, ...band })) > 0, "cut off at the right of its box");
});

test("more lines than the box is tall are set above and below it rather than cut", async () => {
  const wide = { x: 0, y: 0, width: 600, height: 500 };
  const box = { x: 100, y: 200, width: 400, height: 90 };
  const elements = [
    page("p1", wide),
    { id: "t1", type: "text", text: "one\ntwo\nthree", fontSize: 72, strokeColor: "#000000", ...CENTRED, ...box } as SceneElement,
  ];
  const { bytes } = await rasterise(pageRenderPlan(elements as never, onlyPage(elements)), nothing);

  /// Both bands sit outside the box and outside the room a single line's
  /// descenders would have needed, so either one is ink that only the overflow
  /// left room for.
  assert.ok((await inked(bytes, { x: 100, y: 120, width: 400, height: 40 })) > 0, "first line lost");
  assert.ok((await inked(bytes, { x: 100, y: 335, width: 400, height: 40 })) > 0, "third line lost");
});

test("what a line spills past the page is still cut at the page, not drawn outside it", async () => {
  const small = { x: 0, y: 0, width: 500, height: 300 };
  const box = { x: 50, y: 100, width: 400, height: 90 };
  const elements = [
    page("p1", small),
    { id: "t1", type: "text", ...HEADLINE, strokeColor: "#000000", ...CENTRED, ...box } as SceneElement,
  ];
  const { bytes } = await rasterise(pageRenderPlan(elements as never, onlyPage(elements)), nothing);

  const size = await sharp(bytes).metadata();
  assert.deepEqual({ width: size.width, height: size.height }, { width: 500, height: 300 });
  /// Hard against both edges, which is what a line running off the page looks
  /// like — and the page is still the picture.
  assert.ok((await inked(bytes, { x: 0, y: 100, width: 4, height: 90 })) > 0, "not cut at the left edge");
  assert.ok((await inked(bytes, { x: 496, y: 100, width: 4, height: 90 })) > 0, "not cut at the right edge");
});

test("array order is z-order: the later element is the one on top", async () => {
  const overlap = { x: 100, y: 100, width: 200, height: 200 };
  const under = { id: "under", type: "rectangle", backgroundColor: "#ff0000", strokeColor: "#ff0000", ...overlap };
  const over = { id: "over", type: "rectangle", backgroundColor: "#0000ff", strokeColor: "#0000ff", ...overlap };
  const elements = [page("p1", A4), under as SceneElement, over as SceneElement];
  const { bytes } = await rasterise(
    pageRenderPlan(elements as never, onlyPage(elements)),
    nothing,
  );

  await assertPixel(bytes, 200, 200, BLUE);
});

test("a half-opaque element is drawn half-opaque", async () => {
  const elements = [
    page("p1", A4),
    image("faded", "ref-a", { x: 100, y: 100, width: 200, height: 200 }, { opacity: 50 }),
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, bytesFrom({ "ref-a": await photo(40, 40, "#0000ff") }));

  /// Blue at half over white paper, which is neither the blue nor the paper.
  await assertPixel(bytes, 250, 250, [128, 128, 255], 30);
});

test("a flipped element is drawn mirrored", async () => {
  const elements = [
    page("p1", A4),
    image("flipped", "ref-a", { x: 0, y: 0, width: 200, height: 200 }, { scale: [-1, 1] }),
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, bytesFrom({ "ref-a": await photo(100, 100) }));

  /// The marker is the source's top-left quarter, so mirrored it is the top
  /// right of the placement.
  await assertPixel(bytes, 150, 50, GREEN);
  await assertPixel(bytes, 50, 50, RED);
});

test("a turned element is drawn turned, about the centre of its own box", async () => {
  const elements = [
    page("p1", A4),
    image("turned", "ref-a", { x: 100, y: 150, width: 200, height: 100 }, {
      angle: Math.PI / 2,
    }),
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, bytesFrom({ "ref-a": await photo(40, 40, "#0000ff") }));

  /// A quarter turn about the box's centre puts a 200×100 placement into a
  /// 100×200 one on the same centre: taller than it was and no longer covering
  /// the corners it used to.
  await assertPixel(bytes, 170, 150, BLUE);
  await assertPixel(bytes, 200, 280, BLUE);
  await assertPixel(bytes, 120, 200, WHITE);
  await assertPixel(bytes, 280, 200, WHITE);
});

test("a board with pages and loose work draws both", async () => {
  const elements = [
    page("p1", { x: 0, y: 0, width: 200, height: 200 }),
    image("on-page", "ref-a", { x: 20, y: 20, width: 100, height: 100 }),
    image("loose", "ref-b", { x: 400, y: 0, width: 100, height: 100 }),
  ];
  const plan = boardRenderPlan(elements as never);
  assert.ok(plan);
  const { bytes } = await rasterise(
    plan,
    bytesFrom({ "ref-a": await photo(40, 40, "#0000ff"), "ref-b": await photo(40, 40, "#00ff00") }),
  );

  const pad = BOARD_RENDER_PADDING;
  await assertPixel(bytes, pad + 100, pad + 100, BLUE);
  await assertPixel(bytes, pad + 450, pad + 50, GREEN);
});

test("on a machine with no fonts on it, text is outlined and named rather than lost", async () => {
  const box = { x: 40, y: 40, width: 320, height: 60 };
  const elements = [
    page("p1", A4),
    { id: "t1", type: "text", text: "Save the date", fontSize: 36, strokeColor: "#000000", ...box } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes, undrawn } = await rasterise(plan, nothing, { fontsLoad: async () => false });

  assert.deepEqual(undrawn, [{ id: "t1", type: "text" }]);
  assert.ok((await inked(bytes, box)) > 0, "not even an outline where the words were");
});

test("this machine can set type, so the ordinary path is the one the rest of these take", async () => {
  const elements = [
    page("p1", A4),
    { id: "t1", type: "text", text: "H", fontSize: 36, strokeColor: "#000000", x: 40, y: 40, width: 40, height: 50 } as SceneElement,
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { undrawn } = await rasterise(plan, nothing);

  assert.deepEqual(undrawn, []);
});

/// A closed path drawn with the line tool is a polygon in excalidraw's own
/// export and was an outline here, so a user's colour block came back to the
/// model as empty page. The plan decides whether there is paint; this checks
/// that the paint lands.
test("a line whose path closes is filled, and an open one is not", async () => {
  const loop = (id: string, y: number, points: [number, number][]) =>
    ({
      id,
      type: "line",
      x: 100,
      y,
      width: 200,
      height: 100,
      backgroundColor: "#0000ff",
      strokeColor: "#ff0000",
      strokeWidth: 4,
      points,
    }) as SceneElement;
  const elements = [
    page("p1", A4),
    loop("shut", 50, [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
      [0, 0],
    ]),
    loop("open", 250, [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]),
  ];
  const plan = pageRenderPlan(elements as never, onlyPage(elements));
  const { bytes } = await rasterise(plan, nothing);

  await assertPixel(bytes, 200, 100, BLUE);
  await assertPixel(bytes, 200, 300, WHITE);
});
