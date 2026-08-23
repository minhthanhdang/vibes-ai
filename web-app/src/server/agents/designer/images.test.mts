import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUT_STATUS,
  GENERATED_STATUS,
  GENERATED_UNSIZED_STATUS,
  imageToolset,
  ownPictureBudget,
} from "./images";
import { galleryToolset } from "./gallery";
import { designerReferences } from "./references";
import { CROP_CALL_LIMIT, GENERATE_CALL_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { CROP_IMAGE, DESIGNER_GENERATE_IMAGE } from "@/lib/agent/designer-tools";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Cut } from "@/server/references/cut";

/// The executor half of agent 8's `generate_image` (compositor-v2.md §IV.4).
///
/// The sequence between the ask and the row is agent 6's, shared through
/// `@/server/references/tool-generation` and covered by agent 6's own tests. So
/// what this file asserts is the four things that are agent 8's: the completion
/// rule (bytes and row before the answer), the id resolving for the round after
/// this one, the ceiling being the turn's, and an answer with no tile, no bucket
/// path and no vocabulary from the other agent.

function png(width: number, height: number) {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return new Uint8Array(header);
}

type Row = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  editAspect: string;
  editRationale: string;
  cropBox: number[];
  isFavorite: boolean;
  gcsUri: string;
  thumbGcsUri: string | null;
  origin: "UPLOADED" | "IMPORTED" | "GENERATED";
  generationPrompt: string | null;
  source: { id: string; title: string } | null;
  analysis: Record<string, unknown> | null;
};

function photo(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    title: `${id}.jpg`,
    width: 4000,
    height: 3000,
    editIntent: "",
    editAspect: "",
    editRationale: "",
    cropBox: [],
    isFavorite: false,
    gcsUri: `gs://director-bucket/uploads/${id}.jpg`,
    thumbGcsUri: null,
    origin: "UPLOADED",
    generationPrompt: null,
    source: null,
    analysis: { lighting: ["golden-hour"] },
    ...over,
  };
}

/// A page is a marked `frame` and its name is the element's, not the marker's.
function pageFrame(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: "frame",
    name: "Welcome sign",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    customData: { page: { preset: "LANDSCAPE_HD" } },
    ...over,
  };
}

function imageOn(id: string, referenceId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: "image",
    fileId: `ref:${referenceId}`,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    ...over,
  };
}

type Call = { table: string; op: string; args: Record<string, unknown> };

function fakeDb(rows: readonly Row[], elements: unknown[] | null = null) {
  const calls: Call[] = [];
  const filed: Row[] = [];
  const runs: Record<string, unknown>[] = [];
  let next = 0;

  const create = async (args: Record<string, unknown>) => {
    calls.push({ table: "reference", op: "create", args });
    next += 1;
    const data = args.data as Record<string, unknown>;
    /// A cut and a drawing come through the same door — `fileVersion` writes a
    /// `sourceReferenceId` and the generator does not — so the fake tells them
    /// apart the one way the columns do.
    const cutOf = data.sourceReferenceId as string | undefined;
    const row = photo(`made-${next}`, {
      title: data.title as string,
      origin: cutOf ? "UPLOADED" : "GENERATED",
      generationPrompt: (data.generationPrompt as string) ?? null,
      gcsUri: data.gcsUri as string,
      width: (data.width as number) ?? null,
      height: (data.height as number) ?? null,
      editIntent: (data.editIntent as string) ?? "",
      editAspect: (data.editAspect as string) ?? "",
      editRationale: (data.editRationale as string) ?? "",
      cropBox: (data.cropBox as number[]) ?? [],
      source: cutOf ? { id: cutOf, title: `${cutOf}.jpg` } : null,
      analysis: null,
    });
    filed.push(row);
    return row;
  };

  const db = {
    reference: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ table: "reference", op: "findMany", args });
        return rows;
      },
      create,
    },
    agentRun: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ table: "agentRun", op: "findMany", args });
        return [];
      },
      create: async (args: Record<string, unknown>) => {
        calls.push({ table: "agentRun", op: "create", args });
        runs.push(args.data as Record<string, unknown>);
        return { id: `run-${runs.length}` };
      },
      update: async (args: Record<string, unknown>) => {
        calls.push({ table: "agentRun", op: "update", args });
        return {};
      },
    },
    analysisJob: { upsert: async () => ({}), create: async () => ({}) },
    moodboard: {
      findFirst: async (args: Record<string, unknown>) => {
        calls.push({ table: "moodboard", op: "findFirst", args });
        const where = args.where as { id: string; projectId: string };
        /// Scoped by the fixture's own project rather than by the argument's,
        /// so a cross-project read is something a test can still catch.
        return elements && where.id === "b1" && where.projectId === "p1" ? { elements } : null;
      },
    },
    $transaction: async (body: (tx: unknown) => Promise<unknown>) => body(db),
  } as unknown as PrismaClient;

  return { db, calls, filed, runs };
}

