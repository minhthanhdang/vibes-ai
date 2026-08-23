import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DISCARD_GAP_NOTE,
  DISCARD_PAGES_NOTE,
  DISCARD_STATUS,
  NOT_SHOWN_NOTE,
  galleryToolset,
} from "./gallery";
import { CATALOG_LIMIT, UNREAD_CATALOG_NOTE, UNREAD_MARK } from "@/lib/agent/shared/reference";
import { GALLERY_TOOLS, IMAGE_UNREAD_NOTE, REGION_NOTE } from "@/lib/agent/designer-tools";
import type { PrismaClient } from "@/generated/prisma/client";

/// The executor half of agent 8's gallery (compositor-v2.md §IV.3). Every answer
/// shape under it is pure and tested next door, so what this file asserts is the
/// three things only the executor knows: what a call costs the database, what of
/// the rows it lets out to the model, and which calls buy a picture.

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
  analysis: {
    title?: string;
    colorPalette?: string[];
    lighting?: string[];
    texture?: string[];
    composition?: string[];
    subject?: string[];
    contrastDepth?: string[];
    rationale?: string;
  } | null;
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
    thumbGcsUri: `gs://director-bucket/thumbs/${id}.jpg`,
    origin: "UPLOADED",
    generationPrompt: null,
    source: null,
    analysis: { lighting: ["golden-hour"], subject: ["landscape"], colorPalette: ["#c8b7a6"] },
    ...over,
  };
}

/// A modification: a picture in every respect, plus the frame it came out of,
/// the box it was taken at and agent 3's two sentences about it.
function cut(id: string, frameId: string, over: Partial<Row> = {}): Row {
  return photo(id, {
    source: { id: frameId, title: `${frameId}.jpg` },
    editIntent: "the doorway",
    editRationale: "the doorway is the only vertical in the frame",
    editAspect: "4:5",
    cropBox: [100, 200, 700, 800],
    width: 1200,
    height: 1500,
    ...over,
  });
}

type Board = { id: string; title: string; elements: unknown };

