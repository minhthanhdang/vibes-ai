import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import type { ModelRenderScene, RenderStore } from "./for-model";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const {
  RENDER_TIMEOUT_MS,
  countedRenders,
  projectReferenceBytes,
  renderForModel,
  undrawnFromMetadata,
} = await import("./for-model");
const { RENDER_BACKGROUND } = await import("@/lib/render/render-plan");

type Box = { x: number; y: number; width: number; height: number };
type Element = Record<string, unknown> & { id: string; type: string };

function page(id: string, box: Box): Element {
  return { id, type: "frame", name: id, customData: { page: {} }, ...box };
}

function image(id: string, referenceId: string, box: Box): Element {
  return { id, type: "image", fileId: `ref:${referenceId}`, ...box };
}

function scene(elements: Element[], extra: Partial<ModelRenderScene> = {}): ModelRenderScene {
  return { projectId: "cproj1", revision: 3, elements, ...extra };
}

async function photo(width: number, height: number, background = "#ff0000") {
  const bytes = await sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

/// A bucket that remembers, so the second call of a test is the cache hit the
/// second call in a round would be.
function store() {
  const objects = new Map<string, { bytes: Uint8Array; undrawn: { id: string; type: string }[] }>();
  const heads: string[] = [];
  const puts: string[] = [];
  const fake: RenderStore = {
    async head(path) {
      heads.push(path);
      const held = objects.get(path);
      return held ? { undrawn: held.undrawn } : null;
    },
    async put(path, bytes, undrawn) {
      puts.push(path);
      objects.set(path, { bytes, undrawn: [...undrawn] });
    },
  };
  return { fake, objects, heads, puts };
}

/// A page with nothing standing on it, band by band — what the read of an empty
/// page comes to, spelled once because three tests below assert on it.
const EMPTY_BANDS = [
  { from: 0, to: 1 / 3, covered: 0 },
  { from: 1 / 3, to: 2 / 3, covered: 0 },
  { from: 2 / 3, to: 1, covered: 0 },
];

const nothing = async () => null;
const typeSets = async () => true;

test("a page render is named for the page and the revision it was read at", async () => {
  const { fake, puts } = store();
  const answer = await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([page("p1", { x: 0, y: 0, width: 80, height: 60 })]),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.deepEqual(answer, {
    uri: "gs://test-bucket/renders/pages/p1@3.png",
    revision: 3,
    drawn: "made",
    undrawn: [],
    occupancy: { axis: "y", bands: EMPTY_BANDS, covered: 0, backdrops: 0 },
  });
  assert.deepEqual(puts, ["renders/pages/p1@3.png"]);
});

test("a board render is named for the board, under its own prefix", async () => {
  const { fake } = store();
  const answer = await renderForModel(
    {
      boardId: "b1",
      scene: scene([page("p1", { x: 0, y: 0, width: 80, height: 60 })], { revision: 11 }),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.equal("failed" in answer, false);
  assert.equal((answer as { uri: string }).uri, "gs://test-bucket/renders/boards/b1@11.png");
});

test("the bytes are a PNG of the page's own size", async () => {
  const { fake, objects } = store();
  await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([page("p1", { x: 10, y: 10, width: 200, height: 100 })]),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  const drawn = objects.get("renders/pages/p1@3.png");
  assert.ok(drawn);
  const meta = await sharp(drawn.bytes).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100);
});

test("the second call at one revision is a HEAD and no draw", async () => {
  const { fake, heads, puts } = store();
  const request = {
    boardId: "b1",
    pageId: "p1",
    scene: scene([page("p1", { x: 0, y: 0, width: 40, height: 40 })]),
  };

  const first = await renderForModel(request, {
    store: fake,
    bytesOf: nothing,
    fontsLoad: typeSets,
  });
  const second = await renderForModel(request, {
    store: fake,
    bytesOf: nothing,
    fontsLoad: typeSets,
  });

  assert.equal((first as { drawn: string }).drawn, "made");
  assert.equal((second as { drawn: string }).drawn, "cached");
  assert.deepEqual(puts, ["renders/pages/p1@3.png"]);
  assert.equal(heads.length, 2);
});

test("a write moves the revision, so the next call draws again", async () => {
  const { fake, puts } = store();
  const elements = [page("p1", { x: 0, y: 0, width: 40, height: 40 })];
  const options = { store: fake, bytesOf: nothing, fontsLoad: typeSets };

  await renderForModel({ boardId: "b1", pageId: "p1", scene: scene(elements) }, options);
  const after = await renderForModel(
    { boardId: "b1", pageId: "p1", scene: scene(elements, { revision: 4 }) },
    options,
  );

  assert.equal((after as { drawn: string }).drawn, "made");
  assert.deepEqual(puts, ["renders/pages/p1@3.png", "renders/pages/p1@4.png"]);
});

test("what was not drawn is stored beside the bytes and comes back with the cache hit", async () => {
  const { fake, objects } = store();
  const request = {
    boardId: "b1",
    pageId: "p1",
    scene: scene([
      page("p1", { x: 0, y: 0, width: 80, height: 80 }),
      { id: "s1", type: "freedraw", x: 10, y: 10, width: 20, height: 20 },
    ]),
  };
  const options = { store: fake, bytesOf: nothing, fontsLoad: typeSets };

  const made = await renderForModel(request, options);
  const cached = await renderForModel(request, options);

  assert.deepEqual((made as { undrawn: unknown }).undrawn, [{ id: "s1", type: "freedraw" }]);
  assert.deepEqual(objects.get("renders/pages/p1@3.png")?.undrawn, [
    { id: "s1", type: "freedraw" },
  ]);
  assert.deepEqual((cached as { undrawn: unknown }).undrawn, [{ id: "s1", type: "freedraw" }]);
});

test("a photograph the bucket would not give up is undrawn, and the rest is still drawn", async () => {
  const { fake } = store();
  const answer = await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([
        page("p1", { x: 0, y: 0, width: 100, height: 100 }),
        image("i1", "r1", { x: 10, y: 10, width: 40, height: 40 }),
      ]),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.equal((answer as { drawn: string }).drawn, "made");
  assert.deepEqual((answer as { undrawn: unknown }).undrawn, [{ id: "i1", type: "image" }]);
});

test("the scene's own background is the picture's", async () => {
  const { fake, objects } = store();
  await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([page("p1", { x: 0, y: 0, width: 20, height: 20 })], {
        appState: { viewBackgroundColor: "#0000ff" },
      }),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  const { data } = await sharp(objects.get("renders/pages/p1@3.png")!.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([data[0], data[1], data[2]], [0, 0, 255]);
  assert.notEqual(RENDER_BACKGROUND, "#0000ff");
});

test("a page id nothing on the board answers to is refused by name, unwritten", async () => {
  const { fake, heads, puts } = store();
  const answer = await renderForModel(
    {
      boardId: "b1",
      pageId: "p9",
      scene: scene([page("p1", { x: 0, y: 0, width: 40, height: 40 })]),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.equal((answer as { failed: boolean }).failed, true);
  assert.match((answer as { reason: string }).reason, /no page called p9/);
  assert.deepEqual(heads, []);
  assert.deepEqual(puts, []);
});

test("a board with nothing on it is said in words rather than drawn blank", async () => {
  const { fake, puts } = store();
  const answer = await renderForModel(
    { boardId: "b1", scene: scene([]) },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.equal((answer as { failed: boolean }).failed, true);
  assert.match((answer as { reason: string }).reason, /nothing on it/);
  assert.deepEqual(puts, []);
});

test("a bucket that will not say whether the object exists is a miss, not a failure", async () => {
  const { fake, puts } = store();
  const refusing: RenderStore = {
    head: async () => {
      throw new Error("503");
    },
    put: fake.put,
  };

  const answer = await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([page("p1", { x: 0, y: 0, width: 40, height: 40 })]),
    },
    { store: refusing, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.equal((answer as { drawn: string }).drawn, "made");
  assert.deepEqual(puts, ["renders/pages/p1@3.png"]);
});

test("a draw that runs out of clock says so, in seconds", async () => {
  const slow: RenderStore = {
    head: () => new Promise((resolve) => setTimeout(() => resolve(null), 40)),
    put: async () => {},
  };

  const answer = await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([page("p1", { x: 0, y: 0, width: 40, height: 40 })]),
    },
    { store: slow, bytesOf: nothing, fontsLoad: typeSets, timeoutMs: 5 },
  );

  assert.equal((answer as { failed: boolean }).failed, true);
  assert.match((answer as { reason: string }).reason, /did not finish drawing that page within/);
});

test("a bucket that refuses the write fails with what it said, told apart from a timeout", async () => {
  const failing: RenderStore = {
    head: async () => null,
    put: async () => {
      throw new Error("bucket said no");
    },
  };

  const answer = await renderForModel(
    { boardId: "b1", scene: scene([page("p1", { x: 0, y: 0, width: 40, height: 40 })]) },
    { store: failing, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.equal((answer as { failed: boolean }).failed, true);
  assert.match((answer as { reason: string }).reason, /failed to draw that board: bucket said no/);
});

test("the default budget is the spec's eight seconds", () => {
  assert.equal(RENDER_TIMEOUT_MS, 8_000);
});

test("the thumbnail is asked for by name and the original is the fallback", async () => {
  const read: string[] = [];
  const bytesOf = projectReferenceBytes("cproj1", {
    rows: async () => [
      { id: "r1", gcsUri: "gs://b/full-1.jpg", thumbGcsUri: "gs://b/thumb-1.jpg" },
      { id: "r2", gcsUri: "gs://b/full-2.jpg", thumbGcsUri: null },
    ],
    read: async (uri) => {
      read.push(uri);
      return new Uint8Array([1]);
    },
  });

  await bytesOf("r1", "thumb");
  await bytesOf("r1", "full");
  await bytesOf("r2", "thumb");
  assert.deepEqual(read, ["gs://b/thumb-1.jpg", "gs://b/full-1.jpg", "gs://b/full-2.jpg"]);
});

test("one row query and one download, however many placements ask", async () => {
  let queries = 0;
  const read: string[] = [];
  const bytesOf = projectReferenceBytes("cproj1", {
    rows: async () => {
      queries += 1;
      return [{ id: "r1", gcsUri: "gs://b/full-1.jpg", thumbGcsUri: null }];
    },
    read: async (uri) => {
      read.push(uri);
      return new Uint8Array([1]);
    },
  });

  await Promise.all([bytesOf("r1", "full"), bytesOf("r1", "full"), bytesOf("r1", "thumb")]);
  assert.equal(queries, 1);
  assert.deepEqual(read, ["gs://b/full-1.jpg"]);
});

test("a reference this project does not hold is no bytes rather than a read", async () => {
  let reads = 0;
  const bytesOf = projectReferenceBytes("cproj1", {
    rows: async () => [],
    read: async () => {
      reads += 1;
      return new Uint8Array([1]);
    },
  });

  assert.equal(await bytesOf("r1", "full"), null);
  assert.equal(reads, 0);
});

test("an object too large to hold is no bytes rather than a thrown render", async () => {
  const bytesOf = projectReferenceBytes("cproj1", {
    rows: async () => [{ id: "r1", gcsUri: "gs://b/full-1.jpg", thumbGcsUri: null }],
    read: async () => {
      throw new Error("too large");
    },
  });

  assert.equal(await bytesOf("r1", "full"), null);
});

test("a photograph in hand is composited", async () => {
  const { fake, objects } = store();
  const bytes = await photo(40, 40, "#00ff00");
  await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([
        page("p1", { x: 0, y: 0, width: 60, height: 60 }),
        image("i1", "r1", { x: 10, y: 10, width: 40, height: 40 }),
      ]),
    },
    {
      store: fake,
      bytesOf: projectReferenceBytes("cproj1", {
        rows: async () => [{ id: "r1", gcsUri: "gs://b/full-1.png", thumbGcsUri: null }],
        read: async () => bytes,
      }),
      fontsLoad: typeSets,
    },
  );

  const { data } = await sharp(objects.get("renders/pages/p1@3.png")!.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const offset = (y * 60 + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  assert.deepEqual(at(30, 30), [0, 255, 0]);
  assert.deepEqual(at(2, 2), [255, 255, 255]);
});

test("metadata nobody wrote reads as no list rather than as a wrong one", () => {
  assert.deepEqual(undrawnFromMetadata(undefined), []);
  assert.deepEqual(undrawnFromMetadata("{"), []);
  assert.deepEqual(undrawnFromMetadata('{"id":"a"}'), []);
  assert.deepEqual(undrawnFromMetadata('[{"id":"a"},{"id":"b","type":"freedraw"}]'), [
    { id: "b", type: "freedraw" },
  ]);
});

test("the counted render answers exactly what it was given, and tallies the three", async () => {
  const read = { axis: "y" as const, bands: [], covered: 0, backdrops: 0 };
  const answers = [
    {
      uri: "gs://b/renders/pages/p1@3.png",
      revision: 3,
      drawn: "made" as const,
      undrawn: [],
      occupancy: read,
    },
    {
      uri: "gs://b/renders/pages/p1@3.png",
      revision: 3,
      drawn: "cached" as const,
      undrawn: [],
      occupancy: read,
    },
    { failed: true as const, reason: "the renderer did not finish drawing that page" },
    {
      uri: "gs://b/renders/boards/b1@4.png",
      revision: 4,
      drawn: "cached" as const,
      undrawn: [],
      occupancy: read,
    },
  ];
  let asked = 0;
  const counted = countedRenders((async () => answers[asked++]!) as typeof renderForModel);

  const seen = [];
  for (let i = 0; i < answers.length; i += 1) {
    seen.push(await counted.render({ boardId: "b1", scene: scene([]) }));
  }

  /// The decorator is not allowed to be a second opinion about the picture: a
  /// tool that sends what this returned has to be sending the render's own
  /// answer, uri, undrawn list and all.
  assert.deepEqual(seen, answers);
  assert.deepEqual(counted.drew(), { made: 1, cached: 2, failed: 1 });
});

test("a render nobody called is a tally of nothing, and the tally does not move under the caller", async () => {
  const counted = countedRenders((async () => ({
    uri: "gs://b/renders/boards/b1@3.png",
    revision: 3,
    drawn: "made" as const,
    undrawn: [],
    occupancy: { axis: "y" as const, bands: [], covered: 0, backdrops: 0 },
  })) as typeof renderForModel);

  assert.deepEqual(counted.drew(), { made: 0, cached: 0, failed: 0 });

  /// Read once and held: a caller that wrote the counts onto a row and then
  /// drew again would otherwise find the row's numbers had changed under it.
  const before = counted.drew();
  await counted.render({ boardId: "b1", scene: scene([]) });
  assert.deepEqual(before, { made: 0, cached: 0, failed: 0 });
  assert.deepEqual(counted.drew(), { made: 1, cached: 0, failed: 0 });
});

/// The band read is off the plan and the plan is built before the HEAD, so the
/// answer that costs nothing to draw is the one most likely to be missing it —
/// and a `get_page` that looked twice without writing would then say how the
/// page stands on the first look and go quiet on the second.
test("how the page stands comes back with the cache hit as readily as with the draw", async () => {
  const { fake } = store();
  const request = {
    boardId: "b1",
    pageId: "p1",
    scene: scene([
      page("p1", { x: 0, y: 0, width: 90, height: 90 }),
      image("el1", "a", { x: 0, y: 0, width: 90, height: 30 }),
    ]),
  };
  const options = { store: fake, bytesOf: nothing, fontsLoad: typeSets };

  const made = await renderForModel(request, options);
  const cached = await renderForModel(request, options);

  assert.equal((cached as { drawn: string }).drawn, "cached");
  assert.deepEqual(
    (made as { occupancy: { bands: { covered: number }[] } }).occupancy.bands.map((band) =>
      Math.round(band.covered * 100),
    ),
    [100, 0, 0],
  );
  assert.deepEqual(
    (cached as { occupancy: unknown }).occupancy,
    (made as { occupancy: unknown }).occupancy,
  );
});

/// The round the model has nothing else to go on. The read is arithmetic over
/// the scene the caller already handed in, so a clock that ran out inside sharp
/// has taken the picture away and not this.
test("a draw that ran out of clock still says how the page stands", async () => {
  const slow: RenderStore = {
    head: () => new Promise((resolve) => setTimeout(() => resolve(null), 40)),
    put: async () => {},
  };

  const answer = await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([
        page("p1", { x: 0, y: 0, width: 90, height: 90 }),
        image("el1", "a", { x: 0, y: 60, width: 90, height: 30 }),
      ]),
    },
    { store: slow, bytesOf: nothing, fontsLoad: typeSets, timeoutMs: 5 },
  );

  assert.equal((answer as { failed: boolean }).failed, true);
  assert.deepEqual(
    (answer as { occupancy?: { bands: { covered: number }[] } }).occupancy?.bands.map((band) =>
      Math.round(band.covered * 100),
    ),
    [0, 0, 100],
  );
});

/// A page the renderer never planned has no read to give, and an empty one
/// would read as a page with nothing on it — which is a different answer from
/// "there is no such page".
test("a page nothing answers to fails with no band read at all", async () => {
  const { fake } = store();
  const answer = await renderForModel(
    {
      boardId: "b1",
      pageId: "p9",
      scene: scene([page("p1", { x: 0, y: 0, width: 40, height: 40 })]),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  assert.equal((answer as { failed: boolean }).failed, true);
  assert.equal((answer as { occupancy?: unknown }).occupancy, undefined);
});

test("a page's ground is drawn — the model sees the colour the page is painted", async () => {
  const { fake, objects } = store();
  const box = { x: 0, y: 0, width: 40, height: 40 };
  await renderForModel(
    {
      boardId: "b1",
      pageId: "p1",
      scene: scene([
        {
          id: "ground",
          type: "rectangle",
          ...box,
          backgroundColor: "#00ff00",
          strokeColor: "transparent",
          fillStyle: "solid",
          roughness: 0,
          locked: true,
          customData: { pageBackground: true },
        },
        page("p1", box),
      ]),
    },
    { store: fake, bytesOf: nothing, fontsLoad: typeSets },
  );

  const { data } = await sharp(objects.get("renders/pages/p1@3.png")!.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    [data[0], data[1], data[2]],
    [0, 255, 0],
    "no new rendering code — a rectangle is a rectangle to the renderer (§XI.4)",
  );
});