const BOX = { ymin: 200, xmin: 200, ymax: 800, xmax: 800 };

/// Agent 3, as this file holds it: it answers a box and nothing here decodes
/// anything. `cropper.test.mts` is where the model call is tested and
/// `cut.test.mts` is where the pixels are.
function cropping(over: Record<string, unknown> = {}) {
  const asked: Record<string, unknown>[] = [];
  const crop = async (input: unknown) => {
    asked.push(input as Record<string, unknown>);
    return {
      model: "gemini-flash",
      box: BOX,
      intent: "the bride at the arch",
      rationale: "the subject fills the centre third",
      attempts: 1,
      usage: { promptTokens: 900, outputTokens: 40, totalTokens: 940 },
      ...over,
    };
  };
  return { asked, crop: crop as never };
}

function cutting(size = { width: 1200, height: 1200 }) {
  const cuts: { gcsUri: string; region: unknown }[] = [];
  const cutRegion = async (gcsUri: string, region: unknown): Promise<Cut> => {
    cuts.push({ gcsUri, region });
    return {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      ...size,
      thumbnail: null,
    };
  };
  return { cuts, cutRegion: cutRegion as never };
}

const drew = (bytes: Uint8Array, over: Record<string, unknown> = {}) =>
  (async () => ({
    model: "gemini-3-pro-image",
    mimeType: "image/png",
    bytes,
    attempts: 1,
    usage: { promptTokens: 10, outputTokens: 20, totalTokens: 30 },
    ...over,
  })) as never;

function images(
  rows: readonly Row[] = [],
  over: {
    generate?: unknown;
    storeImage?: (contentType: string, bytes: Uint8Array) => Promise<string>;
    crop?: unknown;
    cutRegion?: unknown;
    elements?: unknown[] | null;
    budget?: ReturnType<typeof ownPictureBudget>;
  } = {},
) {
  const { db, calls, filed, runs } = fakeDb(rows, over.elements ?? null);
  const stored: { contentType: string; bytes: Uint8Array }[] = [];
  const kicked: true[] = [];
  const references = designerReferences({ db, projectId: "p1" });
  /// Named here rather than left to the toolset's default, so a test can read
  /// what the design spent off the object the turn would have been holding.
  const budget = over.budget ?? ownPictureBudget();
  const toolset = imageToolset({
    db,
    projectId: "p1",
    boardId: "b1",
    references,
    budget,
    generate: (over.generate ?? drew(png(1024, 1024))) as never,
    crop: (over.crop ?? cropping().crop) as never,
    cutRegion: (over.cutRegion ?? cutting().cutRegion) as never,
    storeImage: async (contentType, bytes) => {
      stored.push({ contentType, bytes });
      return over.storeImage
        ? await over.storeImage(contentType, bytes)
        : `gs://director-bucket/uploads/made-${stored.length}.png`;
    },
    kickAnalyzer: () => void kicked.push(true),
  });
  return { ...toolset, db, calls, filed, runs, stored, kicked, references, budget };
}

test("the toolset offers both image tools and answers null for a name it does not own", async () => {
  const { declarations, execute } = images();
  assert.deepEqual(
    declarations.map(({ name }) => name),
    [DESIGNER_GENERATE_IMAGE.name, CROP_IMAGE.name],
  );
  assert.equal(await execute({ name: "put_on_canvas", args: {} }), null);
});