function board(id: string, referenceIds: readonly string[], over: Partial<Board> = {}): Board {
  return {
    id,
    title: `Board ${id}`,
    elements: referenceIds.map((referenceId, index) => ({
      id: `el-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })),
    ...over,
  };
}

type Call = { table: string; op: string; args: Record<string, unknown> };

function fakeDb(
  rows: readonly Row[],
  boards: readonly Board[] = [],
  /// The analyzer's own rows, newest first, read only when a picture has no
  /// analysis to show for itself.
  analyzerRuns: readonly { input: unknown; status: string }[] = [],
) {
  const calls: Call[] = [];
  const record =
    <T,>(table: string, op: string, answer: () => T) =>
    async (args: Record<string, unknown>) => {
      calls.push({ table, op, args });
      return answer();
    };

  const db = {
    reference: { findMany: record("reference", "findMany", () => rows) },
    agentRun: { findMany: record("agentRun", "findMany", () => analyzerRuns) },
    moodboard: { findMany: record("moodboard", "findMany", () => boards) },
  } as unknown as PrismaClient;

  return { db, calls };
}

const gallery = (
  rows: readonly Row[],
  boards: readonly Board[] = [],
  runs: readonly { input: unknown; status: string }[] = [],
) => {
  const { db, calls } = fakeDb(rows, boards, runs);
  return { ...galleryToolset({ db, projectId: "p1" }), calls };
};

const json = (result: unknown) => JSON.stringify(result);

test("the four gallery declarations are what the toolset offers", () => {
  const { declarations } = gallery([]);
  assert.deepEqual(
    declarations.map(({ name }) => name),
    GALLERY_TOOLS.map(({ name }) => name),
  );
});

test("a name this toolset does not own is answered null rather than errored", async () => {
  const { execute } = gallery([photo("a")]);
  assert.equal(await execute({ name: "put_on_canvas", args: {} }), null);
});

test("list_gallery answers in agent 8's vocabulary and carries no pictures", async () => {
  const { execute } = gallery([photo("a", { isFavorite: true }), cut("a-cut", "a")]);
  const outcome = await execute({ name: "list_gallery", args: {} });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  const result = outcome.result as { total: number; shown: number; images: Record<string, unknown>[] };
  assert.equal(result.total, 2);
  assert.equal(result.shown, 2);
  assert.equal(result.images[0]!.starred, true);
  assert.equal(result.images[0]!.favorite, undefined);
  assert.equal(result.images[1]!.modificationOf, "a");
  assert.equal(result.images[1]!.croppedFrom, undefined);
});

test("no bucket path reaches the model through any of the four answers", async () => {
  const { execute } = gallery([photo("a"), cut("a-cut", "a")], [board("b1", ["a"])]);
  for (const call of [
    { name: "list_gallery", args: {} },
    { name: "get_image", args: { imageId: "a" } },
    { name: "get_modification", args: { modificationId: "a-cut" } },
    { name: "discard_image", args: { imageId: "a" } },
  ]) {
    const outcome = await execute(call);
    assert.ok(outcome, call.name);
    assert.ok(!json(outcome.result).includes("gs://"), `${call.name} let a uri out`);
  }
});

test("includeModifications false drops the versions from the count as well as the lines", async () => {
  const { execute } = gallery([photo("a"), cut("a-cut", "a")]);
  const outcome = await execute({
    name: "list_gallery",
    args: { includeModifications: false },
  });
  const result = outcome!.result as { total: number; images: { id: string }[] };
  assert.equal(result.total, 1);
  assert.deepEqual(
    result.images.map(({ id }) => id),
    ["a"],
  );
});

test("the over-cap note rides on a gallery bigger than one answer", async () => {
  const rows = Array.from({ length: CATALOG_LIMIT + 3 }, (_, index) => photo(`r${index}`));
  const { execute } = gallery(rows);
  const result = (await execute({ name: "list_gallery", args: {} }))!.result as {
    total: number;
    shown: number;
    notAllShown?: string;
  };
  assert.equal(result.total, CATALOG_LIMIT + 3);
  assert.equal(result.shown, CATALOG_LIMIT);
  assert.match(result.notAllShown ?? "", /do not describe this list as all of them/);
});

test("the unread legend is attached only when a line is marked", async () => {
  const read = gallery([photo("a")]);
  const listed = (await read.execute({ name: "list_gallery", args: {} }))!.result as {
    unreadNote?: string;
  };
  assert.equal(listed.unreadNote, undefined);

  const blank = gallery(
    [photo("a", { analysis: null })],
    [],
    [{ input: { referenceId: "a" }, status: "FAILED" }],
  );
  const marked = (await blank.execute({ name: "list_gallery", args: {} }))!.result as {
    unreadNote?: string;
    images: { unread?: string }[];
  };
  assert.equal(marked.images[0]!.unread, UNREAD_MARK.failed);
  assert.equal(marked.unreadNote, UNREAD_CATALOG_NOTE);
});

test("the analyzer's runs are read only when a picture has no analysis to show", async () => {
  const read = gallery([photo("a")]);
  await read.execute({ name: "list_gallery", args: {} });
  assert.equal(
    read.calls.filter((call) => call.table === "agentRun").length,
    0,
    "a project agent 2 has finished with pays for the second query",
  );

  const blank = gallery([photo("a", { analysis: null })]);
  await blank.execute({ name: "list_gallery", args: {} });
  assert.equal(blank.calls.filter((call) => call.table === "agentRun").length, 1);
});

test("get_image buys exactly one picture, the original bytes", async () => {
  const { execute } = gallery([photo("a")]);
  const outcome = await execute({ name: "get_image", args: { imageId: "a" } });

  assert.deepEqual(outcome!.pictures, [
    { fileData: { fileUri: "gs://director-bucket/uploads/a.jpg", mimeType: "image/jpeg" } },
  ]);
  const result = outcome!.result as { palette?: string[]; rationale?: string; lighting?: string[] };
  assert.deepEqual(result.palette, ["#c8b7a6"]);
  assert.deepEqual(result.lighting, ["Golden hour"]);
});

test("get_image lists the versions cut from that picture and no others", async () => {
  const { execute } = gallery([
    photo("a"),
    cut("a-cut", "a"),
    cut("a-cut-cut", "a-cut"),
    photo("b"),
    cut("b-cut", "b"),
  ]);
  const result = (await execute({ name: "get_image", args: { imageId: "a" } }))!.result as {
    modifications?: { id: string }[];
  };
  assert.deepEqual(
    (result.modifications ?? []).map(({ id }) => id),
    ["a-cut"],
  );
});

test("an unread picture is still looked at, and marked rather than described", async () => {
  const { execute } = gallery(
    [photo("a", { analysis: null })],
    [],
    [{ input: { referenceId: "a" }, status: "QUEUED" }],
  );
  const outcome = await execute({ name: "get_image", args: { imageId: "a" } });

  assert.equal(outcome!.pictures?.length, 1);
  const result = outcome!.result as { unreadNote?: string; unread?: string; palette?: string[] };
  assert.equal(result.unread, UNREAD_MARK.pending);
  assert.equal(result.unreadNote, IMAGE_UNREAD_NOTE);
  assert.equal(result.palette, undefined);
});

test("a picture whose bytes cannot be shown says so instead of going quiet", async () => {
  const { execute } = gallery([photo("a", { gcsUri: "gs://director-bucket/uploads/a.heic" })]);
  const outcome = await execute({ name: "get_image", args: { imageId: "a" } });

  assert.equal(outcome!.pictures, undefined);
  assert.equal((outcome!.result as { pictureNote?: string }).pictureNote, NOT_SHOWN_NOTE);
});

test("an id that names nothing costs no picture", async () => {
  const { execute } = gallery([photo("a")]);
  const outcome = await execute({ name: "get_image", args: { imageId: "nope" } });
  assert.equal(outcome!.pictures, undefined);
  assert.match((outcome!.result as { error: string }).error, /no picture called nope/);
});

test("get_modification answers with the region, the reasoning and the shape asked for", async () => {
  const { execute } = gallery([photo("a", { analysis: { title: "Stairwell" } }), cut("a-cut", "a")]);
  const outcome = await execute({ name: "get_modification", args: { modificationId: "a-cut" } });

  assert.equal(outcome!.pictures?.length, 1);
  const result = outcome!.result as Record<string, unknown>;
  assert.deepEqual(result.region, [100, 200, 700, 800]);
  assert.equal(result.regionNote, REGION_NOTE);
  assert.equal(result.why, "the doorway is the only vertical in the frame");
  assert.equal(result.askedAt, "4:5");
  assert.equal(result.pixelSize, "1200×1500");
  assert.equal(result.modificationOf, "a");
  /// Agent 2's name for the frame rather than the filename on the version's own
  /// row: two names for one picture in two answers is a model guessing which
  /// list the id belongs to.
  assert.equal(result.sourceTitle, "Stairwell");
});

test("an original asked for as a modification is named back rather than half-answered", async () => {
  const { execute } = gallery([photo("a")]);
  const outcome = await execute({ name: "get_modification", args: { modificationId: "a" } });

  assert.equal(outcome!.pictures, undefined);
  assert.match((outcome!.result as { error: string }).error, /call get_image for it/);
});

test("discard_image names the cascade, the boards and the gap, and offers nothing else", async () => {
  const { execute } = gallery(
    [photo("a", { analysis: { title: "Stairwell" } }), cut("a-cut", "a"), photo("b")],
    [board("b1", ["a"]), board("b2", ["a-cut"]), board("b3", ["b"])],
  );
  const outcome = await execute({ name: "discard_image", args: { imageId: "a" } });

  assert.equal(outcome!.pictures, undefined);
  const result = outcome!.result as Record<string, unknown>;
  assert.equal(result.imageId, "a");
  assert.equal(result.title, "Stairwell");
  assert.deepEqual(result.modificationsThatWouldGoWithIt, [{ id: "a-cut", title: "a-cut.jpg" }]);
  assert.deepEqual((result.onBoards as { id: string }[]).map(({ id }) => id), ["b1"]);
  assert.deepEqual(
    (result.boardsShowingItsModifications as { id: string }[]).map(({ id }) => id),
    ["b2"],
  );
  assert.equal(result.gap, DISCARD_GAP_NOTE);
  assert.equal(result.status, DISCARD_STATUS);
  /// No board holds it and no page note is owed: b3 shows a different picture.
  assert.equal(result.pages, undefined);
});

test("discarding a modification says the picture it was cut from stays", async () => {
  const { execute } = gallery([photo("a"), cut("a-cut", "a")]);
  const result = (await execute({ name: "discard_image", args: { imageId: "a-cut" } }))!.result as {
    modificationOf?: string;
    modificationsThatWouldGoWithIt?: unknown;
  };
  assert.match(result.modificationOf ?? "", /^a — this is a modification/);
  assert.match(result.modificationOf ?? "", /photograph it was cut from stays in the project/);
  assert.equal(result.modificationsThatWouldGoWithIt, undefined);
});

test("a picture on no board is offered without a gap to warn about", async () => {
  const { execute } = gallery([photo("a")], [board("b1", ["other"])]);
  const result = (await execute({ name: "discard_image", args: { imageId: "a" } }))!.result as {
    gap?: string;
    onBoards?: unknown;
  };
  assert.equal(result.gap, undefined);
  assert.equal(result.onBoards, undefined);
});

test("a spread names the page the picture would go from", async () => {
  const page = {
    id: "page-1",
    type: "frame",
    name: "Page 1",
    x: 0,
    y: 0,
    width: 1000,
    height: 1000,
    customData: { page: true },
  };
  const spread = {
    id: "b1",
    title: "Spread",
    elements: [
      page,
      { ...page, id: "page-2", name: "Page 2", x: 2000 },
      { id: "el-0", type: "image", fileId: "ref:a", x: 10, y: 10, width: 100, height: 100 },
    ],
  };
  const { execute } = gallery([photo("a")], [spread]);
  const result = (await execute({ name: "discard_image", args: { imageId: "a" } }))!.result as {
    pages?: string;
  };
  assert.equal(result.pages, DISCARD_PAGES_NOTE);
});

test("the pictures are read once for a whole design, and the boards only for the discard", async () => {
  const { execute, calls } = gallery([photo("a"), cut("a-cut", "a")], [board("b1", ["a"])]);

  await execute({ name: "list_gallery", args: {} });
  await execute({ name: "get_image", args: { imageId: "a" } });
  await execute({ name: "get_modification", args: { modificationId: "a-cut" } });
  assert.equal(calls.filter((call) => call.table === "reference").length, 1);
  assert.equal(
    calls.filter((call) => call.table === "moodboard").length,
    0,
    "a look at a picture read the boards' elements",
  );

  await execute({ name: "discard_image", args: { imageId: "a" } });
  await execute({ name: "discard_image", args: { imageId: "a-cut" } });
  assert.equal(calls.filter((call) => call.table === "reference").length, 1);
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 1);
});

test("two calls in one round share the read rather than racing it", async () => {
  const { execute, calls } = gallery([photo("a"), photo("b")]);
  await Promise.all([
    execute({ name: "get_image", args: { imageId: "a" } }),
    execute({ name: "get_image", args: { imageId: "b" } }),
  ]);
  assert.equal(calls.filter((call) => call.table === "reference").length, 1);
});
