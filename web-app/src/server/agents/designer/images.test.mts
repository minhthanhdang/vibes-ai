import { test } from "node:test";
import assert from "node:assert/strict";
import { cropEdit } from "@/lib/references/reference-edit";

import {
  CUT_STATUS,
  GENERATED_STATUS,
  GENERATED_UNSIZED_STATUS,
  imageToolset,
  ownPictureBudget,
} from "./images";
import { galleryToolset } from "./gallery";
import { designerReferences } from "./references";
import { EDIT_CALL_LIMIT, GENERATE_CALL_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { EDIT_IMAGE, DESIGNER_GENERATE_IMAGE } from "@/lib/agent/designer/image-tools";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Cut } from "@/server/references/cut";

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
  editRationale: string;
  edit: unknown[];
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
    editRationale: "",
    edit: [],
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

function fakeDb(
  rows: readonly Row[],
  elements: unknown[] | null = null,
  tier: string = "TIER_1",
) {
  const calls: Call[] = [];
  const filed: Row[] = [];
  const runs: Record<string, unknown>[] = [];
  let next = 0;

  const create = async (args: Record<string, unknown>) => {
    calls.push({ table: "reference", op: "create", args });
    next += 1;
    const data = args.data as Record<string, unknown>;
    const cutOf = data.sourceReferenceId as string | undefined;
    const row = photo(`made-${next}`, {
      title: data.title as string,
      origin: cutOf ? "UPLOADED" : "GENERATED",
      generationPrompt: (data.generationPrompt as string) ?? null,
      gcsUri: data.gcsUri as string,
      width: (data.width as number) ?? null,
      height: (data.height as number) ?? null,
      editIntent: (data.editIntent as string) ?? "",
      editRationale: (data.editRationale as string) ?? "",
      edit: (data.edit as unknown[]) ?? [],
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
      count: async (args: Record<string, unknown>) => {
        calls.push({ table: "reference", op: "count", args });
        return [...rows, ...filed].filter((row) => !row.source).length;
      },
      create,
    },
    project: {
      findUnique: async (args: Record<string, unknown>) => {
        calls.push({ table: "project", op: "findUnique", args });
        return { user: { id: "u1", tier } };
      },
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
        return elements && where.id === "b1" && where.projectId === "p1" ? { elements } : null;
      },
    },
    $transaction: async (body: (tx: unknown) => Promise<unknown>) => body(db),
  } as unknown as PrismaClient;

  return { db, calls, filed, runs };
}

const BOX = { ymin: 200, xmin: 200, ymax: 800, xmax: 800 };