/// Requirement 4 of the task, and §IV.4's completion rule: the call does not
/// answer until both halves have landed.
test("the bytes are stored and the row is filed before the answer names an id", async () => {
  const { execute, stored, filed, kicked } = images();
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A dusk gradient in warm grey" },
  });

  assert.ok(outcome);
  const result = outcome.result as Record<string, unknown>;
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.contentType, "image/png");
  assert.equal(filed.length, 1);
  assert.equal(result.imageId, filed[0]!.id);
  assert.equal(filed[0]!.origin, "GENERATED");
  assert.equal(filed[0]!.generationPrompt, "A dusk gradient in warm grey");
  /// Filed, not awaited: the reading is minutes behind and the next round does
  /// not need it.
  assert.deepEqual(kicked, [true]);
});

test("the picture's size comes off the header and rides in the answer", async () => {
  const { execute } = images([], { generate: drew(png(1376, 768)) });
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A paper texture" },
  });
  const result = outcome!.result as Record<string, unknown>;
  assert.equal(result.width, 1376);
  assert.equal(result.height, 768);
  assert.equal(result.status, GENERATED_STATUS);
});

test("a header that will not give up a size is said rather than left out", async () => {
  const { execute } = images([], { generate: drew(new Uint8Array([1, 2, 3])) });
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A wash of colour" },
  });
  const result = outcome!.result as Record<string, unknown>;
  assert.equal(result.width, undefined);
  assert.equal(result.status, GENERATED_UNSIZED_STATUS);
});

/// The id in the answer is the whole promise of the tool, and the read it has to
/// resolve against was memoised before the picture existed.
test("the filed picture is in the gallery the same design reads on the next round", async () => {
  const { execute, db, references } = images([photo("a")]);
  const gallery = galleryToolset({ db, projectId: "p1", references });

  const before = await gallery.execute({ name: "list_gallery", args: {} });
  assert.equal((before!.result as { total: number }).total, 1);

  const made = await execute({
    name: "generate_image",
    args: { description: "A pale linen backdrop" },
  });
  const imageId = (made!.result as { imageId: string }).imageId;

  const after = await gallery.execute({ name: "list_gallery", args: {} });
  const listed = after!.result as { total: number; images: { id: string }[] };
  assert.equal(listed.total, 2);
  assert.ok(listed.images.some((image) => image.id === imageId));

  const looked = await gallery.execute({ name: "get_image", args: { imageId } });
  assert.equal((looked!.result as { error?: string }).error, undefined);
});

test("only one read of the project's pictures is paid for however many rounds file one", async () => {
  const { execute, calls } = images([photo("a")]);
  await execute({ name: "generate_image", args: { description: "One" } });
  await execute({ name: "generate_image", args: { description: "Two" } });
  assert.equal(calls.filter((call) => call.table === "reference" && call.op === "findMany").length, 1);
});

/// §VII: every ceiling is reported rather than silently applied.
test("the turn's ceiling holds across the design's rounds and the refusal is said", async () => {
  const { execute, stored } = images();
  for (let asked = 0; asked < GENERATE_CALL_LIMIT; asked += 1) {
    const outcome = await execute({
      name: "generate_image",
      args: { description: `Backdrop ${asked}` },
    });
    assert.equal((outcome!.result as { error?: string }).error, undefined);
  }

  const refused = await execute({ name: "generate_image", args: { description: "One more" } });
  const error = (refused!.result as { error: string }).error;
  assert.match(error, new RegExp(`${GENERATE_CALL_LIMIT} pictures`));
  assert.equal(stored.length, GENERATE_CALL_LIMIT);
});

test("a shape that cannot be read is refused before the ceiling is spent", async () => {
  const { execute, stored } = images();
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A wash", aspect: "portraity" },
  });
  assert.match((outcome!.result as { error: string }).error, /is not a shape a picture can be drawn at/);
  assert.equal(stored.length, 0);

  /// The refusal cost no place: the two the turn is allowed are both still there.
  for (let asked = 0; asked < GENERATE_CALL_LIMIT; asked += 1) {
    const drawn = await execute({ name: "generate_image", args: { description: `Try ${asked}` } });
    assert.equal((drawn!.result as { error?: string }).error, undefined);
  }
});

test("an empty description is refused rather than drawn", async () => {
  const { execute, stored } = images();
  const outcome = await execute({ name: "generate_image", args: { description: "   " } });
  assert.equal((outcome!.result as { error: string }).error, "say what the picture should show");
  assert.equal(stored.length, 0);
});

