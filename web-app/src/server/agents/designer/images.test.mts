import { test } from "node:test";
import assert from "node:assert/strict";

import { GENERATED_STATUS, GENERATED_UNSIZED_STATUS, imageToolset } from "./images";
import { galleryToolset } from "./gallery";
import { designerReferences } from "./references";
import { GENERATE_CALL_LIMIT } from "@/lib/agent/agent-tools";
import { DESIGNER_GENERATE_IMAGE } from "@/lib/agent/designer-tools";
import type { PrismaClient } from "@/generated/prisma/client";

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

type Call = { table: string; op: string; args: Record<string, unknown> };

function fakeDb(rows: readonly Row[]) {
  const calls: Call[] = [];
  const filed: Row[] = [];
  const runs: Record<string, unknown>[] = [];
  let next = 0;

  const create = async (args: Record<string, unknown>) => {
    calls.push({ table: "reference", op: "create", args });
    next += 1;
    const data = args.data as Record<string, unknown>;
    const row = photo(`made-${next}`, {
      title: data.title as string,
      origin: "GENERATED",
      generationPrompt: data.generationPrompt as string,
      gcsUri: data.gcsUri as string,
      width: (data.width as number) ?? null,
      height: (data.height as number) ?? null,
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
    $transaction: async (body: (tx: unknown) => Promise<unknown>) => body(db),
  } as unknown as PrismaClient;

  return { db, calls, filed, runs };
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
  } = {},
) {
  const { db, calls, filed, runs } = fakeDb(rows);
  const stored: { contentType: string; bytes: Uint8Array }[] = [];
  const kicked: true[] = [];
  const references = designerReferences({ db, projectId: "p1" });
  const toolset = imageToolset({
    db,
    projectId: "p1",
    references,
    generate: (over.generate ?? drew(png(1024, 1024))) as never,
    storeImage: async (contentType, bytes) => {
      stored.push({ contentType, bytes });
      return over.storeImage
        ? await over.storeImage(contentType, bytes)
        : `gs://director-bucket/uploads/made-${stored.length}.png`;
    },
    kickAnalyzer: () => void kicked.push(true),
  });
  return { ...toolset, db, calls, filed, runs, stored, kicked, references };
}

test("the toolset offers generate_image and answers null for a name it does not own", async () => {
  const { declarations, execute } = images();
  assert.deepEqual(
    declarations.map(({ name }) => name),
    [DESIGNER_GENERATE_IMAGE.name],
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
test("the turn's ceiling is the toolset's own and the refusal says what is in the project", async () => {
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