function cropping(over: Record<string, unknown> = {}) {
  const asked: Record<string, unknown>[] = [];
  const crop = async (input: unknown) => {
    asked.push(input as Record<string, unknown>);
    return {
      model: "gemini-flash",
      box: BOX,
      ops: cropEdit(BOX),
      looks: 0,
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
  const thumbKicks: { referenceId: string; bytes: Uint8Array }[] = [];
  const references = designerReferences({ db, projectId: "p1" });
  const budget = over.budget ?? ownPictureBudget();
  const toolset = imageToolset({
    db,
    projectId: "p1",
    boardId: "b1",
    references,
    budget,
    generate: (over.generate ?? drew(png(1024, 1024))) as never,
    edit: (over.crop ?? cropping().crop) as never,
    cutRegion: (over.cutRegion ?? cutting().cutRegion) as never,
    storeImage: async (contentType, bytes) => {
      stored.push({ contentType, bytes });
      return over.storeImage
        ? await over.storeImage(contentType, bytes)
        : `gs://director-bucket/uploads/made-${stored.length}.png`;
    },
    kickAnalyzer: () => void kicked.push(true),
    kickThumbnail: (referenceId, bytes) => void thumbKicks.push({ referenceId, bytes }),
  });
  return { ...toolset, db, calls, filed, runs, stored, kicked, thumbKicks, references, budget };
}

test("the toolset offers both image tools and answers null for a name it does not own", async () => {
  const { declarations, execute } = images();
  assert.deepEqual(
    declarations.map(({ name }) => name),
    [DESIGNER_GENERATE_IMAGE.name, EDIT_IMAGE.name],
  );
  assert.equal(await execute({ name: "put_on_canvas", args: {} }), null);
});

test("the bytes are stored and the row is filed before the answer names an id", async () => {
  const { execute, stored, filed, kicked, thumbKicks } = images();
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
  assert.deepEqual(kicked, [true]);
  assert.equal(thumbKicks.length, 1);
  assert.equal(thumbKicks[0]!.referenceId, filed[0]!.id);
  assert.equal(thumbKicks[0]!.bytes, stored[0]!.bytes);
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

test("a drawing that came back off the asked shape says so and names agent 8's crop", async () => {
  const { execute } = images([], { generate: drew(png(1024, 1024)) });
  const outcome = await execute({
    name: "generate_image",
    args: { description: "A dusk gradient", aspect: "16:9" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "16:9");
  assert.match(result.drawnAt, /1024×1024/);
  assert.match(result.drawnAt, /edit_image/);
  assert.doesNotMatch(result.drawnAt, /edit_reference/);
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

test("the run row is filed under the designer rather than the orchestrator", async () => {
  const { execute, runs } = images();
  await execute({ name: "generate_image", args: { description: "A wash", aspect: "16:9" } });
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

const SCENE = [pageFrame("pg1"), imageOn("el1", "a", { width: 480, height: 360 })];

test("a cut is stored and filed before the answer names an id, and the analyzer is kicked", async () => {
  const { execute, stored, filed, kicked } = images([photo("a")]);
  const outcome = await execute({
    name: "edit_image",
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
    name: "edit_image",
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
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "4:3");
  assert.match(result.heldTo!, /el1/);
  assert.match(result.heldTo!, /480×360/);
  assert.match(result.heldTo!, /put_on_canvas/);
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 1);
});

test("a shape said in the call wins over the box it is for", async () => {
  const { execute } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1", aspect: "1:1" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "1:1");
  assert.equal(result.heldTo, undefined);
});

test("a nudge that names a box is held to the box rather than to the shape it was cut at", async () => {
  const cut = photo("a-cut", {
    source: { id: "a", title: "a.jpg" },
    edit: [{ op: "crop", box: [100, 100, 900, 900], shape: "1:1" }],
    editIntent: "the arch",
  });
  const { execute } = images([photo("a"), cut], { elements: SCENE });
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a-cut", intention: "a little wider", toObjectId: "el1" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "4:3");
  assert.equal(result.cutOf, "a");
  assert.match(result.nudgeOf!, /a-cut is untouched/);
  assert.match(result.nudgeOf!, /discard_image/);
});

test("a handle the board does not carry is refused without a vision call", async () => {
  const cropper = cropping();
  const { execute, stored } = images([photo("a")], { elements: SCENE, crop: cropper.crop });
  const outcome = await execute({
    name: "edit_image",
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
    elements: [pageFrame("pg1"), imageOn("el1", "a", { width: 1600, height: 40 })],
    crop: cropper.crop,
  });
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  assert.match((outcome!.result as { error: string }).error, /no shape a cut can be held to/);
  assert.match((outcome!.result as { error: string }).error, /transform_on_canvas/);
  assert.equal(cropper.asked.length, 0);
});

test("a board that is not this project's is a sentence rather than a shapeless cut", async () => {
  const { execute } = images([photo("a")], { elements: null });
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  assert.match((outcome!.result as { error: string }).error, /no board called b1/);
});

test("the answer says the board is unchanged and names the two calls that place the cut", async () => {
  const { execute, calls } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  assert.equal((outcome!.result as { status: string }).status, CUT_STATUS);
  assert.match(CUT_STATUS, /Nothing on any board changed/);
  assert.match(CUT_STATUS, /put_on_canvas/);
  assert.match(CUT_STATUS, /remove_from_canvas/);
  assert.equal(calls.filter((call) => call.op === "update" && call.table === "moodboard").length, 0);
});

test("a cut is words only — no picture, no tile and no bucket path", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch" },
  });
  assert.equal(outcome!.pictures, undefined);
  assert.equal("attachments" in outcome!, false);
  assert.doesNotMatch(JSON.stringify(outcome!.result), /gs:\/\//);
});

test("a cut is answered in agent 8's verbs and never in agent 6's", async () => {
  const { execute } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "el1" },
  });
  const said = JSON.stringify(outcome!.result);
  for (const verb of ["edit_reference", "discard_reference", "swap_on_board", "inspect_board"]) {
    assert.doesNotMatch(said, new RegExp(verb), verb);
  }
});

test("a loose shape says both what it was framed for and what it came out", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({
    name: "edit_image",
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
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", aspect: "wideish" },
  });
  assert.match((bad!.result as { error: string }).error, /not a shape a cut can be held to/);
  assert.equal(cropper.asked.length, 0);

  const good = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch" },
  });
  assert.equal((good!.result as { error?: string }).error, undefined);
});

test("a picture the gallery does not hold is named in agent 8's noun", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "zz", intention: "the arch" },
  });
  assert.equal((outcome!.result as { error: string }).error, "no picture called zz in this project");
});

test("an ask with nothing said about what to keep is refused in agent 8's noun", async () => {
  const { execute } = images([photo("a")]);
  const outcome = await execute({ name: "edit_image", args: { imageId: "a", intention: "  " } });
  assert.equal(
    (outcome!.result as { error: string }).error,
    "say what to crop out of this picture",
  );
});