/// The drawing model composes at its own canvas sizes, and the next thing agent
/// 8 does with this answer is write a box for it.
test("a drawing that came back off the asked shape says so and names agent 8's crop", async () => {
  const { execute } = images([], { generate: drew(png(1024, 1024)) });
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A dusk gradient", aspect: "16:9" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "16:9");
  assert.match(result.drawnAt, /1024×1024/);
  assert.match(result.drawnAt, /crop_image/);
  assert.doesNotMatch(result.drawnAt, /crop_reference/);
});

test("a drawing at the shape that was asked for says nothing about it", async () => {
  const { execute } = images([], { generate: drew(png(1600, 900)) });
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A dusk gradient", aspect: "16:9" },
  });
  const result = outcome!.result as Record<string, unknown>;
  assert.equal(result.aspect, "16:9");
  assert.equal(result.drawnAt, undefined);
});

/// Nothing agent 8 makes is ever shown to anyone (requirement 7), and the
/// picture budget is not spent on the one picture whose subject it wrote itself.
test("the answer carries no tile, no picture and no bucket path", async () => {
  const { execute } = images();
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A paper texture" },
  });
  assert.equal(outcome!.pictures, undefined);
  assert.equal("attachments" in outcome!, false);
  assert.doesNotMatch(JSON.stringify(outcome!.result), /gs:\/\//);
});

/// The ledger's only account of which agent asked: two doors file
/// `IMAGE_GENERATOR` runs against one project.
test("the run row is filed under the designer rather than the orchestrator", async () => {
  const { execute, runs } = images();
  await execute({ name: "generate_image", args: { description: "A wash", aspect: "16:9" } });
  /// Two rows land in one call — the drawing's and the analyzer job the row is
  /// filed with — and only the first is what this is about.
  const drawing = runs.filter((row) => row.agent === "IMAGE_GENERATOR");
  assert.equal(drawing.length, 1);
  const input = drawing[0]!.input as Record<string, unknown>;
  assert.equal(input.via, "designer");
  assert.equal(input.prompt, "A wash");
  assert.equal(input.aspect, "16:9");
});

test("a picture that could not be stored is a failure with no row behind it", async () => {
  const { execute, filed } = images([], {
    storeImage: async () => {
      throw new Error("bucket down");
    },
  });
  const outcome = await execute({ name: "generate_image", args: { description: "A wash" } });
  assert.match((outcome!.result as { error: string }).error, /could not be stored/);
  assert.equal(filed.length, 0);
});

test("the new picture is named clear of the ones the project already has", async () => {
  const { execute, filed } = images([photo("a", { title: "A dusk gradient" })]);
  await execute({ name: "generate_image", args: { description: "A dusk gradient in warm grey" } });
  assert.equal(filed.length, 1);
  assert.notEqual(filed[0]!.title, "A dusk gradient");
});

/// `crop_image` (§IV.4). The sequence between the ask and the row is agent 6's,
/// shared through `@/server/references/tool-crop` and covered by agent 6's own
/// tests. What is agent 8's, and what these assert, is the shape the cut is held
/// to — read off a box the model drew rather than off a template slot — and an
/// answer that files rather than offers and changes no board.

/// 480×360 inside a 1920×1080 page is a quarter of its width and a third of its
/// height, so the thousandths box reads back out as the pixels it went in as —
/// a size that does not round is what makes the assertion below about the shape
/// rather than about the rounding.
const SCENE = [pageFrame("pg1"), imageOn("el1", "a", { width: 480, height: 360 })];

test("a cut is stored and filed before the answer names an id, and the analyzer is kicked", async () => {
  const { execute, stored, filed, kicked } = images([photo("a")]);
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the bride at the arch" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(stored.length, 1);
  assert.equal(filed.length, 1);
  assert.equal(result.imageId, filed[0]!.id);
  assert.equal(result.cutOf, "a");
  assert.equal(kicked.length, 1);
});

test("the cut resolves in the same design on the round after it was made", async () => {
  const { execute, db, references } = images([photo("a")]);
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch" },
  });
  const madeId = (outcome!.result as { imageId: string }).imageId;

  const gallery = galleryToolset({ db, projectId: "p1", references });
  const listed = await gallery.execute({ name: "list_gallery", args: {} });
  const ids = (listed!.result.images as { id: string }[]).map((one) => one.id);
  assert.ok(ids.includes(madeId));

  const read = await gallery.execute({ name: "get_modification", args: { modificationId: madeId } });
  assert.equal((read!.result as { error?: string }).error, undefined);
});

