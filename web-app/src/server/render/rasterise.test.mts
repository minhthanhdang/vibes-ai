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