test("the design's cuts run out and the refusal says how many were filed", async () => {
  const { execute, stored } = images([photo("a")]);
  for (let n = 0; n < EDIT_CALL_LIMIT; n += 1) {
    await execute({ name: "edit_image", args: { imageId: "a", intention: `pass ${n}` } });
  }
  assert.equal(stored.length, EDIT_CALL_LIMIT);
  const over = await execute({ name: "edit_image", args: { imageId: "a", intention: "once more" } });
  assert.match((over!.result as { error: string }).error, /this turn may edit/);
  assert.equal(stored.length, EDIT_CALL_LIMIT);
});

test("the cropper run row is filed under the designer rather than the orchestrator", async () => {
  const { execute, runs } = images([photo("a")], { elements: SCENE });
  await execute({
    name: "edit_image",
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
    name: "edit_image",
    args: { imageId: "a", intention: "one", toObjectId: "el1" },
  });
  await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "two", toObjectId: "el1" },
  });
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 2);
  assert.equal(calls.filter((call) => call.op === "findMany" && call.table === "reference").length, 1);
});

test("a page object is measured off its own recorded size", async () => {
  const { execute } = images([photo("a")], { elements: SCENE });
  const outcome = await execute({
    name: "edit_image",
    args: { imageId: "a", intention: "the arch", toObjectId: "pg1" },
  });
  const result = outcome!.result as Record<string, string>;
  assert.equal(result.aspect, "16:9");
  assert.match(result.heldTo!, /Welcome sign/);
});

test("a design spends the turn's budget rather than one it opened", async () => {
  const budget = ownPictureBudget();
  const { execute, stored } = images([photo("a")], { budget });

  await execute({ name: "generate_image", args: { description: "A dusk gradient" } });
  await execute({ name: "edit_image", args: { imageId: "a", intention: "the hands" } });

  assert.deepEqual(budget, {
    generations: { asked: 1, filed: 1 },
    crops: { asked: 1, filed: 1 },
  });
  assert.equal(stored.length, 2);
});

test("what the turn spent before the design is what the design has left", async () => {
  const budget = ownPictureBudget();
  budget.generations = { asked: GENERATE_CALL_LIMIT, filed: GENERATE_CALL_LIMIT };
  budget.crops = { asked: EDIT_CALL_LIMIT, filed: EDIT_CALL_LIMIT };
  const { execute, stored, runs } = images([photo("a")], { budget });

  const drawn = await execute({ name: "generate_image", args: { description: "A dusk gradient" } });
  assert.match(
    (drawn!.result as { error: string }).error,
    new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`),
  );

  const cut = await execute({ name: "edit_image", args: { imageId: "a", intention: "the hands" } });
  assert.match(
    (cut!.result as { error: string }).error,
    new RegExp(`already filed ${EDIT_CALL_LIMIT} edits`),
  );

  assert.equal(stored.length, 0);
  assert.equal(runs.length, 0);
});

test("made() is empty until something is made", () => {
  assert.deepEqual(images().made(), { generated: [], cropped: [] });
});

test("made() names the pictures the design drew and cut, by the ids it filed", async () => {
  const { execute, made, filed } = images([photo("a")], { elements: SCENE });

  await execute({ name: "generate_image", args: { description: "A dusk gradient" } });
  await execute({ name: "edit_image", args: { imageId: "a", intention: "the hands" } });

  const ledger = made();
  assert.equal(ledger.generated.length, 1);
  assert.equal(ledger.cropped.length, 1);
  assert.deepEqual([...ledger.generated, ...ledger.cropped], filed.map(({ id }) => id));
});

test("made() counts what landed, never what was refused", async () => {
  const { execute, made } = images();

  await execute({ name: "generate_image", args: { description: "A wash", aspect: "portraity" } });
  await execute({ name: "generate_image", args: { description: "   " } });
  assert.deepEqual(made(), { generated: [], cropped: [] });

  for (let asked = 0; asked < GENERATE_CALL_LIMIT; asked += 1) {
    await execute({ name: "generate_image", args: { description: `Backdrop ${asked}` } });
  }
  await execute({ name: "generate_image", args: { description: "One more" } });

  assert.equal(made().generated.length, GENERATE_CALL_LIMIT);
});

test("made() counts no cut for a picture the project has not got", async () => {
  const { execute, made } = images([photo("a")], { elements: SCENE });

  const refused = await execute({
    name: "edit_image",
    args: { imageId: "gone", intention: "the hands" },
  });
  assert.ok((refused!.result as { error?: string }).error);
  assert.deepEqual(made().cropped, []);
});

test("made() hands back a copy rather than the ledger itself", async () => {
  const { execute, made } = images();
  await execute({ name: "generate_image", args: { description: "A dusk gradient" } });

  const first = made();
  first.generated.push("not-a-picture");
  assert.equal(made().generated.length, 1);
});