test("toObjectId holds the cut to that object's own box and says which box", async () => {
  const { execute, calls } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  const result = outcome!.result as Record<string, string>;
  /// 400×300 inside a 1920×1080 page, read back out of thousandths.
  assert.equal(result.aspect, "4:3");
  assert.match(result.heldTo!, /el1/);
  assert.match(result.heldTo!, /480×360/);
  assert.match(result.heldTo!, /put_on_canvas/);
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 1);
});

test("a shape said in the call wins over the box it is for", async () => {
  const { execute } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1", aspect: "1:1" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "1:1");
  assert.equal(result.heldTo, undefined);
});

test("a nudge that names a box is held to the box rather than to the shape it was cut at", async () => {
  const cut = photo("a-cut", {
    source: { id: "a", title: "a.jpg" },
    cropBox: [100, 100, 900, 900],
    editIntent: "the arch",
    editAspect: "1:1",
  });
  const { execute } = images([photo("a"), cut], { elements: SCENE });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a-cut", intention: "a little wider", toObjectId: "el1" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "4:3");
  assert.equal(result.cutOf, "a");
  assert.match(result.nudgeOf!, /a-cut is untouched/);
  assert.match(result.nudgeOf!, /discard_image/);
});

/// Refused before the photograph is read: a cut made to the subject under an
/// answer naming the box it was for is the one wrong ending here.
test("a handle the board does not carry is refused without a vision call", async () => {
  const cropper = cropping();
  const { execute, stored } = images([photo("a")], { elements: SCENE, crop: cropper.crop });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el9" },
  });
  assert.match((outcome!.result as { error: string }).error, /no object called el9/);
  assert.match((outcome!.result as { error: string }).error, /read_canvas/);
  assert.equal(cropper.asked.length, 0);
  assert.equal(stored.length, 0);
});

test("an object with no shape a cut can be held to is refused, naming the way round it", async () => {
  const cropper = cropping();
  const { execute } = images([photo("a")], {
    /// Forty to one, which is past `cropShapeAt`'s limit — a shape a cut cannot
    /// be held to is not a shape.
    elements: [pageFrame("pg1"), imageOn("el1", "a", { width: 1600, height: 40 })],
    crop: cropper.crop,
  });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  assert.match((outcome!.result as { error: string }).error, /no shape a cut can be held to/);
  assert.match((outcome!.result as { error: string }).error, /transform_on_canvas/);
  assert.equal(cropper.asked.length, 0);
});

test("a board that is not this project's is a sentence rather than a shapeless cut", async () => {
  const { execute } = images([photo("a")], { elements: null });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  assert.match((outcome!.result as { error: string }).error, /no board called b1/);
});

/// §IV.1: the five canvas tools are the only writers agent 8 has on a board, and
/// none of them exchanges the picture an object points at.
test("the answer says the board is unchanged and names the two calls that place the cut", async () => {
  const { execute, calls } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  assert.equal((outcome!.result as { status: string }).status, CUT_STATUS);
  assert.match(CUT_STATUS, /Nothing on any board changed/);
  assert.match(CUT_STATUS, /put_on_canvas/);
  assert.match(CUT_STATUS, /remove_from_canvas/);
  /// The board was read and never written.
  assert.equal(calls.filter((call) => call.op === "update" && call.table === "moodboard").length, 0);
});

test("a cut is words only — no picture, no tile and no bucket path", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch" },
  });
  assert.equal(outcome!.pictures, undefined);
  assert.equal("attachments" in outcome!, false);
  assert.doesNotMatch(JSON.stringify(outcome!.result), /gs:\/\//);
});

test("a cut is answered in agent 8's verbs and never in agent 6's", async () => {
  const { execute } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  const said = JSON.stringify(outcome!.result);
  for (const verb of ["crop_reference", "discard_reference", "swap_on_board", "inspect_board"]) {
    assert.doesNotMatch(said, new RegExp(verb), verb);
  }
});

test("a loose shape says both what it was framed for and what it came out", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", aspect: "square" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, undefined);
  assert.match(result.framedAs!, /framed/);
});

test("a shape that cannot be read is refused without spending one of the turn's cuts", async () => {
  const cropper = cropping();
  const { execute } = images([photo("a")], { crop: cropper.crop });
  const bad = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", aspect: "wideish" },
  });
  assert.match((bad!.result as { error: string }).error, /not a shape a cut can be held to/);
  assert.equal(cropper.asked.length, 0);

  const good = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch" },
  });
  assert.equal((good!.result as { error?: string }).error, undefined);
});

test("a picture the gallery does not hold is named in agent 8's noun", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "zz", intention: "the arch" },
  });
  assert.equal((outcome!.result as { error: string }).error, "no picture called zz in this project");
});

test("an ask with nothing said about what to keep is refused in agent 8's noun", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({ name: "crop_image", args: { imageId: "a", intention: "  " } });
  assert.equal(
    (outcome!.result as { error: string }).error,
    "say what to crop out of this picture",
  );
});

/// §VII: every ceiling is enforced *and reported*.
test("the design's cuts run out and the refusal says how many were filed", async () => {
  const { execute, stored } = images([photo("a")]);
  for (let n = 0; n < CROP_CALL_LIMIT; n += 1) {
    await execute({ name: "crop_image", args: { imageId: "a", intention: `pass ${n}` } });
  }
  assert.equal(stored.length, CROP_CALL_LIMIT);
  const over = await execute({ name: "crop_image", args: { imageId: "a", intention: "once more" } });
  assert.match((over!.result as { error: string }).error, /this turn may cut/);
  assert.equal(stored.length, CROP_CALL_LIMIT);
});

test("the cropper run row is filed under the designer rather than the orchestrator", async () => {
  const { execute, runs } = images([photo("a")], { elements: SCENE });
  await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  const cut = runs.filter((row) => row.agent === "CROPPER");
  assert.equal(cut.length, 1);
  const input = cut[0]!.input as Record<string, unknown>;
  assert.equal(input.via, "designer");
  assert.equal(input.referenceId, "a");
  assert.equal(input.aspect, "4:3");
});

test("the box is read fresh on each cut, since the model has been moving things all call", async () => {
  const { execute, calls } = images([photo("a")], { elements: SCENE });
  await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "one", toObjectId: "el1" },
  });
  await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "two", toObjectId: "el1" },
  });
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 2);
  /// And the pictures are still read once for the whole design.
  assert.equal(calls.filter((call) => call.op === "findMany" && call.table === "reference").length, 1);
});

test("a page object is measured off its own recorded size", async () => {
  const { execute } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "crop_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "pg1" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "16:9");
  assert.match(result.heldTo!, /Welcome sign/);
});

/// §VII: `GENERATE_CALL_LIMIT` and `CROP_CALL_LIMIT` are inherited *and shared
/// with agent 6's* — one budget, whoever spends it. A design is not a turn of
/// its own, so the two tallies are the calling turn's and this toolset only
/// spends them.
test("a design spends the turn's budget rather than one it opened", async () => {
  const budget = ownPictureBudget();
  const { execute, stored } = images([photo("a")], { budget });

  await execute({ name: "generate_image", args: { description: "A dusk gradient" } });
  await execute({ name: "crop_image", args: { imageId: "a", intention: "the hands" } });

  assert.deepEqual(budget, {
    generations: { asked: 1, filed: 1 },
    crops: { asked: 1, filed: 1 },
  });
  assert.equal(stored.length, 2);
});

test("what the turn spent before the design is what the design has left", async () => {
  const budget = ownPictureBudget();
  budget.generations = { asked: GENERATE_CALL_LIMIT, filed: GENERATE_CALL_LIMIT };
  budget.crops = { asked: CROP_CALL_LIMIT, filed: CROP_CALL_LIMIT };
  const { execute, stored, runs } = images([photo("a")], { budget });

  const drawn = await execute({ name: "generate_image", args: { description: "A dusk gradient" } });
  assert.match(
    (drawn!.result as { error: string }).error,
    new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`),
  );

  const cut = await execute({ name: "crop_image", args: { imageId: "a", intention: "the hands" } });
  assert.match(
    (cut!.result as { error: string }).error,
    new RegExp(`already filed ${CROP_CALL_LIMIT} cuts`),
  );

  /// Refused above the run row, like every other ceiling in either agent: a
  /// design that cannot draw should not put a RUNNING row on the ledger.
  assert.equal(stored.length, 0);
  assert.equal(runs.length, 0);
});
