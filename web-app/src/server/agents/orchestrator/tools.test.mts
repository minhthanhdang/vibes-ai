import { test } from "node:test";
import assert from "node:assert/strict";

import { referenceToolset } from "./tools";
import type { DesignPageAnswer, designPage } from "@/server/agents/designer/design";
import { CROP_CALL_LIMIT, GENERATE_CALL_LIMIT, READ_LIMIT, SHOWN_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { REWORD_LIMIT, SWAP_LIMIT } from "@/lib/agent/orchestrator/board-tools";
import { CropperError } from "@/server/agents/cropper/cropper";
import { LayoutReaderError } from "@/server/agents/deprecated/layout-reader";
import { ImageGeneratorError } from "@/server/agents/image-generator/image-generator";
import { customLayoutColumns, layoutFromBoxes } from "@/lib/layout/custom-layout";
import { MODELS } from "@/server/google/vertex";
import { ObjectTooLargeError } from "@/server/google/storage";
import { PAGE_GAP, fitInSlot, layoutById } from "@/lib/layout/moodboard-layouts";
import { boardPages, pageFrame, pageItems, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { isPageBackground, pageBackgroundColour } from "@/lib/pages/page-background";
import { pageContents } from "@/lib/pages/page-contents";
import { boardItems } from "@/lib/boards/board-contents";
import type { MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { THUMBNAIL_CONTENT_TYPE, thumbnailBox } from "@/lib/intake/thumbnail";
import { referencesOwedCopies } from "@/lib/intake/reference-derived";
import { forDisplay } from "@/server/references/display";
import { hashFileContent } from "@/lib/intake/content-hash";
import type { CropperResult } from "@/server/agents/cropper/cropper";
import type { CompositorResult } from "@/server/agents/deprecated/compositor";
import type { Cut } from "@/server/references/cut";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import type { GeneratedImage } from "@/server/agents/image-generator/image-generator";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type Call = { table: string; op: string; args: Record<string, unknown> };

type Row = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  editAspect: string;
  cropBox: number[];
  isFavorite: boolean;
  gcsUri: string;
  thumbGcsUri: string | null;
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
  origin?: "UPLOADED" | "IMPORTED" | "GENERATED";
  generationPrompt?: string | null;
};

function photo(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    title: id,
    width: 4000,
    height: 3000,
    editIntent: "",
    editAspect: "",
    cropBox: [],
    isFavorite: false,
    gcsUri: `gs://director-bucket/uploads/${id}.jpg`,
    thumbGcsUri: `gs://director-bucket/thumbs/${id}.jpg`,
    source: null,
    analysis: { lighting: ["golden_hour"], subject: ["landscape"] },
    ...over,
  };
}

function cut(id: string, frameId: string, over: Partial<Row> = {}): Row {
  return photo(id, {
    source: { id: frameId, title: frameId },
    editIntent: "the doorway",
    cropBox: [100, 200, 700, 800],
    ...over,
  });
}

type BoardRow = {
  id: string;
  title: string;
  revision: number;
  widthPx: number;
  heightPx: number;
  layout: string | null;
  layoutSlots?: unknown;
  pageCount: number;
  pageNames: string[];
  elements: { id: string; type: string; fileId?: string }[];
  appState?: unknown;
};

function board(id: string, referenceIds: readonly string[], over: Partial<BoardRow> = {}): BoardRow {
  const row: BoardRow = {
    id,
    title: `Board ${id}`,
    revision: 3,
    widthPx: 1920,
    heightPx: 1080,
    layout: null,
    pageCount: 0,
    pageNames: [],
    elements: referenceIds.map((referenceId, index) => ({
      id: `el-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
    })),
    ...over,
  };
  const pages = pagesInReadingOrder(boardPages(row.elements));
  return {
    ...row,
    pageCount: over.pageCount ?? pages.length,
    pageNames: over.pageNames ?? pages.map((page) => page.name),
  };
}

function fakeDb(
  rows: readonly Row[],
  boardRows: readonly BoardRow[] = [],
  analyzerRuns: readonly { input: unknown; status: string }[] = [],
  named: { title: string; brief: string } = { title: "p1", brief: "" },
) {
  const calls: Call[] = [];
  let runs = 0;
  let boards = 0;
  let made = 0;

  const record = <T,>(table: string, op: string, answer: (args: Record<string, unknown>) => T) =>
    async (args: Record<string, unknown>) => {
      calls.push({ table, op, args });
      return answer(args);
    };

  const db = {
    reference: {
      findMany: record("reference", "findMany", () => rows),
      create: record("reference", "create", (args) => {
        const written = args.data as Record<string, unknown>;
        const frameId = written.sourceReferenceId as string | undefined;
        return photo(`made-${++made}`, {
          title: String(written.title ?? ""),
          width: (written.width as number | undefined) ?? null,
          height: (written.height as number | undefined) ?? null,
          gcsUri: String(written.gcsUri ?? ""),
          thumbGcsUri: (written.thumbGcsUri as string | undefined) ?? null,
          analysis: null,
          origin: written.origin as Row["origin"],
          generationPrompt: written.generationPrompt as string | null | undefined,
          ...(frameId && {
            source: {
              id: frameId,
              title: rows.find((row) => row.id === frameId)?.title ?? frameId,
            },
            editIntent: String(written.editIntent ?? ""),
            editAspect: String(written.editAspect ?? ""),
            cropBox: (written.cropBox as number[] | undefined) ?? [],
          }),
        });
      }),
    },
    project: { findUnique: record("project", "findUnique", () => named) },
    agentRun: {
      create: record("agentRun", "create", () => ({ id: `run-${++runs}` })),
      update: record("agentRun", "update", () => ({})),
      findMany: record("agentRun", "findMany", () => analyzerRuns),
    },
    moodboard: {
      findMany: record("moodboard", "findMany", () => boardRows),
      findFirst: record("moodboard", "findFirst", (args) => {
        const where = args.where as { id: string };
        const row = boardRows.find((entry) => entry.id === where.id);
        return row ? { ...row } : null;
      }),
      update: record("moodboard", "update", (args) => {
        const where = args.where as { id: string };
        const data = args.data as { title: string };
        const row = boardRows.find((entry) => entry.id === where.id);
        return { id: where.id, title: data.title ?? row?.title };
      }),
      create: record("moodboard", "create", (args) => {
        const data = args.data as Partial<BoardRow>;
        return {
          id: `board-${++boards}`,
          title: data.title,
          widthPx: data.widthPx ?? null,
          heightPx: data.heightPx ?? null,
          layout: data.layout ?? null,
          pageCount: data.pageCount ?? 0,
          pageNames: data.pageNames ?? [],
        };
      }),
      updateMany: record("moodboard", "updateMany", (args) => {
        const where = args.where as { id: string; revision: number };
        const hit = boardRows.find(
          (row) => row.id === where.id && row.revision === where.revision,
        );
        if (!hit) return { count: 0 };
        const data = args.data as Partial<BoardRow> & { revision?: unknown };
        if (data.elements) hit.elements = data.elements;
        if (typeof data.pageCount === "number") hit.pageCount = data.pageCount;
        if (Array.isArray(data.pageNames)) hit.pageNames = data.pageNames;
        if (typeof data.title === "string") hit.title = data.title;
        if (data.layout !== undefined) hit.layout = data.layout;
        if (data.layoutSlots !== undefined) hit.layoutSlots = data.layoutSlots;
        if (typeof data.widthPx === "number") hit.widthPx = data.widthPx;
        if (typeof data.heightPx === "number") hit.heightPx = data.heightPx;
        if (data.appState !== undefined) hit.appState = data.appState;
        hit.revision += 1;
        return { count: 1 };
      }),
    },
  };

  const withTransaction = {
    ...db,
    $transaction: async (body: (tx: unknown) => Promise<unknown>) => {
      calls.push({ table: "$transaction", op: "run", args: {} });
      return body(withTransaction);
    },
  };

  const of = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op);
  return { db: withTransaction as unknown as PrismaClient, calls, of };
}

const filedCut = (calls: Call[]) => (calls[0]!.args as { data: Record<string, unknown> }).data;

const catalogOf = (brief: string) => (brief.split("\n\n")[1] ?? "").split("\n");

const BOX = { ymin: 200, xmin: 200, ymax: 800, xmax: 800 };

const CROP_USAGE = { promptTokens: 1800, outputTokens: 120, totalTokens: 1920 };
const COMPOSE_USAGE = { promptTokens: 900, outputTokens: 60, totalTokens: 960 };
const READ_USAGE = { promptTokens: 2600, outputTokens: 180, totalTokens: 2780 };

const spentOf = (write: { args: unknown }) => {
  const { model, promptTokens, outputTokens, totalTokens } = (
    write.args as { data: Record<string, unknown> }
  ).data;
  return { model, promptTokens, outputTokens, totalTokens };
};

function cropping(answer: Partial<CropperResult> | Partial<CropperResult>[] = {}) {
  const asked: unknown[] = [];
  const answers = Array.isArray(answer) ? answer : [answer];
  const crop = async (input: unknown) => {
    asked.push(input);
    return {
      model: "gemini-pro",
      box: BOX,
      intent: "the middle sunflower",
      rationale: "the subject fills the centre third",
      attempts: 1,
      usage: CROP_USAGE,
      ...answers[Math.min(asked.length, answers.length) - 1],
    } as CropperResult;
  };
  return { asked, crop: crop as never };
}

function cutting(
  size = { width: 2400, height: 1800 },
  contentType: Cut["contentType"] = "image/jpeg",
) {
  const cuts: { gcsUri: string; region: unknown }[] = [];
  const stored: { contentType: string; bytes: Uint8Array }[] = [];
  const kicks: number[] = [];
  const put = async (contentType: string, bytes: Uint8Array) => {
    stored.push({ contentType, bytes });
    return `gs://director-bucket/projects/p1/references/cut-${stored.length}.jpg`;
  };
  const thumb = thumbnailBox(size.width, size.height);
  return {
    cuts,
    stored,
    kicks,
    deps: {
      cutRegion: async (gcsUri: string, region: CropRegion): Promise<Cut> => {
        cuts.push({ gcsUri, region });
        return {
          bytes: new Uint8Array([1, 2, 3]),
          contentType,
          ...size,
          thumbnail: thumb.isNeeded
            ? { bytes: new Uint8Array([4, 5]), contentType: THUMBNAIL_CONTENT_TYPE }
            : null,
        };
      },
      storeImage: put,
      kickAnalyzer: () => kicks.push(1),
    },
  };
}

function composing(assignments: { blockId: string; slotId: string }[], note = "") {
  const asked: {
    blocks: { id: string; kind: string; text?: string; tags?: string[] }[];
    intention: string;
    layout: { id: string; slots: { id: string; kind: string }[] };
    inPlace?: { slotId: string; id: string }[];
    page?: { name?: string; page: string; board?: string; fresh?: true };
  }[] = [];
  const compose = async (input: unknown) => {
    asked.push(input as never);
    return { model: "gemini-pro", assignments, note, usage: COMPOSE_USAGE } as CompositorResult;
  };
  return { asked, compose: compose as never };
}

const PAGE_BOXES = [
  { box: [60, 60, 520, 480], kind: "image" },
  { box: [60, 520, 520, 940], kind: "image" },
  { box: [580, 60, 700, 940], kind: "text" },
];

function reading(
  boxes: readonly { box: number[]; kind: string }[] = PAGE_BOXES,
  image: { width: number; height: number } = { width: 1600, height: 900 },
) {
  const asked: { gcsUri: string; image?: unknown; intention?: string }[] = [];
  const attempt = layoutFromBoxes({ boxes, image, composition: "two across the top, a line under" });
  if ("fault" in attempt) throw new Error(`fixture is not a layout: ${attempt.fault}`);
  const readPage = async (input: unknown) => {
    asked.push(input as never);
    return {
      model: MODELS.FLASH,
      layout: attempt.layout,
      composition: attempt.layout.composition,
      attempts: 1,
      usage: READ_USAGE,
    };
  };
  return { asked, layout: attempt.layout, readPage: readPage as never };
}

const run = (toolset: ReturnType<typeof referenceToolset>, name: string, args: Record<string, unknown> = {}) =>
  toolset.execute({ name, args });

test("the project is read once however many tools are called", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "list_references");
  await run(toolset, "show_references", { referenceIds: ["a"] });
  await run(toolset, "list_references", { includeCrops: true });

  assert.equal(of("reference", "findMany").length, 1);
  assert.deepEqual((of("reference", "findMany")[0]!.args as { where: unknown }).where, {
    projectId: "p1",
  });
});

test("the user's brief reaches the model, off two small columns", async () => {
  const { db, of } = fakeDb([photo("a")], [], [], {
    title: "Cold open",
    brief: "Night exteriors, sodium light, nothing lit from the front.",
  });
  const brief = await referenceToolset({ db, projectId: "p1" }).brief();

  assert.match(brief, /^This project is called “Cold open”\./);
  assert.match(brief, /Night exteriors, sodium light, nothing lit from the front\./);
  assert.match(brief, /You cannot write or change the brief/);

  const [read] = of("project", "findUnique");
  assert.deepEqual((read!.args as { select: Record<string, unknown> }).select, {
    title: true,
    brief: true,
  });
});

test("the project is read once however many times the turn asks", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await toolset.brief();
  await toolset.brief();
  await toolset.declarations();
  await run(toolset, "list_references");

  assert.equal(of("project", "findUnique").length, 1);
});

test("the brief comes off the same read the tools use", async () => {
  const { db, of } = fakeDb([photo("a"), photo("cut", { source: { id: "a", title: "a" } })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  await run(toolset, "show_references", { referenceIds: ["a"] });

  assert.equal(of("reference", "findMany").length, 1);
  assert.match(brief, /^This project is called “p1”\./);
  assert.match(brief, /The project holds 1 photograph: 1 cut has been made of them\.\na · a · 4:3/);
  assert.ok(!brief.includes("gs://"), brief);
});

test("the catalog is every picture, and the photographs alone only when asked for", async () => {
  const rows = [photo("a"), photo("cut", { source: { id: "a", title: "a" }, editIntent: "hands" })];
  const { db } = fakeDb(rows);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const plain = (await run(toolset, "list_references")).result as {
    total: number;
    references: { id: string; croppedFrom?: string }[];
  };
  assert.deepEqual(plain.references.map((r) => r.id), ["a", "cut"]);
  assert.equal(plain.total, 2);
  assert.equal(plain.references[1]!.croppedFrom, "a");

  const photosOnly = (await run(toolset, "list_references", { includeCrops: false })).result as {
    total: number;
    references: { id: string }[];
  };
  assert.deepEqual(photosOnly.references.map((r) => r.id), ["a"]);
  assert.equal(photosOnly.total, 1);
});

test("a picture the user starred reaches the model marked, off the same read", async () => {
  const { db, of } = fakeDb([photo("a", { isFavorite: true }), photo("b")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  const lines = catalogOf(brief);
  assert.equal(lines[1], "a · a · starred · 4:3 · Golden_hour, Landscape");
  assert.equal(lines[2], "b · b · 4:3 · Golden_hour, Landscape");
  assert.match(lines[3]!, /the user starred in the gallery/);
  assert.equal(of("reference", "findMany").length, 1);
});

test("the star rides into the compositor's brief, and never as a false", async () => {
  const { db } = fakeDb([photo("a", { isFavorite: true }), photo("b")]);
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", { intention: "the ridge", referenceIds: ["a", "b"] });

  const blocks = asked[0]!.blocks as { id: string; favorite?: true }[];
  assert.equal(blocks.find((block) => block.id === "a")?.favorite, true);
  assert.equal("favorite" in blocks.find((block) => block.id === "b")!, false);
});

test("a photograph agent 2 has not read yet is marked in the brief, with why", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b", { analysis: null }), photo("c", { analysis: null })],
    [],
    [
      { input: { referenceId: "b" }, status: "RUNNING" },
      { input: { referenceId: "c" }, status: "FAILED" },
    ],
  );

  const brief = await referenceToolset({ db, projectId: "p1" }).brief();

  const lines = catalogOf(brief);
  assert.equal(lines[1], "a · a · 4:3 · Golden_hour, Landscape");
  assert.equal(lines[2], "b · b · 4:3 · not read yet");
  assert.equal(lines[3], "c · c · 4:3 · could not be read");
  assert.match(lines[4]!, /2 of these have not been read by the property analyzer/);
  assert.equal(of("agentRun", "findMany").length, 1);
});

test("the analyzer runs are not read when every picture has been read", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  await run(toolset, "list_references");

  assert.equal(of("agentRun", "findMany").length, 0);
  assert.equal(brief.includes("property analyzer"), false);
});

test("a catalog carrying an unread picture carries the sentence that explains it", async () => {
  const { db } = fakeDb(
    [photo("a"), photo("cut", { source: { id: "a", title: "a" }, analysis: null })],
    [],
    [{ input: { referenceId: "cut" }, status: "QUEUED" }],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const withCrops = (await run(toolset, "list_references")).result as {
    references: { id: string; unread?: string }[];
    unreadNote?: string;
  };
  assert.equal(withCrops.references[1]!.unread, "pending");
  assert.match(String(withCrops.unreadNote), /has not been read by the property analyzer/);

  const photosOnly = (await run(toolset, "list_references", { includeCrops: false })).result as {
    unreadNote?: string;
  };
  assert.equal(photosOnly.unreadNote, undefined);
});

test("a picture with no analyzer run at all is marked as never read", async () => {
  const { db } = fakeDb([photo("a", { analysis: null })]);
  const brief = await referenceToolset({ db, projectId: "p1" }).brief();

  assert.equal(catalogOf(brief)[1], "a · a · 4:3 · never read");
});

test("nothing the model reads carries a bucket path", async () => {
  const { db } = fakeDb([photo("a"), photo("cut", { source: { id: "a", title: "a" } })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const answers = [
    await run(toolset, "list_references", { includeCrops: true }),
    await run(toolset, "show_references", { referenceIds: ["a", "cut"] }),
  ];
  for (const answer of answers) {
    assert.ok(!JSON.stringify(answer.result).includes("gs://"), JSON.stringify(answer.result));
  }
});

test("show_references attaches what it found and names what it did not", async () => {
  const { db } = fakeDb([photo("a"), photo("cut", { source: { id: "a", title: "a" }, editIntent: "hands" })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "show_references", {
    referenceIds: ["cut", "ghost", "a"],
  });
  assert.deepEqual(result, { shown: ["cut", "a"], notFound: ["ghost"] });
  assert.deepEqual(
    attachments?.map((a) => a.kind === "reference" && [a.referenceId, a.frameId]),
    [["cut", "a"], ["a", null]],
  );
});

test("show_references names the pictures the strip had no room for", async () => {
  const references = Array.from({ length: SHOWN_LIMIT + 2 }, (_, index) => photo(`ref-${index}`));
  const { db } = fakeDb(references);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "show_references", {
    referenceIds: references.map((reference) => reference.id),
  });

  assert.equal((attachments ?? []).length, SHOWN_LIMIT);
  assert.deepEqual(result.notShown, [`ref-${SHOWN_LIMIT}`, `ref-${SHOWN_LIMIT + 1}`]);
  assert.match(String(result.notShownNote), /not put in front of the user/);
  assert.equal(result.notFound, undefined);
});

test("an unknown tool is answered rather than thrown", async () => {
  const { db } = fakeDb([]);
  const toolset = referenceToolset({ db, projectId: "p1" });
  assert.match(String((await run(toolset, "build_deck")).result.error), /no tool called build_deck/);
});

test("crop_reference cuts the frame, files the row and shows the cut", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping({ attempts: 2 });
  const seam = cutting();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...seam.deps });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the middle sunflower",
    aspect: "16:9",
  });

  assert.equal((asked[0] as { gcsUri: string }).gcsUri, "gs://director-bucket/uploads/a.jpg");
  assert.deepEqual(seam.cuts, [
    {
      gcsUri: "gs://director-bucket/uploads/a.jpg",
      region: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
    },
  ]);
  assert.deepEqual(
    seam.stored.map((entry) => entry.contentType),
    ["image/jpeg", "image/jpeg"],
  );
  assert.equal(seam.kicks.length, 1);

  assert.match(String(result.status), /cut and filed as a version of a/);
  assert.match(String(result.status), /frame it came out of is untouched/);
  assert.match(String(result.status), /discard_reference/);
  assert.match(String(result.status), /made rather than offered/);
  assert.equal(result.referenceId, "made-1");
  assert.equal(result.cutOf, "a");
  assert.ok(!JSON.stringify(result).includes("gs://"));

  const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(written.sourceReferenceId, "a");
  assert.equal(written.title, "a (crop)");
  assert.equal(written.editIntent, "the middle sunflower");
  assert.equal(written.editAspect, "16:9");
  assert.deepEqual(written.cropBox, [200, 100, 800, 900]);
  assert.equal(written.width, 2400);
  assert.equal(written.height, 1800);
  assert.equal(of("$transaction", "run").length, 1);
  assert.equal(of("agentRun", "create").length, 2);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "reference");
  assert.equal(attachment?.kind === "reference" && attachment.referenceId, "made-1");
  assert.equal(attachment?.kind === "reference" && attachment.frameId, "a");

  const [created] = of("agentRun", "create");
  assert.deepEqual((created!.args as { data: { input: unknown } }).data.input, {
    referenceId: "a",
    prompt: "the middle sunflower",
    aspect: "16:9",
    via: "orchestrator",
  });
  const [finished] = of("agentRun", "update");
  const data = (
    finished!.args as {
      data: {
        status: string;
        output: { attempts: number; referenceId: string };
      };
    }
  ).data;
  assert.equal(data.status, "SUCCEEDED");
  assert.equal(data.output.referenceId, "made-1");
  assert.equal(data.output.attempts, 2);
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...CROP_USAGE });
});

test("the answer says what the cut keeps, since nothing draws it any more", async () => {
  const { db } = fakeDb([photo("a")]);
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...cutting().deps });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the middle sunflower",
    aspect: "16:9",
  });

  assert.equal(result.size, "16:9 · Keeps 48% of the frame · About 3200 × 1800 px");
  const { size, ...rest } = result as Record<string, unknown>;
  assert.ok(size);
  assert.ok(!JSON.stringify(rest).includes("Keeps"));
  assert.ok(!JSON.stringify(rest).includes(" px"));
});

test("a cut already inside the thumbnail box is filed without a second copy", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { crop } = cropping();
  const seam = cutting({ width: 480, height: 320 });
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...seam.deps });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the sign over the door",
  });

  assert.equal(result.referenceId, "made-1");
  assert.equal(seam.stored.length, 1);
  const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(written.thumbGcsUri, undefined);
  assert.equal(written.width, 480);
  assert.equal(written.height, 320);
});

test("a filed cut is not swept for a derived copy and a drawn picture is", async () => {
  const shown = (of: ReturnType<typeof fakeDb>["of"], id: string) => {
    const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
    return forDisplay({
      id,
      gcsUri: String(written.gcsUri),
      thumbGcsUri: (written.thumbGcsUri as string | undefined) ?? null,
      width: written.width as number,
      height: written.height as number,
    });
  };

  const big = fakeDb([photo("a")]);
  await run(
    referenceToolset({ db: big.db, projectId: "p1", crop: cropping().crop, ...cutting().deps }),
    "crop_reference",
    { referenceId: "a", intention: "the middle sunflower" },
  );

  const inside = fakeDb([photo("a")]);
  const small = cutting({ width: 480, height: 320 });
  await run(
    referenceToolset({ db: inside.db, projectId: "p1", crop: cropping().crop, ...small.deps }),
    "crop_reference",
    { referenceId: "a", intention: "the sign over the door" },
  );

  const made = fakeDb([]);
  await run(
    referenceToolset({
      db: made.db,
      projectId: "p1",
      generate: drawing().generate,
      ...filing(),
    }),
    "generate_image",
    { description: "a warm grey paper texture" },
  );

  assert.deepEqual(
    referencesOwedCopies(
      [shown(big.of, "cut"), shown(inside.of, "inside"), shown(made.of, "drawn")],
      new Set(),
    ).map((row) => row.id),
    ["drawn"],
  );
});

test("the cut is filed under the digest of the cut, not of its copy", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { crop } = cropping();
  const seam = cutting();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...seam.deps });

  await run(toolset, "crop_reference", { referenceId: "a", intention: "the middle sunflower" });

  const asFile = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]);
  const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(written.contentHash, await hashFileContent(asFile(seam.stored[0]!.bytes)));
  assert.notEqual(written.contentHash, await hashFileContent(asFile(seam.stored[1]!.bytes)));
});

test("a PNG cut is stored as a PNG and its grid copy as the JPEG it is", async () => {
  const { db } = fakeDb([photo("a", { gcsUri: "gs://director-bucket/uploads/a.png" })]);
  const { crop } = cropping();
  const seam = cutting({ width: 2400, height: 1800 }, "image/png");
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...seam.deps });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the middle sunflower",
  });

  assert.equal(result.referenceId, "made-1");
  assert.deepEqual(
    seam.stored.map((entry) => entry.contentType),
    ["image/png", THUMBNAIL_CONTENT_TYPE],
  );
});

test("a crop the cropper gave up on records what giving up cost", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const crop = (async () => {
    throw Object.assign(new CropperError("no usable box"), { usage: CROP_USAGE });
  }) as never;
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  await run(toolset, "crop_reference", { referenceId: "a", intention: "the hands" });
  const [failed] = of("agentRun", "update");
  assert.equal((failed!.args as { data: { status: string } }).data.status, "FAILED");
  assert.deepEqual(spentOf(failed!), { model: MODELS.FLASH, ...CROP_USAGE });
});

test("a crop of a frame this project does not hold costs nothing", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", { referenceId: "b", intention: "the hands" });
  assert.match(String(result.error), /no reference called b/);
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a format asked of a frame with no recorded size is refused before the read", async () => {
  const { db, of } = fakeDb([photo("a", { width: null, height: null })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the hands",
    aspect: "2.39:1",
  });
  assert.match(String(result.error), /pixel size was never recorded/);
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a crop with nothing said to crop is refused before the read", async () => {
  const { db } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", { referenceId: "a", intention: "  " });
  assert.match(String(result.error), /say what to crop/);
  assert.equal(asked.length, 0);
});

test("a shape the list does not name is cut at exactly that shape", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the doorway",
    aspect: "5:4",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "1.25:1");
  assert.equal(result.aspect, "1.25:1");
  const filed = (of("reference", "create")[0]!.args as { data: { editAspect: string } }).data;
  assert.equal(filed.editAspect, "1.25:1");
  const [created] = of("agentRun", "create");
  assert.equal(
    (created!.args as { data: { input: { aspect: string } } }).data.input.aspect,
    "1.25:1",
  );
});

test("a shape that cannot be read is refused before the read, not dropped", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the doorway",
    aspect: "widescreen",
  });

  assert.match(String(result.error), /not a shape/);
  assert.match(String(result.error), /16:9/);
  assert.match(String(result.error), /square\/landscape/);
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a crop asked for a board cuts and makes the swap in the one call", async () => {
  const rows = [board("bd1", ["a", "b"], { title: "Ridge" })];
  const { db, of } = fakeDb([photo("a"), photo("b")], rows);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "1:1",
    boardId: "bd1",
  });

  assert.deepEqual(
    rows[0]!.elements.map((element) => element.fileId),
    ["ref:made-1", "ref:b"],
  );
  assert.equal(of("moodboard", "updateMany").length, 1);
  assert.match(String(result.status), /put on “Ridge”/);
  assert.match(String(result.status), /frame itself is untouched/);
  assert.match(String(result.status), /discard_reference on made-1/);
  assert.equal(result.notOnThatBoard, undefined);
  assert.equal(result.notPutOnBoard, undefined);

  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference", "board"],
  );
});

test("a crop that names a board says nothing about the boards it left alone", async () => {
  const rows = [
    board("bd1", ["a", "b"], { title: "Ridge" }),
    board("bd2", ["a"], { title: "Coast" }),
  ];
  const { db, of } = fakeDb([photo("a"), photo("b")], rows);
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...cutting().deps });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.match(String(result.status), /put on “Ridge”/);
  assert.equal(result.alsoOnBoards, undefined);
  assert.equal(of("moodboard", "findMany").length, 0);
});

test("a crop asked for a board the frame is not on is filed without the swap, and says so", async () => {
  const rows = [board("bd1", ["b"], { title: "Ridge" })];
  const { db, of } = fakeDb([photo("a"), photo("b")], rows);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.deepEqual(
    rows[0]!.elements.map((element) => element.fileId),
    ["ref:b"],
  );
  assert.match(String(result.notOnThatBoard), /a is not on “Ridge”/);
  assert.match(
    String(result.notOnThatBoard),
    /the cut was filed and nothing on that board changed/,
  );
  assert.ok(!String(result.notOnThatBoard).includes("will not be put on it"));
  assert.match(String(result.notOnThatBoard), /design_page naming made-1/);
  assert.match(String(result.status), /cut and filed/);
  assert.ok(!String(result.status).includes("Ridge"));
  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference"],
  );
});

test("a crop whose board refuses the swap is filed all the same, and the answer says so", async () => {
  const rows = [board("bd1", ["a", "b"], { title: "Ridge" })];
  const { db, of, calls } = fakeDb([photo("a"), photo("b")], rows);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const moodboard = (db as unknown as { moodboard: { findFirst: (a: unknown) => Promise<unknown> } })
    .moodboard;
  const read = moodboard.findFirst;
  moodboard.findFirst = async (args: unknown) => {
    const row = await read(args);
    rows[0]!.revision += 1;
    return row;
  };

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.equal(result.referenceId, "made-1");
  assert.equal(of("reference", "create").length, 1);
  assert.equal(filedCut(of("reference", "create")).sourceReferenceId, "a");
  assert.equal(of("moodboard", "updateMany").length, 1);
  assert.deepEqual(
    rows[0]!.elements.map((element) => element.fileId),
    ["ref:a", "ref:b"],
  );

  assert.match(String(result.notPutOnBoard), /the cut is filed/);
  assert.match(String(result.notPutOnBoard), /changed while I was editing it/);
  assert.match(String(result.status), /cut and filed/);
  assert.ok(!String(result.status).includes("put on"));

  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference"],
  );

  const updates = of("agentRun", "update");
  const finish = updates[updates.length - 1]!;
  const { status } = (finish.args as { data: { status: string } }).data;
  assert.equal(status, "SUCCEEDED");
  assert.equal(calls.filter((c) => c.table === "$transaction").length, 1);
});

test("a crop for a board of another project is refused before the read", async () => {
  const { db, of } = fakeDb([photo("a")], [board("bd1", ["a"])]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "elsewhere",
  });
  assert.match(String(result.error), /no board called elsewhere/);
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  const [read] = of("moodboard", "findFirst");
  assert.deepEqual((read!.args as { where: unknown }).where, { id: "elsewhere", projectId: "p1" });
});

const CROPPABLE = Array.from({ length: CROP_CALL_LIMIT }, (_, at) => `frame-${at + 1}`);
const PAST_THE_CEILING = `frame-${CROP_CALL_LIMIT + 1}`;
const EVERY_FRAME = [...CROPPABLE, PAST_THE_CEILING];
const WHOLE_FRAME = { box: { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 } };

test("the turn's crop budget is spent once, not once per round", async () => {
  const { db } = fakeDb(EVERY_FRAME.map((id) => photo(id)));
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  for (const id of CROPPABLE) {
    const { result } = await run(toolset, "crop_reference", { referenceId: id, intention: "the subject" });
    assert.equal(result.error, undefined);
  }
  const { result } = await run(toolset, "crop_reference", {
    referenceId: PAST_THE_CEILING,
    intention: "the subject",
  });
  assert.match(String(result.error), /already filed/);
  assert.equal(asked.length, CROP_CALL_LIMIT);
});

test("a turn whose reads were all refused is refused in terms of the cuts it has", async () => {
  const { db } = fakeDb(EVERY_FRAME.map((id) => photo(id)));
  const { asked, crop } = cropping(WHOLE_FRAME);
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  for (const id of CROPPABLE) {
    const { result } = await run(toolset, "crop_reference", { referenceId: id, intention: "the subject" });
    assert.ok(result.error);
  }
  const { result } = await run(toolset, "crop_reference", {
    referenceId: PAST_THE_CEILING,
    intention: "the subject",
  });
  assert.match(String(result.error), /none of them could be cut/);
  assert.ok(!String(result.error).includes("tell the user what you cut"));
  assert.equal(asked.length, CROP_CALL_LIMIT);
});

test("a turn that got one cut of the frames it paid for is told which number it holds", async () => {
  const { db } = fakeDb(EVERY_FRAME.map((id) => photo(id)));
  const { crop } = cropping([{}, WHOLE_FRAME]);
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const [first, ...rest] = CROPPABLE;
  const filed = await run(toolset, "crop_reference", { referenceId: first!, intention: "the subject" });
  assert.equal(filed.result.error, undefined);
  for (const id of rest) {
    const { result } = await run(toolset, "crop_reference", { referenceId: id, intention: "the subject" });
    assert.ok(result.error);
  }

  const { result } = await run(toolset, "crop_reference", {
    referenceId: PAST_THE_CEILING,
    intention: "the subject",
  });
  assert.match(String(result.error), /1 of them was filed/);
  assert.match(String(result.error), /tell the user which cuts they have/);
});

test("the crop ceiling stops the model rather than asking the user", async () => {
  const { db } = fakeDb(EVERY_FRAME.map((id) => photo(id)));
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...cutting().deps });

  for (const id of CROPPABLE) {
    await run(toolset, "crop_reference", { referenceId: id, intention: "the subject" });
  }
  const { result } = await run(toolset, "crop_reference", {
    referenceId: PAST_THE_CEILING,
    intention: "the subject",
  });
  assert.doesNotMatch(String(result.error), /ask the user/i);
  assert.match(String(result.error), /stop cropping/);
});

test("the turn's ceiling bounds the rows it files, not only the frames it reads", async () => {
  const { db, of } = fakeDb(EVERY_FRAME.map((id) => photo(id)));
  const { crop } = cropping();
  const seam = cutting();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...seam.deps });

  for (const id of CROPPABLE) {
    const { result } = await run(toolset, "crop_reference", {
      referenceId: id,
      intention: "the subject",
    });
    assert.equal(result.error, undefined);
  }
  const stored = seam.stored.length;

  const { result } = await run(toolset, "crop_reference", {
    referenceId: PAST_THE_CEILING,
    intention: "the subject",
  });
  assert.match(String(result.error), /already filed/);

  assert.equal(seam.cuts.length, CROP_CALL_LIMIT);
  assert.equal(seam.stored.length, stored);
  assert.equal(seam.kicks.length, CROP_CALL_LIMIT);
  assert.equal(of("reference", "create").length, CROP_CALL_LIMIT);
  assert.equal(of("agentRun", "create").length, 2 * CROP_CALL_LIMIT);
  assert.deepEqual(await toolset.state(), {
    photographs: EVERY_FRAME.length,
    crops: CROP_CALL_LIMIT,
    boards: 0,
    generated: 0,
  });
});

test("a cut made this turn is on the canvas in the same turn", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", [])]);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const made = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the hands",
  });
  const referenceId = String(made.result.referenceId);

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: [{ kind: "image", referenceId, box: [0, 0, 300, 400] }],
  });

  assert.equal(result.error, undefined);
  assert.equal((result.put as unknown[]).length, 1);
  assert.equal(of("reference", "findMany").length, 1);
});

test("a cut filed this turn is a cut for the rest of it, not a photograph", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...cutting().deps });

  const made = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the middle sunflower",
  });
  const cutId = String(made.result.referenceId);

  assert.deepEqual(await toolset.state(), {
    photographs: 1,
    crops: 1,
    boards: 0,
    generated: 0,
  });

  const photosOnly = (await run(toolset, "list_references", { includeCrops: false }))
    .result as { references: { id: string }[] };
  assert.deepEqual(photosOnly.references.map((reference) => reference.id), ["a"]);
  const withCrops = (await run(toolset, "list_references")).result as {
    references: { id: string }[];
  };
  assert.deepEqual(withCrops.references.map((reference) => reference.id), [cutId, "a"]);

  await run(toolset, "crop_reference", { referenceId: cutId, intention: "a little wider" });
  const nudge = asked[1] as { gcsUri: string; previous?: unknown };
  assert.equal(nudge.gcsUri, "gs://director-bucket/uploads/a.jpg");
  assert.deepEqual(nudge.previous, {
    cropBox: [200, 200, 800, 800],
    editIntent: "the middle sunflower",
  });

  assert.equal(of("reference", "findMany").length, 1);
});

test("two crops in one round are both in the turn the round after them", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")], [board("board-7", [])]);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const [first, second] = await Promise.all([
    run(toolset, "crop_reference", { referenceId: "a", intention: "the hands" }),
    run(toolset, "crop_reference", { referenceId: "b", intention: "the sign" }),
  ]);
  const cuts = [String(first.result.referenceId), String(second.result.referenceId)];

  assert.deepEqual(await toolset.state(), {
    photographs: 2,
    crops: 2,
    boards: 1,
    generated: 0,
  });
  const listed = (await run(toolset, "list_references")).result as {
    references: { id: string }[];
  };
  assert.deepEqual(
    listed.references.map((reference) => reference.id).slice(0, 2).sort(),
    [...cuts].sort(),
  );

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: cuts.map((referenceId, index) => ({
      kind: "image" as const,
      referenceId,
      box: [index * 400, 0, index * 400 + 300, 400],
    })),
  });

  assert.equal(result.error, undefined);
  assert.equal((result.put as unknown[]).length, 2);
  assert.equal(of("reference", "findMany").length, 1);
});

test("two crops for one board in a round both land, in turn", async () => {
  const held = board("board-7", ["a", "b"]);
  const { db, of } = fakeDb([photo("a"), photo("b")], [held]);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const [first, second] = await Promise.all([
    run(toolset, "crop_reference", {
      referenceId: "a",
      intention: "the hands",
      boardId: "board-7",
    }),
    run(toolset, "crop_reference", {
      referenceId: "b",
      intention: "the sign",
      boardId: "board-7",
    }),
  ]);

  assert.equal(first.result.notPutOnBoard, undefined);
  assert.equal(second.result.notPutOnBoard, undefined);
  const guards = of("moodboard", "updateMany").map(
    (write) => (write.args as { where: { revision: number } }).where.revision,
  );
  assert.deepEqual(guards, [3, 4]);
  assert.deepEqual(
    held.elements.map((element) => element.fileId),
    ["ref:made-1", "ref:made-2"],
  );
});

test("two crops for no board read their frames at the same time", async () => {
  const { db } = fakeDb([photo("a"), photo("b")]);

  let inFlight = 0;
  let mostAtOnce = 0;
  let bothIn!: () => void;
  const both = new Promise<void>((resolve) => {
    bothIn = resolve;
  });
  const giveUp = setTimeout(() => bothIn(), 500);

  const crop = (async () => {
    inFlight += 1;
    mostAtOnce = Math.max(mostAtOnce, inFlight);
    if (inFlight === 2) bothIn();
    await both;
    inFlight -= 1;
    return {
      model: "gemini-pro",
      box: BOX,
      intent: "the middle sunflower",
      rationale: "the subject fills the centre third",
      attempts: 1,
      usage: CROP_USAGE,
    };
  }) as never;

  const toolset = referenceToolset({ db, projectId: "p1", crop, ...cutting().deps });
  const answers = await Promise.all([
    run(toolset, "crop_reference", { referenceId: "a", intention: "the hands" }),
    run(toolset, "crop_reference", { referenceId: "b", intention: "the sign" }),
  ]);
  clearTimeout(giveUp);

  assert.equal(mostAtOnce, 2);
  assert.deepEqual(
    answers.map((answer) => answer.result.error),
    [undefined, undefined],
  );
});

test("a frame that could not be cut is refused with a sentence", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const seam = cutting();
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...seam.deps,
    cutRegion: async () => {
      throw new Error("Input buffer contains unsupported image format");
    },
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the hands",
  });

  assert.match(String(result.error), /could not be cut/);
  assert.equal(attachments, undefined);
  assert.equal(seam.stored.length, 0);
  assert.equal(of("reference", "create").length, 0);
  assert.equal(seam.kicks.length, 0);
  const [finished] = of("agentRun", "update");
  assert.equal((finished!.args as { data: { status: string } }).data.status, "FAILED");
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...CROP_USAGE });
});

test("a frame too large to read back says so and says not to ask again", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const seam = cutting();
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...seam.deps,
    cutRegion: async () => {
      throw new ObjectTooLargeError("gs://test-bucket/a.jpg is 340 MB, past the 100 MB ...");
    },
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the hands",
  });

  assert.match(String(result.error), /too large a file to cut/);
  assert.match(String(result.error), /do not ask for a cut of it again/);
  assert.equal(attachments, undefined);
  assert.equal(seam.stored.length, 0);
  assert.equal(of("reference", "create").length, 0);
  const [finished] = of("agentRun", "update");
  assert.equal((finished!.args as { data: { status: string } }).data.status, "FAILED");
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...CROP_USAGE });
});

test("a cut the bucket would not take is not filed", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const seam = cutting();
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...seam.deps,
    storeImage: async (contentType: string, bytes: Uint8Array) =>
      seam.stored.length
        ? Promise.reject(new Error("503 from the bucket"))
        : seam.deps.storeImage(contentType, bytes),
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the hands",
  });

  assert.match(String(result.error), /could not be stored/);
  assert.equal(attachments, undefined);
  assert.equal(seam.stored.length, 1);
  assert.equal(of("reference", "create").length, 0);
  assert.equal(seam.kicks.length, 0);
  const [finished] = of("agentRun", "update");
  assert.equal((finished!.args as { data: { status: string } }).data.status, "FAILED");
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...CROP_USAGE });
});

test("a cut that is stored but cannot be filed answers with a sentence", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const seam = cutting();
  const { crop } = cropping();
  const toolset = referenceToolset({
    db: {
      ...db,
      $transaction: async () => {
        throw new Error("deadlock detected");
      },
    } as never,
    projectId: "p1",
    crop,
    ...seam.deps,
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the hands",
  });

  assert.match(String(result.error), /could not be written/);
  assert.equal(attachments, undefined);
  assert.equal(seam.stored.length, 2);
  const data = (
    of("agentRun", "update")[0]!.args as {
      data: { status: string; error: string };
    }
  ).data;
  assert.equal(data.status, "FAILED");
  assert.deepEqual(spentOf(of("agentRun", "update")[0]!), {
    model: "gemini-pro",
    ...CROP_USAGE,
  });
});

test("a box that is the whole frame ends the run as a failure with the reason on it", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { crop } = cropping({
    box: { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 },
  });
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "all of it",
  });
  assert.match(String(result.error), /the whole frame is the shot/);
  assert.equal(attachments, undefined);
  assert.equal(of("reference", "create").length, 0);
  const data = (
    of("agentRun", "update")[0]!.args as {
      data: { status: string; error: string };
    }
  ).data;
  assert.equal(data.status, "FAILED");
  assert.match(data.error, /the whole frame is the shot/);
  assert.deepEqual(spentOf(of("agentRun", "update")[0]!), {
    model: "gemini-pro",
    ...CROP_USAGE,
  });
});

test("a cropper that throws is recorded as a failed run rather than a 500", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const crop = (async () => {
    throw new Error("cropper returned no content");
  }) as never;
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", { referenceId: "a", intention: "the hands" });
  assert.equal(result.error, "cropper returned no content");
  const data = (of("agentRun", "update")[0]!.args as { data: { status: string; error: string } }).data;
  assert.equal(data.status, "FAILED");
  assert.equal(data.error, "cropper returned no content");
});

test("compose_moodboard files a board at the layout's page size and attaches it", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { asked, compose } = composing(
    [
      { blockId: "b", slotId: "img-1" },
      { blockId: "a", slotId: "img-2" },
    ],
    "the wider one leads",
  );
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "the light before a storm",
    referenceIds: ["a", "b"],
  });

  assert.equal(result.layout, "SPLIT");
  assert.equal(result.boardId, "board-1");
  assert.equal(result.note, "the wider one leads");

  const data = (of("moodboard", "create")[0]!.args as {
    data: { projectId: string; title: string; widthPx: number; heightPx: number; elements: unknown[] };
  }).data;
  assert.equal(data.projectId, "p1");
  assert.equal(data.title, "the light before a storm");
  assert.deepEqual([data.widthPx, data.heightPx], [1920, 1080]);
  assert.equal(data.elements.length, 3);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "board");
  assert.equal(attachment?.kind === "board" && attachment.thumbUrl, "/api/references/b/image?variant=thumb");
  assert.match(attachment?.caption ?? "", /^2 photographs · /);

  assert.equal(asked[0]!.intention, "the light before a storm");
  assert.ok(!JSON.stringify(asked[0]).includes("gs://"));
});

test("a board is composed as one page, at the size of the template it was laid out on", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "the light before a storm",
    referenceIds: ["a", "b"],
  });

  const { data } = of("moodboard", "create")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.name, "Page 1");
  assert.deepEqual([pages[0]!.width, pages[0]!.height], [1920, 1080]);
  assert.equal(pages[0]!.preset, "LANDSCAPE_HD");
  assert.deepEqual(
    pageItems(boardItems(data.elements as never), pages[0]!).map((item) => item.clipped),
    [false, false],
  );
});

test("a compose says which page the board now stands on, filed or rebuilt", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      composedBoard(
        "board-7",
        strip,
        [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]],
        { id: "page-7", name: "Cold open" },
      ),
    ],
  );
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const filed = await run(toolset, "compose_moodboard", {
    intention: "the light before a storm",
    referenceIds: ["a", "b", "c"],
  });
  const page = filed.result.page as { pageId: string; name: string };
  assert.equal(page.name, "Page 1");
  assert.ok(page.pageId);

  const rebuilt = await run(toolset, "compose_moodboard", {
    intention: "add the third one",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });
  assert.deepEqual(rebuilt.result.page, { pageId: "page-7", name: "Cold open" });
});

test("a rebuild keeps the page the board already stands on, name and all", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      composedBoard(
        "board-7",
        strip,
        [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]],
        { id: "page-7", name: "Cold open" },
      ),
    ],
  );
  const { compose } = composing([{ blockId: "c", slotId: "img-3" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "add the third one",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.id, "page-7");
  assert.equal(pages[0]!.name, "Cold open");
  assert.deepEqual(
    (data.elements as { type: string; frameId?: string }[])
      .filter((element) => element.type === "image")
      .map((element) => element.frameId),
    ["page-7", "page-7", "page-7"],
  );
});

function spreadBoard(
  id: string,
  layout: MoodboardLayout,
  pages: readonly {
    id: string;
    name: string;
    placed: readonly [string, string, number, number][];
    lines?: readonly string[];
  }[],
) {
  return board(id, [], {
    layout: layout.id,
    widthPx: layout.page.width,
    heightPx: layout.page.height,
    elements: pages.flatMap(({ id: pageId, name, placed, lines = [] }, index) => {
      const left = index * (layout.page.width + PAGE_GAP);
      return [
        ...placed.map(([referenceId, slotId, width, height], slot) => {
          const box = fitInSlot(layout.slots.find((entry) => entry.id === slotId)!, {
            id: referenceId,
            kind: "image",
            width,
            height,
          });
          return {
            id: `${pageId}-el-${slot}`,
            type: "image",
            fileId: `ref:${referenceId}`,
            frameId: pageId,
            ...box,
            x: box.x + left,
          };
        }),
        ...lines.map((text, line) => ({
          id: `${pageId}-txt-${line}`,
          type: "text",
          text,
          originalText: text,
          frameId: pageId,
          x: left + 100,
          y: 900 + line * 60,
          width: 600,
          height: 40,
        })),
        pageFrame(
          { x: left, y: 0, width: layout.page.width, height: layout.page.height },
          { name, makeId: () => pageId },
        ),
      ];
    }) as never,
  });
}

function standingBehind(row: BoardRow, layout: MoodboardLayout, pageId: string, referenceId: string) {
  return {
    ...row,
    elements: [
      {
        id: `${pageId}-behind`,
        type: "image",
        fileId: `ref:${referenceId}`,
        frameId: pageId,
        x: -240,
        y: 0,
        width: layout.page.width + 480,
        height: layout.page.height,
      },
      ...(row.elements as readonly unknown[]),
    ] as never,
  };
}

test("a page read names what stands behind it apart from the pictures on it", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("sketch")],
    [
      standingBehind(
        spreadBoard("board-7", split, [
          { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        ]),
        split,
        "page-1",
        "sketch",
      ),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "page-1" });

  assert.equal(result.background, "sketch");
  assert.match(String(result.backgroundNote), /stands behind the whole page/);
  assert.deepEqual(
    (result.pictures as { id: string }[]).map(({ id }) => id),
    ["a", "b"],
  );
  const behind = (result.arrangement as { referenceId: string; box: number[]; z: number }[]).find(
    (block) => block.referenceId === "sketch",
  );
  assert.deepEqual(behind?.box, [0, 0, 1000, 1000]);
  assert.equal(behind?.z, 0);
});

test("a rebuild lays the page out again on the background rather than over it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("sketch")],
    [
      standingBehind(
        spreadBoard("board-7", split, [
          { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        ]),
        split,
        "page-1",
        "sketch",
      ),
    ],
  );
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-2" },
    { blockId: "b", slotId: "img-1" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "swap them round",
    boardId: "board-7",
  });
  assert.equal(result.error, undefined);

  assert.deepEqual(
    asked[0]!.blocks.map(({ id }) => id),
    ["a", "b"],
  );

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const written = data.elements as { id: string; frameId?: string }[];
  const behind = written.find((element) => element.id === "page-1-behind");
  assert.ok(behind, "the background survived the rebuild");
  assert.equal(behind!.frameId, "page-1");
  const pages = boardPages(written);
  assert.equal(
    pageContents(written as never, pages[0]!).background,
    "sketch",
    "and it is still read as the background afterwards",
  );
  assert.deepEqual(
    pageContents(written as never, pages[0]!).pictures.map((picture) => picture.referenceId),
    ["b", "a"],
  );
});

test("a compose named a page lays out that page and leaves the board's others standing", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c"), photo("d")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([{ blockId: "d", slotId: "img-2" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "the second page needs the doorway",
    boardId: "board-7",
    pageId: "page-2",
    addReferenceIds: ["d"],
  });

  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["d"]);
  assert.deepEqual(asked[0]!.inPlace?.map(({ slotId, id }) => [slotId, id]), [["img-1", "c"]]);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(
    (data.elements as { id: string }[]).slice(0, 3).map((element) => element.id),
    ["page-1-el-0", "page-1-el-1", "page-1"],
  );

  const pages = boardPages(data.elements);
  assert.deepEqual(pages.map((page) => [page.id, page.name, page.x]), [
    ["page-1", "Cold open", 0],
    ["page-2", "Act two", split.page.width + PAGE_GAP],
  ]);
  assert.deepEqual(
    pageItems(boardItems(data.elements as never), pages[1]!).map((item) => item.clipped),
    [false, false],
  );
  assert.equal(pageItems(boardItems(data.elements as never), pages[0]!).length, 2);
});

test("a page laid out again is laid out from the pictures on that page", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([{ blockId: "c", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "lay the second page out again",
    boardId: "board-7",
    pageId: "page-2",
    layout: "SPLIT",
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["c"]);
  assert.match(String(result.status), /^laid out again on “Act two”/);
});

test("a compose named a page tells the compositor which page of the board it is laying out", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([{ blockId: "c", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "lay the second page out again",
    boardId: "board-7",
    pageId: "page-2",
    layout: "SPLIT",
  });

  assert.deepEqual(asked[0]!.page, { name: "Act two", page: "2 of 2", board: "Board board-7" });
  const { data } = of("agentRun", "create")[0]!.args as { data: { input: Record<string, unknown> } };
  assert.equal(data.input.onPage, "page-2");
});

test("a compose onto a page of its own tells the compositor the page is fresh", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([{ blockId: "c", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the doorway on a page of its own",
    boardId: "board-7",
    newPage: true,
    referenceIds: ["c"],
  });

  assert.deepEqual(asked[0]!.page, {
    name: "Page 3",
    page: "3 of 3",
    board: "Board board-7",
    fresh: true,
  });
  assert.equal((result.page as { name: string }).name, "Page 3");
  const { data } = of("agentRun", "create")[0]!.args as { data: { input: Record<string, unknown> } };
  assert.equal(data.input.onNewPage, true);
  assert.equal("onPage" in data.input, false);
});

test("a board of one page is composed without a page brief", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "lay it out again with the doorway",
    boardId: "board-7",
    referenceIds: ["a", "b"],
    layout: "SPLIT",
  });

  assert.equal(asked[0]!.page, undefined);
});

test("a compose for a page the board has not got is refused with the ids that would have worked", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the third page",
    boardId: "board-7",
    pageId: "page-9",
    addReferenceIds: ["a"],
  });

  assert.match(String(result.error), /no page called page-9/);
  assert.deepEqual(
    (result.pages as { pageId: string; name: string }[]).map(({ pageId, name }) => [pageId, name]),
    [
      ["page-1", "Cold open"],
      ["page-2", "Act two"],
    ],
  );
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a picture dragged off the page is neither laid out again nor written over", async () => {
  const split = layoutById("SPLIT")!;
  const standing = spreadBoard("board-7", split, [
    { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
  ]);
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      {
        ...standing,
        elements: [
          ...standing.elements,
          {
            id: "beside",
            type: "image",
            fileId: "ref:b",
            x: 200,
            y: split.page.height + 400,
            width: 400,
            height: 300,
          },
        ] as never,
      },
    ],
  );
  const { asked, compose } = composing([{ blockId: "c", slotId: "img-2" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "put the doorway on it too",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["c"]);
  assert.deepEqual(asked[0]!.inPlace?.map(({ id }) => id), ["a"]);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const loose = (data.elements as { id: string; x: number; y: number }[]).find(
    (element) => element.id === "beside",
  );
  assert.deepEqual([loose?.x, loose?.y], [200, split.page.height + 400]);
});

test("a compose about a page the user resized keeps their rectangle and fits the template into it", async () => {
  const split = layoutById("SPLIT")!;
  const theirs = { width: split.page.width * 2, height: split.page.height * 2 };
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      board("board-7", [], {
        layout: split.id,
        elements: [
          pageFrame({ x: 0, y: 0, ...theirs }, { name: "Cold open", makeId: () => "page-7" }),
        ] as never,
      }),
    ],
  );
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "lay that page out again",
    boardId: "board-7",
    referenceIds: ["a", "b"],
  });

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: unknown[]; widthPx?: number; heightPx?: number };
  };
  const [page] = boardPages(data.elements);
  assert.deepEqual(
    [page?.id, page?.width, page?.height, page?.preset],
    ["page-7", theirs.width, theirs.height, "Custom"],
  );

  const items = pageItems(boardItems(data.elements as never), page!);
  assert.deepEqual(items.map((item) => item.clipped), [false, false]);
  assert.ok(Math.max(...items.map((item) => item.x + item.width)) > theirs.width * 0.9);
  assert.deepEqual([data.widthPx, data.heightPx], [theirs.width, theirs.height]);
});

test("a page named with no board to find it on is refused", async () => {
  const { db } = fakeDb([photo("a")]);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "a page of its own",
    pageId: "page-2",
    referenceIds: ["a"],
  });

  assert.match(String(result.error), /pass the boardId/);
});

test("a compose asked for a new page adds one to the board and touches nothing on it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c"), photo("d")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([{ blockId: "d", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the exteriors want a page to themselves",
    boardId: "board-7",
    newPage: true,
    referenceIds: ["d"],
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["d"]);
  assert.equal(asked[0]!.inPlace, undefined);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.deepEqual(pages.map((page) => [page.name, page.x]), [
    ["Cold open", 0],
    ["Act two", split.page.width + PAGE_GAP],
    ["Page 3", 2 * (split.page.width + PAGE_GAP)],
  ]);
  const items = boardItems(data.elements as never);
  assert.equal(pageItems(items, pages[0]!).length, 2);
  assert.equal(pageItems(items, pages[1]!).length, 1);
  assert.deepEqual(
    pageItems(items, pages[2]!).map((item) => [item.referenceId, item.clipped]),
    [["d", false]],
  );

  assert.deepEqual(result.page, { pageId: pages[2]!.id, name: "Page 3" });
  assert.match(String(result.status), /new page, “Page 3”/);
  assert.match(String(result.status), /3 pages now/);
});

test("a page named with newPage is the page the new one is put beside, and keeps what it holds", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("d")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
      ]),
    ],
  );
  const { compose } = composing([{ blockId: "d", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "another page like the first",
    boardId: "board-7",
    pageId: "page-1",
    newPage: true,
    referenceIds: ["d"],
  });

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.deepEqual(pages.map((page) => page.name), ["Cold open", "Page 2"]);
  assert.deepEqual(
    pageItems(boardItems(data.elements as never), pages[0]!).map((item) => item.referenceId),
    ["a", "b"],
  );
});

test("a new page asked for with no pictures is refused before the compositor", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "another page",
    boardId: "board-7",
    newPage: true,
  });

  assert.match(String(result.error), /a new page starts empty/);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a new page asked for with no board is refused", async () => {
  const { db } = fakeDb([photo("a")]);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "a page of its own",
    newPage: true,
    referenceIds: ["a"],
  });

  assert.match(String(result.error), /pass the boardId/);
});

test("a compose about a page past the first leaves the board's default page size and template standing", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { compose } = composing([{ blockId: "c", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "make the second page a tall one",
    boardId: "board-7",
    pageId: "page-2",
    layout: "MASONRY",
    referenceIds: ["c"],
  });

  assert.equal(result.layout, "MASONRY");
  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: Record<string, unknown> & { elements: unknown[] };
  };
  assert.deepEqual(
    ["layout", "widthPx", "heightPx"].filter((key) => key in data),
    [],
  );
  assert.deepEqual(
    boardPages(data.elements).map((page) => [page.name, page.width, page.height]),
    [
      ["Cold open", split.page.width, split.page.height],
      ["Act two", 1080, 1920],
    ],
  );
});

test("a compose onto a new page leaves the board's default page size and template standing", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("d")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
      ]),
    ],
  );
  const { compose } = composing([{ blockId: "d", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "the exteriors on a tall page of their own",
    boardId: "board-7",
    newPage: true,
    layout: "MASONRY",
    referenceIds: ["d"],
  });

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: Record<string, unknown> & { elements: unknown[] };
  };
  assert.deepEqual(
    ["layout", "widthPx", "heightPx"].filter((key) => key in data),
    [],
  );
  assert.deepEqual(
    boardPages(data.elements).map((page) => [page.name, page.width]),
    [
      ["Cold open", split.page.width],
      ["Page 2", 1080],
    ],
  );
});

test("a rebuild of the board's first page writes the board's default page size and template", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "the opening as one tall page",
    boardId: "board-7",
    pageId: "page-1",
    layout: "MASONRY",
    referenceIds: ["a"],
  });

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: Record<string, unknown> };
  assert.deepEqual(
    [data.layout, data.widthPx, data.heightPx],
    ["MASONRY", 1080, 1920],
  );
});

test("a page of a spread that outgrows its template is reported as that page changing shape", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c"), photo("d"), photo("e")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { compose } = composing(
    ["c", "d", "e"].map((id, index) => ({ blockId: id, slotId: `img-${index + 1}` })),
  );
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "three shots on the second page",
    boardId: "board-7",
    pageId: "page-2",
    referenceIds: ["c", "d", "e"],
  });

  assert.match(String(result.layoutChanged), /“Act two” was laid out as a TRIPTYCH/);
  assert.match(String(result.layoutChanged), /that page is now a different shape/);
});

test("a resized page outgrowing its template is reported as the arrangement changing, not the page", async () => {
  const split = layoutById("SPLIT")!;
  const theirs = { width: 2400, height: 1200 };
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      board("board-7", [], {
        layout: split.id,
        elements: [
          pageFrame({ x: 0, y: 0, ...theirs }, { name: "Cold open", makeId: () => "page-7" }),
        ] as never,
      }),
    ],
  );
  const { compose } = composing(
    ["a", "b", "c"].map((id, index) => ({ blockId: id, slotId: `img-${index + 1}` })),
  );
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "three shots on it",
    boardId: "board-7",
    referenceIds: ["a", "b", "c"],
  });

  assert.match(String(result.layoutChanged), /“Cold open” was laid out as a TRIPTYCH/);
  assert.match(String(result.layoutChanged), /the arrangement changed, not the page/);
  assert.match(String(result.layoutChanged), /2400×1200/);
});

function handBoard(id: string) {
  return board(id, [], {
    elements: [
      { id: "el-0", type: "image", fileId: "ref:a", x: 0, y: 0, width: 800, height: 600 },
      { id: "el-1", type: "image", fileId: "ref:b", x: 900, y: 0, width: 800, height: 600 },
    ] as never,
  });
}

test("a hand-arranged board with no pages is given one drawn around the pictures on it", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")], [handBoard("board-9")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "add_page", { boardId: "board-9" });

  assert.deepEqual(result.page, {
    pageId: (result.page as { pageId: string }).pageId,
    name: "Page 1",
    position: 1,
    of: 1,
    size: "1920×1080",
    preset: "LANDSCAPE_HD",
  });
  assert.equal(result.drawnAround, 2);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.equal(pages.length, 1);
  assert.equal(pageItems(boardItems(data.elements as never), pages[0]!).length, 2);
  assert.deepEqual(
    (data.elements as { id: string; x?: number; frameId?: string }[])
      .filter((element) => element.id.startsWith("el-"))
      .map(({ x, frameId }) => [x, frameId]),
    [[0, pages[0]!.id], [900, pages[0]!.id]],
  );
});

test("a first page drawn over the user's sections leaves them owning their pictures", async () => {
  const sectioned = board("board-9", [], {
    elements: [
      { id: "sec-1", type: "frame", name: "Act one", x: -20, y: -20, width: 860, height: 660 },
      { id: "el-0", type: "image", fileId: "ref:a", x: 0, y: 0, width: 800, height: 600, frameId: "sec-1" },
      { id: "el-1", type: "image", fileId: "ref:b", x: 900, y: 0, width: 800, height: 600 },
    ] as never,
  });
  const { db, of } = fakeDb([photo("a"), photo("b")], [sectioned]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "add_page", { boardId: "board-9" });

  assert.equal(result.sectionsOnIt, 1);
  assert.match(String(result.sectionsNote), /belong to their section/);
  assert.equal(result.drawnAround, 1);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.deepEqual(
    (data.elements as { id: string; frameId?: string }[])
      .filter((element) => element.id !== pages[0]!.id)
      .map(({ id, frameId }) => [id, frameId]),
    [["sec-1", undefined], ["el-0", "sec-1"], ["el-1", pages[0]!.id]],
  );
  assert.equal(pageItems(boardItems(data.elements as never), pages[0]!).length, 2);
});

test("a board given its first page can then be read scoped to it", async () => {
  const { db } = fakeDb([photo("a"), photo("b")], [handBoard("board-9")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const added = await run(toolset, "add_page", { boardId: "board-9" });
  const pageId = (added.result.page as { pageId: string }).pageId;
  const { result } = await run(toolset, "inspect_board", { boardId: "board-9", pageId });

  assert.deepEqual((result.pictures as { id: string }[]).map((picture) => picture.id), ["a", "b"]);
  assert.equal((result.arrangement as unknown[]).length, 2);
});

test("a page added to a spread lands beside it, empty, with both its pages standing", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "add_page", { boardId: "board-7", name: "The night work" });

  assert.equal((result.page as { name: string }).name, "The night work");
  assert.equal((result.page as { position: number }).position, 3);
  assert.equal("drawnAround" in result, false);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.deepEqual(pages.map((page) => [page.name, page.x]), [
    ["Cold open", 0],
    ["Act two", split.page.width + PAGE_GAP],
    ["The night work", 2 * (split.page.width + PAGE_GAP)],
  ]);
  const items = boardItems(data.elements as never);
  assert.deepEqual(
    pages.map((page) => pageItems(items, page).length),
    [2, 1, 0],
  );
  assert.equal(of("agentRun", "create").length, 0);
});

test("a page added is counted on the board's row in the same write as the scene", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "add_page", { boardId: "board-7" });

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: unknown[]; pageCount: number };
  };
  assert.equal(data.pageCount, 2);
  assert.equal(data.pageCount, boardPages(data.elements).length);
});

test("the brief says a board is a spread without reading its scene", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300]] },
      ]),
      board("board-8", ["a"], { title: "Scraps" }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-7" });

  const brief = await toolset.brief();
  assert.match(brief, /board-7 · Board board-7 · 1920×1080 · SPLIT · 2 pages/);
  assert.equal(brief.includes("board-8"), false);
  assert.match(brief, /The project holds 2 boards\./);

  const select = (of("moodboard", "findMany")[0]!.args as { select: Record<string, unknown> })
    .select;
  assert.equal("elements" in select, false);
});

test("the brief says what a spread's pages are called", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Exteriors", placed: [["b", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-7" });

  const brief = await toolset.brief();
  assert.match(brief, /2 pages: “Cold open”, “Exteriors”/);
});

test("a page added is named on the board's row in the same write as the scene", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "add_page", { boardId: "board-7", name: "Exteriors" });

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: unknown[]; pageNames: string[] };
  };
  assert.deepEqual(data.pageNames, ["Cold open", "Exteriors"]);
  assert.deepEqual(
    data.pageNames,
    pagesInReadingOrder(boardPages(data.elements)).map((page) => page.name),
  );
});

test("a page asked for beside a page the board has not got is refused with the ones it has", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "add_page", { boardId: "board-7", pageId: "page-9" });

  assert.match(String(result.error), /no page called page-9/);
  assert.deepEqual((result.pages as { pageId: string }[]).map((page) => page.pageId), ["page-1"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("duplicate_page copies one page of a spread beside it and leaves the board's pages standing", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        {
          id: "page-2",
          name: "Act two",
          placed: [["b", "img-1", 400, 300], ["c", "img-2", 400, 300]],
          lines: ["ACT TWO"],
        },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "duplicate_page", {
    boardId: "board-7",
    pageId: "page-2",
  });

  assert.equal(of("agentRun", "create").length, 0);
  assert.deepEqual(result.copyOfPage, { pageId: "page-2", name: "Act two" });
  assert.deepEqual(result.pictures, ["b", "c"]);
  assert.deepEqual(result.lines, ["ACT TWO"]);
  const page = result.page as { pageId: string; position: number; of: number; preset: string };
  assert.equal(page.position, 3);
  assert.equal(page.of, 3);
  assert.equal(page.preset, "LANDSCAPE_HD");

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: unknown[]; pageCount: number };
  };
  const pages = boardPages(data.elements);
  assert.deepEqual(pages.map((entry) => [entry.name, entry.x]), [
    ["Cold open", 0],
    ["Act two", split.page.width + PAGE_GAP],
    ["Page 3", 2 * (split.page.width + PAGE_GAP)],
  ]);
  const items = boardItems(data.elements as never);
  assert.deepEqual(
    pages.map((entry) => pageItems(items, entry).map((item) => item.referenceId ?? item.text)),
    [["a"], ["b", "c", "ACT TWO"], ["b", "c", "ACT TWO"]],
  );
  assert.deepEqual(
    pages.map((entry) =>
      pageItems(items, entry).map((item) => [item.x - entry.x, item.y - entry.y]),
    )[2],
    pages.map((entry) =>
      pageItems(items, entry).map((item) => [item.x - entry.x, item.y - entry.y]),
    )[1],
  );
  assert.equal(data.pageCount, 3);

  const [attachment] = attachments ?? [];
  assert.match(String(attachment?.kind === "board" && attachment.caption), /“Page 3”, page 3 of 3/);
  assert.equal(attachment?.kind === "board" && attachment.images, 2);
  assert.match(String(result.status), /Make the change they asked for on this page/);
});

test("a copied page carries no id the board already had", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]], lines: ["COLD OPEN"] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "duplicate_page", { boardId: "board-7", pageId: "page-1", name: "Cold open, tall" });

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: { id: string }[] } };
  const ids = data.elements.map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    boardPages(data.elements).map((page) => page.name),
    ["Cold open", "Cold open, tall"],
  );
});

test("a page asked to be copied that the board has not got is refused with the ones it has", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "duplicate_page", { boardId: "board-7", pageId: "page-9" });

  assert.match(String(result.error), /no page called page-9/);
  assert.deepEqual((result.pages as { pageId: string }[]).map((page) => page.pageId), ["page-1"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a board with no pages is told what to call instead of duplicate_page", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")], [handBoard("board-9")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "duplicate_page", { boardId: "board-9", pageId: "page-1" });

  assert.equal("pages" in result, false);
  assert.match(String(result.pagesNote), /add_page/);
  assert.match(String(result.pagesNote), /duplicate_board/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("resize_page turns one page of a spread portrait and moves nothing on it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        {
          id: "page-2",
          name: "Act two",
          placed: [["b", "img-1", 400, 300], ["c", "img-2", 400, 300]],
        },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "resize_page", {
    boardId: "board-7",
    pageId: "page-2",
    preset: "PORTRAIT_HD",
  });

  assert.equal(of("agentRun", "create").length, 0);
  assert.deepEqual(result.page, {
    pageId: "page-2",
    name: "Act two",
    position: 2,
    of: 2,
    size: "1080×1920",
    preset: "PORTRAIT_HD",
  });
  assert.equal(result.was, "1920×1080");

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: unknown[]; widthPx?: number; heightPx?: number };
  };
  const pages = boardPages(data.elements);
  assert.deepEqual(
    pages.map((page) => [page.name, page.x, page.width, page.height]),
    [
      ["Cold open", 0, split.page.width, split.page.height],
      ["Act two", split.page.width + PAGE_GAP, 1080, 1920],
    ],
    "the top-left corner is the anchor and the board's other page is untouched",
  );
  assert.deepEqual(["widthPx", "heightPx"].filter((key) => key in data), []);

  assert.deepEqual(result.fellOffPage, ["c"]);
  assert.match(String(result.fellOffPageNote), /still on the board exactly where they were/);
  assert.equal("joinedPage" in result, false);
  assert.deepEqual(
    boardItems(data.elements as never).find((item) => item.referenceId === "c"),
    boardItems(spreadBoard("board-7", split, [
      { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
      { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300], ["c", "img-2", 400, 300]] },
    ]).elements as never).find((item) => item.referenceId === "c"),
  );
  assert.match(String(result.layoutNote), /standing exactly as SPLIT composed it/);
  assert.doesNotMatch(String(result.layoutNote), /offer to lay that page out again/);
  assert.match(String(result.layoutNote), /do not design it again without asking/);

  const [attachment] = attachments ?? [];
  assert.match(String(attachment?.kind === "board" && attachment.caption), /“Act two”, page 2 of 2/);
  assert.match(String(result.status), /is 1080×1920 now and nothing on it moved/);
});

test("resizing the board's first page takes the board's default page size with it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "resize_page", { boardId: "board-7", pageId: "page-1", preset: "SQUARE" });

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { widthPx?: number; heightPx?: number; layout?: string };
  };
  assert.deepEqual([data.widthPx, data.heightPx], [2048, 2048]);
  assert.equal("layout" in data, false);
});

test("a page made larger reports what it took in, and owns it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
      ]),
    ],
  );
  const board = (await db.moodboard.findFirst({ where: { id: "board-7" } })) as unknown as {
    elements: Record<string, unknown>[];
  };
  board.elements.unshift({
    id: "loose-1",
    type: "image",
    fileId: "ref:b",
    x: 200,
    y: 1300,
    width: 400,
    height: 300,
  });
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "resize_page", {
    boardId: "board-7",
    pageId: "page-1",
    preset: "SQUARE",
  });

  assert.deepEqual(result.joinedPage, ["b"]);
  assert.match(String(result.joinedPageNote), /nothing moved/);
  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: { id: string; frameId?: string | null }[] };
  };
  assert.equal(data.elements.find((element) => element.id === "loose-1")?.frameId, "page-1");
  assert.deepEqual(
    data.elements.map((element) => element.id).slice(-3),
    ["loose-1", "page-1-el-0", "page-1"],
    "excalidraw's children-immediately-before-the-frame invariant",
  );
});

test("a page already at the shape asked for is left alone and said so", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "resize_page", {
    boardId: "board-7",
    pageId: "page-1",
    preset: "LANDSCAPE_HD",
  });

  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.match(String(result.status), /already 1920×1080/);
  assert.equal("error" in result, false);
});

test("resize_page refuses a page the board has not got, and a shape that is not one", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const missing = await run(toolset, "resize_page", {
    boardId: "board-7",
    pageId: "page-9",
    preset: "SQUARE",
  });
  assert.match(String(missing.result.error), /no page called page-9/);
  assert.deepEqual((missing.result.pages as { pageId: string }[]).map((page) => page.pageId), [
    "page-1",
  ]);

  const shapeless = await run(toolset, "resize_page", {
    boardId: "board-7",
    pageId: "page-1",
    preset: "A4",
  });
  assert.match(String(shapeless.result.error), /A4 is not a page shape/);
  assert.match(String(shapeless.result.error), /LANDSCAPE_HD, PORTRAIT_HD, SQUARE/);
  assert.match(String(shapeless.result.presetsNote), /the user's own to drag on the canvas/);

  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("set_page_background paints one page and moves nothing on it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });
  const before = boardItems(
    (await db.moodboard.findFirst({ where: { id: "board-7" } }))!.elements as never,
  );

  const { result } = await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-2",
    colour: "#0C111C",
  });

  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(result.background, "#0c111c");
  assert.equal("was" in result, false);
  assert.match(String(result.status), /nothing on it moved/);
  assert.match(String(result.status), /unreadable against the new one/);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  const painted = pages.find((page) => page.id === "page-2")!;
  assert.equal(pageBackgroundColour(data.elements as never, painted), "#0c111c");
  assert.equal(pageBackgroundColour(data.elements as never, pages[0]!), null);

  assert.deepEqual(boardItems(data.elements as never), before);

  const ground = (data.elements as { id: string }[]).find((element) =>
    isPageBackground(element),
  ) as { locked?: boolean; frameId?: string } | undefined;
  assert.equal(ground?.locked, true);
  assert.equal(ground?.frameId, "page-2");
});

test("set_page_background repaints rather than stacking, and none takes the ground off", async () => {
  const split = layoutById("SPLIT")!;
  const board = () =>
    spreadBoard("board-7", split, [
      { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
    ]);
  const { db, of } = fakeDb([photo("a")], [board()]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-1",
    colour: "#f4efe6",
  });
  const repaint = await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-1",
    colour: "#0c111c",
  });

  assert.equal(repaint.result.was, "#f4efe6");
  assert.equal(repaint.result.background, "#0c111c");
  const painted = of("moodboard", "updateMany")[1]!.args as { data: { elements: unknown[] } };
  assert.equal(painted.data.elements.filter((element) => isPageBackground(element)).length, 1);

  const cleared = await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-1",
    colour: "none",
  });
  assert.equal(cleared.result.background, null);
  assert.equal(cleared.result.was, "#0c111c");
  const dropped = of("moodboard", "updateMany")[2]!.args as { data: { elements: unknown[] } };
  assert.equal(dropped.data.elements.filter((element) => isPageBackground(element)).length, 0);
});

test("set_page_background writes nothing for the colour a page already stands on", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [spreadBoard("board-7", split, [{ id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] }])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-1",
    colour: "#0c111c",
  });
  const again = await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-1",
    colour: "#0C111C",
  });
  const cleared = await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-2",
    colour: "none",
  });

  assert.equal(of("moodboard", "updateMany").length, 1);
  assert.match(String(again.result.status), /already #0c111c/);
  assert.equal("error" in again.result, false);
  assert.match(String(cleared.result.error), /no page called page-2/);
});

test("set_page_background refuses a colour that is not one, and a board with no pages", async () => {
  const { db, of } = fakeDb(
    [photo("a")],
    [
      spreadBoard("board-7", layoutById("SPLIT")!, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
      ]),
      handBoard("board-9"),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const unreadable = await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-1",
    colour: "warm sand",
  });
  assert.match(String(unreadable.result.error), /“warm sand” is not a colour/);
  assert.match(String(unreadable.result.error), /"none"/);

  const flat = await run(toolset, "set_page_background", {
    boardId: "board-9",
    pageId: "page-1",
    colour: "#0c111c",
  });
  assert.equal("pages" in flat.result, false);
  assert.match(String(flat.result.pagesNote), /a board's own colour is not this call's to change/);
  assert.match(String(flat.result.pagesNote), /add_page/);

  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("set_canvas_background paints the desk and writes no element of it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "#0C111C",
  });

  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(result.background, "#0c111c");
  assert.equal("was" in result, false);
  assert.match(String(result.status), /nothing on it moved/);

  const { where, data } = of("moodboard", "updateMany")[0]!.args as {
    where: { revision: number };
    data: Record<string, unknown>;
  };
  assert.equal(where.revision, 3);
  assert.equal(data.renderRevision, null);
  assert.equal((data.appState as { viewBackgroundColor: string }).viewBackgroundColor, "#0c111c");
  for (const column of ["elements", "pageCount", "pageNames"]) {
    assert.equal(column in data, false, `${column} is not this call's to write`);
  }

  assert.deepEqual(attachments ?? [], []);
});

test("set_canvas_background counts the pages that stand on a colour of their own", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const none = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "#0c111c",
  });
  assert.match(String(none.result.status), /all 2 of its pages are drawn on/);

  await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-1",
    colour: "#f4efe6",
  });
  const one = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "#2b2b2b",
  });
  assert.match(String(one.result.status), /1 of its 2 pages stand on a colour of their own/);

  await run(toolset, "set_page_background", {
    boardId: "board-7",
    pageId: "page-2",
    colour: "#f4efe6",
  });
  const all = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "#111111",
  });
  assert.match(String(all.result.status), /all 2 of its pages stand on colours of their own/);
  assert.match(String(all.result.status), /shows around them rather than on them/);
});

test("set_canvas_background writes nothing for the colour a board is already drawn on", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const untouched = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "default",
  });
  const white = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "#ffffff",
  });
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.match(String(untouched.result.status), /already on the white it was made on/);
  assert.match(String(white.result.status), /already drawn on #ffffff/);

  await run(toolset, "set_canvas_background", { boardId: "board-7", colour: "#0c111c" });
  const again = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "#0C111C",
  });
  assert.equal(of("moodboard", "updateMany").length, 1);
  assert.match(String(again.result.status), /already drawn on #0c111c/);
  assert.equal("error" in again.result, false);

  const back = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "default",
  });
  assert.equal(back.result.was, "#0c111c");
  assert.equal(back.result.background, null);
  const cleared = of("moodboard", "updateMany")[1]!.args as {
    data: { appState: Record<string, unknown> };
  };
  assert.equal("viewBackgroundColor" in cleared.data.appState, false);
});

test("set_canvas_background refuses a colour that is not one, and a board it was not given", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const unreadable = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "warm sand",
  });
  assert.match(String(unreadable.result.error), /“warm sand” is not a colour/);
  assert.match(String(unreadable.result.error), /"default"/);

  const missing = await run(toolset, "set_canvas_background", {
    boardId: "board-9",
    colour: "#0c111c",
  });
  assert.match(String(missing.result.error), /no board called board-9 in this project/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a board saved by the user mid-repaint is refused rather than overwritten", async () => {
  const row = arranged("board-7", [["a", 0, 0]]);
  const { db } = fakeDb([photo("a")], [row]);
  const read = db.moodboard.findFirst;
  db.moodboard.findFirst = (async (args: never) => {
    const board = await read(args);
    row.revision = 4;
    return board;
  }) as typeof db.moodboard.findFirst;
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "set_canvas_background", {
    boardId: "board-7",
    colour: "#0c111c",
  });

  assert.match(String(result.error), /changed while I was painting it/);
});

test("a board asked for with a headline is composed on a template that can carry it", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { asked, compose } = composing([
    { blockId: "caption-1", slotId: "text-1" },
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "first light",
    referenceIds: ["a", "b"],
    captions: ["Dawn on the ridge"],
  });

  assert.equal(result.unplaced, undefined);
  assert.ok(asked[0]!.layout.slots.some((slot) => slot.kind === "text"));

  const data = (of("moodboard", "create")[0]!.args as {
    data: { layout: string; elements: { type: string }[] };
  }).data;
  assert.ok(["POLAROID_SCATTER", "HERO_LEFT"].includes(data.layout));
  assert.equal(data.elements.filter((element) => element.type === "text").length, 1);
  assert.equal(data.elements.filter((element) => element.type === "image").length, 2);
});

test("a board composed out of pictures nobody has read yet says which they were", async () => {
  const { db } = fakeDb(
    [photo("a"), photo("b", { analysis: null })],
    [],
    [{ input: { referenceId: "b" }, status: "QUEUED" }],
  );
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the two ridges",
    referenceIds: ["a", "b"],
  });

  assert.deepEqual(result.notReadYet, ["b"]);
  assert.match(String(result.notReadYetNote), /arranged on shape alone/);
  assert.equal(result.boardId, "board-1");
  assert.deepEqual(
    asked[0]!.blocks.map((block) => block.tags),
    [["Golden_hour", "Landscape"], undefined],
  );
});

test("a board of pictures that have all been read says nothing about the analyzer", async () => {
  const { db } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the two ridges",
    referenceIds: ["a", "b"],
  });

  assert.equal(result.notReadYet, undefined);
  assert.equal(result.notReadYetNote, undefined);
});

test("a caption per photograph composes the photographs and names the lines left off", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")]);
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "three of the ridge",
    referenceIds: ["a", "b", "c"],
    captions: ["Dawn", "Noon", "Dusk"],
  });

  assert.deepEqual(
    asked[0]!.blocks.filter((block) => block.kind === "image").map((block) => block.id),
    ["a", "b", "c"],
  );
  assert.equal(asked[0]!.blocks.filter((block) => block.kind === "text").length, 2);
  assert.deepEqual(result.linesNotOffered, ["Dusk"]);
  assert.ok(typeof result.linesNotOfferedNote === "string");

  const data = (of("moodboard", "create")[0]!.args as {
    data: { elements: { type: string }[] };
  }).data;
  assert.equal(data.elements.filter((element) => element.type === "image").length, 3);
});

test("a headline composed at a template with no text block is reported as having no room", async () => {
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the backlit dawn look",
    referenceIds: ["a", "b", "c"],
    captions: ["Backlit dawn"],
    layout: "TRIPTYCH",
  });

  assert.deepEqual(result.linesWithNoRoom, ["Backlit dawn"]);
  assert.match(String(result.linesWithNoRoomNote), /TRIPTYCH has no text block/);
  assert.equal(result.linesNotOffered, undefined);
});

test("a headline composed at a template that carries text is not reported at all", async () => {
  const { db } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "caption-1", slotId: "text-1" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the backlit dawn look",
    referenceIds: ["a", "b"],
    captions: ["Backlit dawn"],
    layout: "POLAROID_SCATTER",
  });

  assert.equal(result.linesWithNoRoom, undefined);
  assert.equal(result.linesWithNoRoomNote, undefined);
});

test("a composed board is attached as the arrangement, at the page's own shape", async () => {
  const { db } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "b", slotId: "img-1" },
    { blockId: "a", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { attachments } = await run(toolset, "compose_moodboard", {
    intention: "the light before a storm",
    referenceIds: ["a", "b"],
  });

  const [attachment] = attachments ?? [];
  assert.ok(attachment?.kind === "board" && attachment.preview);
  const preview = attachment.preview;
  assert.equal(preview.aspectRatio, 1920 / 1080);

  assert.deepEqual(
    preview.items.map((item) => item.thumbUrl),
    ["/api/references/b/image?variant=thumb", "/api/references/a/image?variant=thumb"],
  );
  assert.ok(preview.items[0]!.left < preview.items[1]!.left);

  assert.ok(preview.items.every((item) => item.height < 100 && item.kind === "image"));
});

test("compose_moodboard writes a compositor run row carrying what the board cost", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", { intention: "dusk", referenceIds: ["a", "b"] });

  const [created] = of("agentRun", "create");
  const opened = (created!.args as { data: { agent: string; input: { blocks: string[] } } }).data;
  assert.equal(opened.agent, "COMPOSITOR");
  assert.deepEqual(opened.input.blocks, ["a", "b"]);

  const [finished] = of("agentRun", "update");
  assert.equal((finished!.args as { data: { status: string } }).data.status, "SUCCEEDED");
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...COMPOSE_USAGE });
});

test("a compositor that throws is a failed run, not a thrown tool", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const compose = (async () => {
    throw new Error("compositor returned no content");
  }) as never;
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", { intention: "dusk", referenceIds: ["a"] });
  assert.equal(result.error, "compositor returned no content");
  assert.equal(of("moodboard", "create").length, 0);
  assert.equal((of("agentRun", "update")[0]!.args as { data: { status: string } }).data.status, "FAILED");
});

test("captions ride along as text blocks and are what a text slot may take", async () => {
  const { db } = fakeDb([photo("a"), photo("b"), photo("c"), photo("d"), photo("e")]);
  const { asked, compose } = composing([{ blockId: "caption-1", slotId: "text-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: ["a", "b", "c", "d", "e"],
    captions: ["Dusk, exteriors"],
    layout: "HERO_LEFT",
  });

  const blocks = asked[0]!.blocks;
  assert.deepEqual(blocks[0], { id: "caption-1", kind: "text", text: "Dusk, exteriors" });
  assert.equal(blocks.filter((block) => block.kind === "image").length, 5);
});

test("a board of ids this project does not hold is refused without a model call", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: ["x", "y"],
  });
  assert.match(String(result.error), /none of those reference ids/);
  assert.deepEqual(result.notFound, ["x", "y"]);
  assert.equal(asked.length, 0);
  assert.equal(of("moodboard", "create").length, 0);
});

test("a rebuild lays out the pictures the board already holds, in place", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")], [board("board-7", ["a", "b"])]);
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "make it a diptych",
    boardId: "board-7",
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["a", "b"]);
  assert.equal(result.boardId, "board-7");
  assert.match(String(result.status), /^rebuilt/);
  assert.equal(of("moodboard", "create").length, 0);
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");

  const [written] = of("moodboard", "updateMany");
  const { where, data } = written!.args as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  assert.deepEqual(where, { id: "board-7", revision: 3 });
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal((data.elements as unknown[]).length, 3);
});

test("a picture added to a board joins the ones already on it without moving them", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [composedBoard("board-7", strip, [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]])],
  );
  const { asked, compose } = composing([{ blockId: "c", slotId: "img-3" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add the third one",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["c"]);
  assert.deepEqual(asked[0]!.layout.slots.map((slot) => slot.id), ["img-3", "img-4"]);
  assert.deepEqual(asked[0]!.inPlace!.map((entry) => [entry.slotId, entry.id]), [
    ["img-1", "a"],
    ["img-2", "b"],
  ]);
  assert.deepEqual(result.added, ["c"]);
  assert.equal(result.keptTheirSlots, 2);
  assert.equal(result.removed, undefined);
  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: { fileId: string; x: number; y: number }[] };
  };
  assert.equal(data.elements.length, 4);
  const was = composedBoard("board-7", strip, [
    ["a", "img-1", 400, 300],
    ["b", "img-2", 400, 300],
  ]).elements as { fileId?: string; x?: number; y?: number }[];
  for (const before of was) {
    const after = data.elements.find((element) => element.fileId === before.fileId)!;
    assert.deepEqual([after.x, after.y], [before.x, before.y]);
  }
});

test("a picture taken off a composed board costs no model call and moves nothing", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      composedBoard("board-7", strip, [
        ["a", "img-1", 400, 300],
        ["b", "img-2", 400, 300],
        ["c", "img-3", 400, 300],
      ]),
    ],
  );
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "drop the middle one",
    boardId: "board-7",
    removeReferenceIds: ["b", "z"],
  });

  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.deepEqual(result.removed, ["b"]);
  assert.deepEqual(result.notOnBoard, ["z"]);
  assert.equal(result.keptTheirSlots, 2);
  assert.match(String(result.status), /no model call was made/);

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: {
      elements: { type: string; fileId: string; x: number }[];
      revision: unknown;
      renderRevision: unknown;
    };
  };
  assert.deepEqual(
    data.elements.filter((element) => element.type === "image").map((element) => element.fileId),
    ["ref:a", "ref:c"],
  );
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  const was = composedBoard("board-7", strip, [["c", "img-3", 400, 300]])
    .elements[0] as { x?: number };
  assert.equal(data.elements[1]!.x, was.x);
});

test("a rebuild that names no change still lays the whole board out again", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [composedBoard("board-7", strip, [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]])],
  );
  const { asked, compose } = composing([
    { blockId: "b", slotId: "img-1" },
    { blockId: "a", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "put the darker one first",
    boardId: "board-7",
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["a", "b"]);
  assert.deepEqual(asked[0]!.layout.slots.map((slot) => slot.id), strip.slots.map((slot) => slot.id));
  assert.equal(asked[0]!.inPlace, undefined);
  assert.equal(result.keptTheirSlots, undefined);
  assert.deepEqual(result.placed, [
    { slotId: "img-1", blockId: "b" },
    { slotId: "img-2", blockId: "a" },
  ]);
});

test("a board that outgrows its template is laid out again in full", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c"), photo("d"), photo("e")],
    [
      composedBoard("board-7", strip, [
        ["a", "img-1", 400, 300],
        ["b", "img-2", 400, 300],
        ["c", "img-3", 400, 300],
        ["d", "img-4", 400, 300],
      ]),
    ],
  );
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
    { blockId: "d", slotId: "img-4" },
    { blockId: "e", slotId: "img-5" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "one more",
    boardId: "board-7",
    addReferenceIds: ["e"],
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["a", "b", "c", "d", "e"]);
  assert.equal(asked[0]!.inPlace, undefined);
  assert.equal(result.keptTheirSlots, undefined);
  assert.match(String(result.layoutChanged), /could not hold/);
});

test("a headline added to a composed board leaves every picture in its slot", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const placed = hero.slots
    .filter((slot) => slot.kind === "image")
    .map((slot, index) => [`p${index}`, slot.id, 400, 300] as [string, string, number, number]);
  const { db, of } = fakeDb(
    placed.map(([id]) => photo(id)),
    [composedBoard("board-7", hero, placed)],
  );
  const { asked, compose } = composing([{ blockId: "caption-1", slotId: "text-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "give it a title",
    boardId: "board-7",
    addCaptions: ["Act two"],
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["caption-1"]);
  assert.deepEqual(asked[0]!.layout.slots.map((slot) => slot.id), ["text-1"]);
  assert.equal(asked[0]!.inPlace!.length, placed.length);
  assert.deepEqual(result.linesAdded, ["Act two"]);
  assert.equal(result.keptTheirSlots, placed.length);

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: { type: string; text?: string }[] };
  };
  assert.equal(data.elements.length, placed.length + 2);
  assert.equal(data.elements.at(-1)!.type, "frame");
  assert.equal(data.elements.at(-2)!.text, "Act two");
});

test("adding a picture a composed board already holds writes nothing at all", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [composedBoard("board-7", strip, [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]])],
  );
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "put the sunset on it",
    boardId: "board-7",
    addReferenceIds: ["b"],
  });

  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.deepEqual(result.alreadyOnBoard, ["b"]);
  assert.match(String(result.status), /nothing changed/);
});

test("a third line asked of a board that holds two is named as not gone on", async () => {
  const spread = layoutById("EDITORIAL_SPREAD")!;
  const lines = spread.slots.filter((slot) => slot.kind === "text");
  const composed = composedBoard("board-7", spread, [["a", "img-1", 400, 300]]);
  composed.elements = [
    ...(composed.elements as unknown as Record<string, unknown>[]),
    ...lines.map((slot, index) => ({
      id: `txt-${index}`,
      type: "text",
      text: `Act ${index + 1}`,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: 48,
    })),
  ] as never;

  const { db, of } = fakeDb([photo("a")], [composed]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "give it a third line",
    boardId: "board-7",
    addCaptions: ["Act 3"],
  });

  assert.equal(asked.length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.deepEqual(result.linesNotOffered, ["Act 3"]);
  assert.match(String(result.status), /did not go on it/);
});

test("emptying a board is refused before the model call", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "take that off",
    boardId: "board-7",
    removeReferenceIds: ["a"],
  });

  assert.match(String(result.error), /every picture off the board/);
  assert.equal(asked.length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a picture put on a board the user arranged by hand joins it without a compose", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [lettered("board-7", ["a", "b"], ["Act two exteriors"])],
  );
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "put the third one on as well",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.deepEqual(result.added, ["c"]);
  assert.match(String(result.status), /scene edit/);
  assert.match(String(result.status), /not laid out again/);

  const [written] = of("moodboard", "updateMany");
  const { where, data } = written!.args as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  assert.deepEqual(where, { id: "board-7", revision: 3 });
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);
  assert.equal(data.widthPx, undefined);
  assert.equal(data.title, undefined);

  const elements = data.elements as { id: string; fileId?: string; y?: number }[];
  assert.deepEqual(elements.slice(0, 3).map((element) => element.id), ["el-0", "el-1", "txt-0"]);
  assert.equal(elements[3]!.fileId, "ref:c");
  assert.ok(elements[3]!.y! >= 548);
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");
});

test("a picture taken off a hand-arranged board leaves the rest exactly where they were", async () => {
  const fixture = lettered("board-7", ["a", "b"], ["Act two exteriors"]);
  const kept = [fixture.elements[1], fixture.elements[2]];
  const { db, of } = fakeDb([photo("a"), photo("b")], [fixture]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "drop the first one",
    boardId: "board-7",
    removeReferenceIds: ["a", "z"],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.removed, ["a"]);
  assert.deepEqual(result.notOnBoard, ["z"]);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(data.elements, kept);
});

test("a composed board with a picture dragged out of place takes the edit in place", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const dragged = composedBoard("board-7", strip, [
    ["a", "img-1", 400, 300],
    ["b", "img-2", 400, 300],
  ]);
  dragged.elements[1] = { ...dragged.elements[1]!, x: 40, y: 900 } as never;
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")], [dragged]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add the third",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.added, ["c"]);
  assert.equal((of("moodboard", "updateMany")[0]!.args as { data: { layout?: string } }).data.layout, undefined);
});

test("a composed board carrying a colour block takes the edit in place", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const painted = composedBoard("board-7", strip, [
    ["a", "img-1", 400, 300],
    ["b", "img-2", 400, 300],
  ]);
  painted.elements = [
    { id: "ground", type: "rectangle", x: 0, y: 0, width: 400, height: 300, backgroundColor: "#0c111c" },
    ...painted.elements,
  ] as never;
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")], [painted]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add the third",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.added, ["c"]);
});

test("the same board with nothing drawn on it is still laid out again", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [composedBoard("board-7", strip, [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]])],
  );
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "add the third",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.equal(asked.length, 1);
});

test("an arrow on a composed board does not route it away from the rebuild", async () => {
  const strip = layoutById("FILMSTRIP")!;
  const marked = composedBoard("board-7", strip, [
    ["a", "img-1", 400, 300],
    ["b", "img-2", 400, 300],
  ]);
  marked.elements = [
    ...marked.elements,
    { id: "note", type: "arrow", x: 40, y: 40, width: 200, height: 0 },
  ] as never;
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")], [marked]);
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "add the third",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.equal(asked.length, 1);
});

test("emptying a hand-arranged board is refused before the write", async () => {
  const { db, of } = fakeDb([photo("a")], [lettered("board-7", ["a"], ["Act two"])]);
  const { compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "take that off",
    boardId: "board-7",
    removeReferenceIds: ["a"],
  });

  assert.match(String(result.error), /every picture off the board/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

function draggedSpread() {
  const split = layoutById("SPLIT")!;
  const spread = spreadBoard("board-7", split, [
    { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
    { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
  ]);
  const index = spread.elements.findIndex((element) => element.id === "page-2-el-0");
  spread.elements[index] = {
    ...spread.elements[index]!,
    x: split.page.width + PAGE_GAP + 80,
    y: 700,
  } as never;
  return { spread, page: { x: split.page.width + PAGE_GAP, width: split.page.width, height: split.page.height } };
}

test("a page named in the same call that puts a picture on it is renamed by it", async () => {
  const { spread } = draggedSpread();
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c"), photo("d")], [spread]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "put the doorway on the second page and call it act two",
    boardId: "board-7",
    pageId: "page-2",
    pageName: "Act two, exteriors",
    addReferenceIds: ["d"],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two, exteriors" });
  assert.equal(of("moodboard", "updateMany").length, 1);
  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(
    boardPages(data.elements).map((page) => page.name),
    ["Cold open", "Act two, exteriors"],
  );
  assert.match(String(result.status), /scene edit on “Act two, exteriors”/);
});

test("a picture put on a page of a hand-arranged spread lands on that page", async () => {
  const { spread, page } = draggedSpread();
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c"), photo("d")], [spread]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "put the doorway on the second page too",
    boardId: "board-7",
    pageId: "page-2",
    addReferenceIds: ["d"],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.added, ["d"]);
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  assert.match(String(result.status), /scene edit on “Act two”/);
  assert.match(String(result.status), /untouched/);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const elements = data.elements as {
    id: string;
    fileId?: string;
    frameId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];

  const joined = elements.find((element) => element.fileId === "ref:d")!;
  assert.equal(joined.frameId, "page-2");
  assert.ok(joined.x >= page.x && joined.x + joined.width <= page.x + page.width);
  assert.ok(joined.y >= 0 && joined.y + joined.height <= page.height);
  assert.deepEqual(
    elements.map((element) => element.id).slice(-2),
    [joined.id, "page-2"],
  );
  assert.deepEqual(
    elements.slice(0, 3).map((element) => element.id),
    ["page-1-el-0", "page-1-el-1", "page-1"],
  );
});

test("a picture on the spread's other page is not this page's to take off", async () => {
  const { spread } = draggedSpread();
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")], [spread]);
  const { compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "drop the rooftop from the second page",
    boardId: "board-7",
    pageId: "page-2",
    removeReferenceIds: ["a"],
  });

  assert.match(String(result.error), /nothing on “Act two” changed/);
  assert.deepEqual(result.notOnBoard, ["a"]);
  assert.match(String(result.notOnBoardNote), /another page/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("emptying a page of a hand-arranged spread is refused before the write", async () => {
  const { spread } = draggedSpread();
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")], [spread]);
  const { compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "clear the second page",
    boardId: "board-7",
    pageId: "page-2",
    removeReferenceIds: ["c"],
  });

  assert.match(String(result.error), /every picture off “Act two”/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a line put on a board the user arranged by hand is set above it without a compose", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")], [lettered("board-7", ["a", "b"], [])]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "put a headline on it",
    boardId: "board-7",
    addCaptions: ["Act two"],
  });

  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.deepEqual(result.linesAdded, ["Act two"]);
  assert.match(String(result.status), /scene edit/);

  const { where, data } = of("moodboard", "updateMany")[0]!.args as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  assert.deepEqual(where, { id: "board-7", revision: 3 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);

  const elements = data.elements as { id: string; type: string; text?: string; y?: number }[];
  assert.deepEqual(elements.slice(0, 2).map((element) => element.id), ["el-0", "el-1"]);
  assert.equal(elements[2]!.text, "Act two");
  assert.ok(elements[2]!.y! < 0);
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");
});

test("a line taken off a hand-arranged board goes without the pictures moving", async () => {
  const fixture = lettered("board-7", ["a", "b"], ["Act two exteriors", "Dusk"]);
  const { db, of } = fakeDb([photo("a"), photo("b")], [fixture]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "drop the second line",
    boardId: "board-7",
    removeCaptions: ["  dusk "],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.linesRemoved, ["dusk"]);
  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(data.elements, [
    fixture.elements[0],
    fixture.elements[1],
    fixture.elements[2],
  ]);
});

test("a picture and a line changed in one call are one scene edit", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [lettered("board-7", ["a", "b"], ["Act one"])],
  );
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add the third and retitle it",
    boardId: "board-7",
    addReferenceIds: ["c"],
    addCaptions: ["Act two"],
    removeCaptions: ["Act one"],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.added, ["c"]);
  assert.deepEqual(result.linesAdded, ["Act two"]);
  assert.deepEqual(result.linesRemoved, ["Act one"]);
  assert.equal(of("moodboard", "updateMany").length, 1);
});

test("a wording the hand-arranged board does not carry is named rather than acted on", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")], [lettered("board-7", ["a", "b"], ["Act one"])]);
  const { compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "take that line off",
    boardId: "board-7",
    removeCaptions: ["Act three"],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  assert.deepEqual(result.linesNotOnBoard, ["Act three"]);
  assert.match(String(result.linesNotOnBoardNote), /inspect_board/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a line added to a board standing in its template still rebuilds it", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [composedBoard("board-7", split, [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]])],
  );
  const { asked, compose } = composing([
    { blockId: "caption-1", slotId: "text-1" },
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "give it a headline",
    boardId: "board-7",
    addCaptions: ["Act two"],
  });

  assert.equal(asked.length, 1);
});

test("a picture from outside the project is named rather than placed", async () => {
  const { db, of } = fakeDb([photo("a")], [lettered("board-7", ["a"], [])]);
  const { compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add it",
    boardId: "board-7",
    addReferenceIds: ["x"],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  assert.deepEqual(result.notInThisProject, ["x"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("an autosave landing mid-edit takes the board rather than losing it", async () => {
  const fixture = lettered("board-7", ["a"], []);
  const { db } = fakeDb([photo("a"), photo("b")], [fixture]);
  const { compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const moodboard = (db as unknown as { moodboard: { findFirst: (a: unknown) => Promise<unknown> } })
    .moodboard;
  const read = moodboard.findFirst;
  moodboard.findFirst = async (args: unknown) => {
    const row = await read(args);
    fixture.revision += 1;
    return row;
  };

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add it",
    boardId: "board-7",
    addReferenceIds: ["b"],
  });

  assert.match(String(result.error), /changed while I was editing it/);
});

function lettered(id: string, referenceIds: readonly string[], lines: readonly string[]) {
  return board(id, referenceIds, {
    elements: [
      ...referenceIds.map((referenceId, index) => ({
        id: `el-${index}`,
        type: "image",
        fileId: `ref:${referenceId}`,
        x: index * 500,
        y: 0,
        width: 400,
        height: 300,
      })),
      ...lines.map((text, index) => ({
        id: `txt-${index}`,
        type: "text",
        text,
        x: 0,
        y: 500 + index * 60,
        width: 900,
        height: 48,
      })),
    ] as never,
  });
}

test("a rebuild keeps the lines the board carries when the call names none", async () => {
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [lettered("board-7", ["a", "b"], ["Act two exteriors"])],
  );
  const { asked, compose } = composing([
    { blockId: "caption-1", slotId: "text-1" },
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add the third one",
    boardId: "board-7",
    addReferenceIds: ["c"],
    layout: "HERO_LEFT",
  });

  assert.deepEqual(asked[0]!.blocks[0], { id: "caption-1", kind: "text", text: "Act two exteriors" });
  assert.equal(result.linesAdded, undefined);
  assert.equal(result.linesRemoved, undefined);
});

test("a line is set on a board and another taken off by quoting it", async () => {
  const { db } = fakeDb([photo("a")], [lettered("board-7", ["a"], ["Act two exteriors", "dusk"])]);
  const { asked, compose } = composing([
    { blockId: "caption-1", slotId: "text-1" },
    { blockId: "a", slotId: "img-1" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "retitle it",
    boardId: "board-7",
    addCaptions: ["no fill"],
    removeCaptions: ["  ACT two   exteriors ", "a line nobody set"],
    layout: "HERO_LEFT",
  });

  assert.deepEqual(
    asked[0]!.blocks.filter((block) => block.kind === "text").map((block) => block.text),
    ["dusk", "no fill"],
  );
  assert.deepEqual(result.linesAdded, ["no fill"]);
  assert.deepEqual(result.linesRemoved, ["ACT two exteriors"]);
  assert.deepEqual(result.linesNotOnBoard, ["a line nobody set"]);
  assert.match(String(result.linesNotOnBoardNote), /inspect_board/);
});

test("a rebuild keeps the board's name unless it is given a new one", async () => {
  const boards = [board("board-7", ["a"])];
  const { db, of } = fakeDb([photo("a")], boards);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", { intention: "tighter", boardId: "board-7" });
  const kept = (of("moodboard", "updateMany")[0]!.args as { data: { title: string } }).data;
  assert.equal(kept.title, "Board board-7");

  await run(toolset, "compose_moodboard", {
    intention: "tighter",
    boardId: "board-7",
    referenceIds: ["a"],
    title: "Act two, exteriors",
  });
  const renamed = (of("moodboard", "updateMany")[1]!.args as { data: { title: string } }).data;
  assert.equal(renamed.title, "Act two, exteriors");
});

test("a board given a new name and nothing else is a title write, not a compose", async () => {
  const split = layoutById("SPLIT")!;
  const boards = [
    composedBoard("board-7", split, [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]]),
  ];
  const { db, of } = fakeDb([photo("a"), photo("b")], boards);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "call it act two",
    boardId: "board-7",
    title: "Act two, exteriors",
  });

  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);

  const write = of("moodboard", "update")[0]!.args as {
    where: { id: string };
    data: Record<string, unknown>;
  };
  assert.equal(write.where.id, "board-7");
  assert.deepEqual(Object.keys(write.data), ["title"]);
  assert.equal(write.data.title, "Act two, exteriors");
  assert.equal(result.title, "Act two, exteriors");
  assert.match(String(result.status), /nothing on the board moved/);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "board" && attachment.title, "Act two, exteriors");
  assert.equal(attachment?.kind === "board" && attachment.caption, "2 photographs · Split");
});

test("a page given a new name and nothing else is a scene write, not a compose", async () => {
  const split = layoutById("SPLIT")!;
  const spread = spreadBoard("board-7", split, [
    { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
    { id: "page-2", name: "Page 2", placed: [["c", "img-1", 400, 300]] },
  ]);
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")], [spread]);
  const stood = spread.revision;
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "call the second page act two",
    boardId: "board-7",
    pageId: "page-2",
    pageName: "  Act two  ",
  });

  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  assert.equal(of("moodboard", "update").length, 0);
  const write = of("moodboard", "updateMany")[0]!.args as {
    where: { id: string; revision: number };
    data: Record<string, unknown>;
  };
  assert.equal(write.where.revision, stood);
  assert.deepEqual(Object.keys(write.data).sort(), [
    "elements",
    "pageCount",
    "pageNames",
    "renderRevision",
    "revision",
  ]);

  const pages = boardPages((write.data as { elements: unknown }).elements);
  assert.deepEqual(pages.map((page) => [page.id, page.name]), [
    ["page-1", "Cold open"],
    ["page-2", "Act two"],
  ]);
  assert.deepEqual(
    ((write.data as { elements: { id: string }[] }).elements).map((element) => element.id),
    ["page-1-el-0", "page-1-el-1", "page-1", "page-2-el-0", "page-2"],
  );

  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  assert.equal(result.title, "Board board-7");
  assert.match(String(result.status), /that page is now called “Act two”/);
  assert.match(String(result.status), /not laid out again/);
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
});

test("a board and a page renamed together are one write and one answer", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Page 1", placed: [["a", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "name them",
    boardId: "board-7",
    title: "The spread",
    pageName: "Cold open",
  });

  const write = of("moodboard", "updateMany")[0]!.args as { data: Record<string, unknown> };
  assert.equal(write.data.title, "The spread");
  assert.deepEqual(
    boardPages((write.data as { elements: unknown }).elements).map((page) => page.name),
    ["Cold open"],
  );
  assert.equal(result.title, "The spread");
  assert.match(String(result.status), /the board is now “The spread” and its page “Cold open”/);
});

test("a page named on a board that has no pages is refused, with the call that makes one", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "call it act two",
    boardId: "board-7",
    pageName: "Act two",
  });

  assert.match(String(result.error), /no pages on it/);
  assert.match(String(result.error), /add_page/);
  assert.equal(asked.length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("moodboard", "update").length, 0);
});

test("a page added with a name of its own is drawn with it and briefed with it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([{ blockId: "b", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the exteriors on a page of their own",
    boardId: "board-7",
    newPage: true,
    pageName: "The exteriors",
    referenceIds: ["b"],
  });

  assert.equal(asked[0]!.page?.name, "The exteriors");
  assert.equal((result.page as { name: string }).name, "The exteriors");
  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(
    boardPages(data.elements).map((page) => page.name),
    ["Cold open", "The exteriors"],
  );
});

test("a page laid out again under a new name is composed and briefed under it", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Page 2", placed: [["b", "img-1", 400, 300], ["c", "img-2", 400, 300]] },
      ]),
    ],
  );
  const { asked, compose } = composing([
    { blockId: "b", slotId: "img-1" },
    { blockId: "c", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "lay the second page out again as act two",
    boardId: "board-7",
    pageId: "page-2",
    pageName: "Act two",
    layout: "SPLIT",
  });

  assert.equal(asked[0]!.page?.name, "Act two");
  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(
    boardPages(data.elements).map((page) => [page.id, page.name]),
    [
      ["page-1", "Cold open"],
      ["page-2", "Act two"],
    ],
  );
});

test("a new name asked for with a template is still a rebuild", async () => {
  const boards = [board("board-7", ["a"])];
  const { db, of } = fakeDb([photo("a")], boards);
  const { asked, compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "square it off and call it act two",
    boardId: "board-7",
    title: "Act two, exteriors",
    layout: "SPLIT",
  });

  assert.equal(asked.length, 1);
  assert.equal(of("moodboard", "update").length, 0);
  const data = (of("moodboard", "updateMany")[0]!.args as { data: { title: string } }).data;
  assert.equal(data.title, "Act two, exteriors");
});

test("a board renamed to the name it already has is not written at all", async () => {
  const boards = [board("board-7", ["a"], { title: "Act two, exteriors" })];
  const { db, of } = fakeDb([photo("a")], boards);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "call it act two",
    boardId: "board-7",
    title: "Act two, exteriors",
  });

  assert.equal(asked.length, 0);
  assert.equal(of("moodboard", "update").length, 0);
  assert.match(String(result.status), /already called that/);
});

test("a rebuild keeps the board's template instead of choosing one by count", async () => {
  const boards = [board("board-7", ["a", "b", "c", "d", "e"], { layout: "HERO_LEFT" })];
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c"), photo("d"), photo("e")],
    boards,
  );
  const { asked, compose } = composing(
    ["a", "b", "c", "d", "e"].map((id, index) => ({ blockId: id, slotId: `img-${index + 1}` })),
  );
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "tighten it up",
    boardId: "board-7",
  });

  assert.equal(result.layout, "HERO_LEFT");
  assert.equal(result.layoutChanged, undefined);
  assert.equal(asked[0]!.layout.id, "HERO_LEFT");
  const data = (of("moodboard", "updateMany")[0]!.args as {
    data: { layout: string; widthPx: number };
  }).data;
  assert.equal(data.layout, "HERO_LEFT");
  assert.equal(data.widthPx, 1920);
});

test("a board that outgrows its template is laid out again and told to say so", async () => {
  const split = layoutById("SPLIT")!;
  const boards = [
    composedBoard("board-7", split, [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]]),
  ];
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c"), photo("d")], boards);
  const { compose } = composing(
    ["a", "b", "c", "d"].map((id, index) => ({ blockId: id, slotId: `img-${index + 1}` })),
  );
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "put these two on as well",
    boardId: "board-7",
    addReferenceIds: ["c", "d"],
  });

  assert.equal(result.layout, "FILMSTRIP");
  assert.match(String(result.layoutChanged), /was laid out as SPLIT/);
  assert.equal(
    (of("moodboard", "updateMany")[0]!.args as { data: { layout: string } }).data.layout,
    "FILMSTRIP",
  );
});

test("a new board records the template it was composed at", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", { intention: "dusk", referenceIds: ["a", "b"] });
  assert.equal((of("moodboard", "create")[0]!.args as { data: { layout: string } }).data.layout, "SPLIT");
});

test("a template named beside a layout image is refused before either model call", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("page")]);
  const { asked: read, readPage } = reading();
  const { asked: composed, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose, readPage });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "like this page",
    referenceIds: ["a", "b"],
    layout: "SPLIT",
    layoutImageId: "page",
  });

  assert.match(String(result.error), /pick one/);
  assert.match(String(result.error), /page/);
  assert.match(String(result.error), /SPLIT/);
  assert.equal(read.length, 0);
  assert.equal(composed.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a layout image this project does not hold is refused before the read", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { asked: read, readPage } = reading();
  const toolset = referenceToolset({ db, projectId: "p1", readPage });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "like this page",
    referenceIds: ["a", "b"],
    layoutImageId: "elsewhere",
  });

  assert.match(String(result.error), /no picture called elsewhere/);
  assert.equal(read.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("the page handed in as an image is read for the layout and stays off the board", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("page", { width: 1600, height: 900 })]);
  const { asked: read, readPage, layout: page } = reading();
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose, readPage });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "lay them out like this page",
    referenceIds: ["a", "b", "page"],
    layoutImageId: "page",
  });

  assert.deepEqual(
    asked[0]!.blocks.map((block) => block.id),
    ["a", "b"],
  );
  assert.equal(asked[0]!.layout.id, "CUSTOM");
  assert.deepEqual(
    asked[0]!.layout.slots.map((slot) => slot.id),
    page.slots.map((slot) => slot.id),
  );
  assert.equal(result.layout, "CUSTOM");
  assert.match(String(result.layoutRead), /not a template — that page was read off page/);
  assert.equal(read[0]!.gcsUri, "gs://director-bucket/uploads/page.jpg");
  assert.deepEqual(read[0]!.image, { width: 1600, height: 900 });

  const rows = of("agentRun", "create").map(
    (call) => (call.args as { data: { agent: string } }).data.agent,
  );
  assert.deepEqual(rows, ["LAYOUT_READER", "COMPOSITOR"]);
  assert.deepEqual(spentOf(of("agentRun", "update")[0]!), { model: MODELS.FLASH, ...READ_USAGE });
});

test("a board laid out from a layout image stores CUSTOM and the page it was read as", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("page")]);
  const { readPage, layout: page } = reading();
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose, readPage });

  await run(toolset, "compose_moodboard", {
    intention: "like this page",
    referenceIds: ["a", "b"],
    layoutImageId: "page",
  });

  const data = (
    of("moodboard", "create")[0]!.args as {
      data: { layout: string; widthPx: number; heightPx: number; layoutSlots: unknown };
    }
  ).data;
  assert.equal(data.layout, "CUSTOM");
  assert.equal(data.widthPx, page.page.width);
  assert.equal(data.heightPx, page.page.height);
  assert.deepEqual(data.layoutSlots, customLayoutColumns(page));
});

test("a rebuild with no layout image keeps the page the board was drawn from", async () => {
  const { layout: page } = reading();
  const boards = [
    board("board-7", ["a", "b"], { layout: "CUSTOM", layoutSlots: customLayoutColumns(page) }),
  ];
  const { db, of } = fakeDb([photo("a"), photo("b")], boards);
  const { asked: read, readPage } = reading();
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose, readPage });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "tighten it up",
    boardId: "board-7",
  });

  assert.equal(read.length, 0);
  assert.equal(asked[0]!.layout.id, "CUSTOM");
  assert.deepEqual(asked[0]!.layout.slots, page.slots);
  assert.equal(result.layout, "CUSTOM");
  assert.equal(result.layoutChanged, undefined);
  const data = (
    of("moodboard", "updateMany")[0]!.args as { data: { layout: string; layoutSlots: unknown } }
  ).data;
  assert.equal(data.layout, "CUSTOM");
  assert.deepEqual(data.layoutSlots, customLayoutColumns(page));
});

test("a compose onto a template clears the geometry the custom page left behind", async () => {
  const { layout: page } = reading();
  const boards = [
    board("board-7", ["a", "b"], { layout: "CUSTOM", layoutSlots: customLayoutColumns(page) }),
  ];
  const { db, of } = fakeDb([photo("a"), photo("b")], boards);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "make it a split instead",
    boardId: "board-7",
    layout: "SPLIT",
  });

  assert.equal(result.layout, "SPLIT");
  const data = (
    of("moodboard", "updateMany")[0]!.args as { data: { layout: string; layoutSlots: unknown } }
  ).data;
  assert.equal(data.layout, "SPLIT");
  assert.equal(data.layoutSlots, Prisma.DbNull);
});

test("a page the reader refused is reported back, with its tokens on the failed row", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("page")]);
  const refusal = Object.assign(
    new LayoutReaderError("no placeholders were found on that page"),
    { usage: READ_USAGE },
  );
  const { asked: composed, compose } = composing([]);
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    compose,
    readPage: (async () => {
      throw refusal;
    }) as never,
  });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "like this page",
    referenceIds: ["a", "b"],
    layoutImageId: "page",
  });

  assert.match(String(result.error), /no placeholders were found/);
  assert.equal(composed.length, 0);
  assert.equal(of("moodboard", "create").length, 0);

  const [failed] = of("agentRun", "update");
  const data = (failed!.args as { data: Record<string, unknown> }).data;
  assert.equal(data.status, "FAILED");
  assert.match(String(data.error), /no placeholders were found/);
  assert.deepEqual(spentOf(failed!), { model: MODELS.FLASH, ...READ_USAGE });
});

test("a board changed while the compositor was composing is not overwritten", async () => {
  const boards = [board("board-7", ["a"], { revision: 9 })];
  const { db, of } = fakeDb([photo("a")], boards);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const raced = (async (input: unknown) => {
    boards[0]!.revision = 10;
    return (compose as (input: unknown) => Promise<unknown>)(input);
  }) as never;
  const toolset = referenceToolset({ db, projectId: "p1", compose: raced });

  const { result, attachments } = await run(toolset, "compose_moodboard", {
    intention: "again",
    boardId: "board-7",
  });

  assert.match(String(result.error), /changed while I was composing/);
  assert.equal(attachments, undefined);
  assert.equal((of("moodboard", "updateMany")[0]!.args as { where: { revision: number } }).where.revision, 9);

  const [finished] = of("agentRun", "update");
  assert.equal((finished!.args as { data: { status: string } }).data.status, "FAILED");
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...COMPOSE_USAGE });
});

test("a rebuild of a board this project does not hold costs nothing", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "again",
    boardId: "board-9",
  });
  assert.match(String(result.error), /no board called board-9/);
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  const [read] = of("moodboard", "findFirst");
  assert.deepEqual((read!.args as { where: unknown }).where, { id: "board-9", projectId: "p1" });
});

test("a new board with no references named is refused before the model call", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", { intention: "dusk" });
  assert.match(String(result.error), /name the references/);
  assert.equal(asked.length, 0);
  assert.equal(of("moodboard", "create").length, 0);
});

test("the brief names the board a rebuild can be asked for, without reading its scene", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", ["a"], { title: "Act two" })]);
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-7" });

  const brief = await toolset.brief();
  assert.match(
    brief,
    /The project holds 1 board\. The one the user has open:\nboard-7 · Act two · 1920×1080/,
  );

  const [read] = of("moodboard", "findMany");
  const select = (read!.args as { select: Record<string, unknown> }).select;
  assert.deepEqual(Object.keys(select).sort(), [
    "heightPx",
    "id",
    "layout",
    "pageCount",
    "pageNames",
    "title",
    "widthPx",
  ]);
});

test("an open board this project has not got primes as no board, not as no boards", async () => {
  const { db } = fakeDb(
    [photo("a")],
    [board("board-7", ["a"], { title: "Act two" }), board("board-8", ["a"], { title: "Scraps" })],
  );
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-gone" });

  const brief = await toolset.brief();
  assert.match(brief, /The project holds 2 boards, none of them open in front of the user\./);
  assert.match(brief, /list_boards/);
  assert.equal(brief.includes("board-7"), false);
});

test("a project with boards and none open says so and names the door to them", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"], { title: "Act two" })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  assert.match(await toolset.brief(), /The project holds 1 board, none of them open/);
});

test("list_boards names every board of the project, off the columns the brief reads", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Exteriors", placed: [["b", "img-1", 400, 300]] },
      ]),
      board("board-8", ["a"], { title: "Scraps" }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-7" });

  const { result } = await run(toolset, "list_boards", {});
  assert.equal(result.total, 2);
  assert.deepEqual(result.boards, [
    "board-7 · Board board-7 · 1920×1080 · SPLIT · 2 pages: “Cold open”, “Exteriors”",
    "board-8 · Scraps · 1920×1080",
  ]);

  const select = (of("moodboard", "findMany")[0]!.args as { select: Record<string, unknown> })
    .select;
  assert.equal("elements" in select, false);
  assert.equal(of("moodboard", "findMany").length, 1);
});

test("list_boards on a project with no boards says so and names what makes one", async () => {
  const { db } = fakeDb([photo("a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "list_boards", {});
  assert.equal(result.total, 0);
  assert.deepEqual(result.boards, []);
  assert.match(String(result.note), /add_board/);
});

test("get_board_brief answers one board in the line the priming carries", async () => {
  const { db, of } = fakeDb(
    [photo("a")],
    [board("board-7", ["a"], { title: "Act two" }), board("board-8", ["a"], { title: "Scraps" })],
  );
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-7" });

  const { result } = await run(toolset, "get_board_brief", { boardId: "board-8" });
  assert.equal(result.board, "board-8 · Scraps · 1920×1080");
  assert.ok((await toolset.brief()).includes("board-7 · Act two · 1920×1080"));

  const select = (of("moodboard", "findMany")[0]!.args as { select: Record<string, unknown> })
    .select;
  assert.equal("elements" in select, false);
});

test("get_board_brief refuses an id this project has not got by naming list_boards", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"], { title: "Act two" })]);
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-7" });

  const { result } = await run(toolset, "get_board_brief", { boardId: "board-9" });
  assert.match(String(result.error), /no board called board-9 in this project/);
  assert.match(String(result.boardsNote), /list_boards/);
  assert.match(String(result.boardsNote), /1 board/);

  const unnamed = await run(toolset, "get_board_brief", {});
  assert.match(String(unnamed.result.error), /name the board to look up/);
  assert.match(String(unnamed.result.error), /list_boards/);
});

test("get_board_brief answers a board this turn filed, off the read it was folded into", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", { intention: "the ridge", referenceIds: ["a", "b"] });

  const { result } = await run(toolset, "get_board_brief", { boardId: "board-1" });
  assert.equal(result.board, "board-1 · the ridge · 1920×1080 · SPLIT");
  assert.equal(of("moodboard", "findMany").length, 1);
});

test("what the compositor could not place is reported rather than swallowed", async () => {
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "ghost", slotId: "img-2" },
    { blockId: "b", slotId: "img-9" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: ["a", "b", "c"],
  });
  assert.deepEqual(result.unknownBlocks, ["ghost"]);
  assert.deepEqual(result.unknownSlots, ["img-9"]);
  assert.deepEqual(result.placed, [
    { slotId: "img-1", blockId: "a" },
    { slotId: "img-2", blockId: "b" },
    { slotId: "img-3", blockId: "c" },
  ]);
  assert.deepEqual(result.seatedWhereThereWasRoom, ["b", "c"]);
  assert.equal(result.unplaced, undefined);
});

test("references the block cap never offered are named too, not only the unplaced ones", async () => {
  const ids = Array.from({ length: 14 }, (_, index) => `r${index + 1}`);
  const { db } = fakeDb(ids.map((id) => photo(id)));
  const { asked, compose } = composing([{ blockId: "r1", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: [...ids, "ghost"],
    captions: ["Dusk, exteriors"],
  });

  assert.equal(asked[0]!.blocks.length, 12);
  assert.deepEqual(result.notOffered, ["r12", "r13", "r14"]);
  assert.deepEqual(result.notFound, ["ghost"]);
  assert.ok(!(result.unplaced as string[]).includes("r14"));
});

test("pictures sitting loosely in their slots come back with the cut that would close them", async () => {
  const { db } = fakeDb([photo("a"), photo("b", { width: 1200, height: 2400 })]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: ["a", "b"],
    layout: "FILMSTRIP",
  });

  const loose = result.looseInSlot as { referenceId: string; slotId: string; cropTo: string }[];
  assert.deepEqual(
    loose.map((fit) => [fit.referenceId, fit.slotId, fit.cropTo]),
    [
      ["b", "img-2", "16:9"],
      ["a", "img-1", "16:9"],
    ],
  );
  assert.match(String(result.looseInSlotNote), /crop_reference/);
  assert.doesNotMatch(String(result.looseInSlotNote), /Ask the user first/);
});

test("a board whose pictures fit their slots says nothing about crops", async () => {
  const { db } = fakeDb([photo("a", { width: 3200, height: 1800 }), photo("b", { width: 1920, height: 1080 })]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: ["a", "b"],
    layout: "FILMSTRIP",
  });

  assert.equal(result.looseInSlot, undefined);
  assert.equal(result.looseInSlotNote, undefined);
});

test("a board nothing stuck to is an error, not an empty page filed as a board", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([{ blockId: "ghost", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: ["a", "b"],
  });
  assert.match(String(result.error), /placed nothing/);
  assert.equal(of("moodboard", "create").length, 0);
});

test("a board is named by its title when it has one and by the intention when it has not", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", {
    intention: "the light before a storm, shot wide",
    referenceIds: ["a", "b"],
    title: "  Storm light  ",
  });
  const data = (of("moodboard", "create")[0]!.args as { data: { title: string } }).data;
  assert.equal(data.title, "Storm light");
});

function arranged(id: string, placed: readonly [string, number, number][]) {
  return board(id, [], {
    elements: placed.map(([referenceId, x, y], index) => ({
      id: `el-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
      x,
      y,
      width: 400,
      height: 300,
    })) as never,
  });
}

function composedBoard(
  id: string,
  layout: MoodboardLayout,
  placed: readonly [string, string, number, number][],
  page?: { id: string; name: string },
) {
  return board(id, [], {
    layout: layout.id,
    widthPx: layout.page.width,
    heightPx: layout.page.height,
    elements: [
      ...placed.map(([referenceId, slotId, width, height], index) => ({
        id: `el-${index}`,
        type: "image",
        fileId: `ref:${referenceId}`,
        ...(page && { frameId: page.id }),
        ...fitInSlot(layout.slots.find((slot) => slot.id === slotId)!, {
          id: referenceId,
          kind: "image",
          width,
          height,
        }),
      })),
      ...(page
        ? [
            {
              ...pageFrame({ x: 0, y: 0, ...layout.page }, { name: page.name, makeId: () => page.id }),
            },
          ]
        : []),
    ] as never,
  });
}

test("inspect_board says what is on a board, in reading order, without touching it", async () => {
  const { db, of } = fakeDb(
    [photo("a", { title: "Dune" }), photo("b", { title: "Ridge" })],
    [arranged("board-7", [["b", 900, 0], ["a", 0, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.equal(result.boardId, "board-7");
  assert.equal(result.pageSize, "1920×1080");
  assert.equal(result.pages, undefined);
  assert.deepEqual(
    (result.pictures as { position: number; id: string; title: string }[]).map(
      ({ position, id, title }) => [position, id, title],
    ),
    [
      [1, "a", "Dune"],
      [2, "b", "Ridge"],
    ],
  );

  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("moodboard", "create").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "board");
  assert.equal(attachment?.kind === "board" && attachment.boardId, "board-7");
  assert.equal(attachment?.kind === "board" && attachment.caption, "2 photographs · 1920×1080");
  assert.equal(attachment?.kind === "board" && attachment.preview?.items.length, 2);
});

test("inspect_board names the template a board was composed at, and says nothing for a hand-made one", async () => {
  const composed = arranged("board-7", [["a", 0, 0]]);
  const { db } = fakeDb([photo("a")], [{ ...composed, layout: "GRID_3X3" }, arranged("board-8", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  assert.equal((await run(toolset, "inspect_board", { boardId: "board-7" })).result.composedAs, "GRID_3X3");
  assert.equal((await run(toolset, "inspect_board", { boardId: "board-8" })).result.composedAs, undefined);
});

test("inspect_board keeps the position of a picture the gallery no longer has", async () => {
  const { db } = fakeDb(
    [photo("a")],
    [arranged("board-7", [["a", 0, 0], ["deleted", 900, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.deepEqual(result.pictures, [
    { position: 1, id: "a", title: "a", shape: "4:3" },
    { position: 2, id: "deleted", gone: true },
  ]);
});

function spread(
  boardId: string,
  pages: readonly [string, string, number][],
  placed: readonly [string, number, number][],
) {
  const size = { width: 1920, height: 1080 };
  return board(boardId, [], {
    elements: [
      ...placed.map(([referenceId, x, y], index) => ({
        id: `el-${index}`,
        type: "image",
        fileId: `ref:${referenceId}`,
        x,
        y,
        width: 400,
        height: 300,
      })),
      ...pages.map(([pageId, name, x]) =>
        pageFrame({ x, y: 0, ...size }, { name, makeId: () => pageId }),
      ),
    ] as never,
  });
}

test("inspect_board draws a shape among the page's blocks and counts it apart from the pictures", async () => {
  const scene = spread("board-8", [["p1", "Page 1", 0]], [["a", 100, 100]]);
  (scene.elements as unknown[]).unshift({
    id: "ground",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    backgroundColor: "#f4efe6",
    strokeColor: "transparent",
  });
  const { db } = fakeDb([photo("a")], [scene]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-8", pageId: "p1" });

  assert.deepEqual(
    (result.pictures as { id: string }[]).map(({ id }) => id),
    ["a"],
  );
  const blocks = result.arrangement as { kind: string; shape?: string; fill?: string }[];
  assert.deepEqual(
    blocks.map((entry) => entry.kind),
    ["shape", "image"],
  );
  assert.equal(blocks[0]?.shape, "rectangle");
  assert.equal(blocks[0]?.fill, "#f4efe6");

  const { result: listed } = await run(toolset, "inspect_board", { boardId: "board-8" });
  assert.deepEqual((listed.pages as { pictures: number; shapes: number }[])[0], {
    pageId: "p1",
    name: "Page 1",
    position: 1,
    of: 1,
    width: 1920,
    height: 1080,
    preset: "LANDSCAPE_HD",
    pictures: 1,
    lines: 0,
    shapes: 1,
    clipped: 0,
  } as never);
});

test("inspect_board lists the pages of a board, with what is on each and what is on none", async () => {
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c"), photo("d"), photo("e")],
    [
      spread(
        "board-7",
        [
          ["p2", "Cold open", 2120],
          ["p1", "Page 1", 0],
        ],
        [
          ["a", 100, 100],
          ["b", 300, 600],
          ["c", 2220, 100],
          ["d", 3800, 100],
          ["e", 6000, 100],
        ],
      ),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.deepEqual(result.pages, [
    {
      pageId: "p1",
      name: "Page 1",
      position: 1,
      of: 2,
      width: 1920,
      height: 1080,
      preset: "LANDSCAPE_HD",
      pictures: 2,
      lines: 0,
      shapes: 0,
      clipped: 0,
    },
    {
      pageId: "p2",
      name: "Cold open",
      position: 2,
      of: 2,
      width: 1920,
      height: 1080,
      preset: "LANDSCAPE_HD",
      pictures: 2,
      lines: 0,
      shapes: 0,
      clipped: 1,
    },
  ]);
  assert.match(String(result.pagesNote), /pageId/);

  assert.deepEqual(result.picturesOnNoPage, ["e"]);

  assert.deepEqual(
    (result.pictures as { id: string }[]).map(({ id }) => id),
    ["a", "c", "d", "e", "b"],
  );
});

test("a picture where two pages overlap is read on the topmost one and on neither other", async () => {
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spread(
        "board-7",
        [
          ["under", "Act one", 0],
          ["over", "Act two", 960],
        ],
        [
          ["a", 100, 100],
          ["b", 1000, 100],
        ],
      ),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.deepEqual(
    (result.pages as { name: string; pictures: number }[]).map(({ name, pictures }) => [
      name,
      pictures,
    ]),
    [
      ["Act one", 1],
      ["Act two", 1],
    ],
  );
  assert.equal(result.picturesOnNoPage, undefined);

  const under = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "under" });
  assert.deepEqual(
    (under.result.pictures as { id: string }[]).map(({ id }) => id),
    ["a"],
  );

  assert.deepEqual(
    (under.result.arrangement as { referenceId: string }[]).map(({ referenceId }) => referenceId),
    ["a"],
  );

  const over = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "over" });
  assert.deepEqual(
    (over.result.pictures as { id: string }[]).map(({ id }) => id),
    ["b"],
  );
  assert.deepEqual(
    (over.result.arrangement as { referenceId: string }[]).map(({ referenceId }) => referenceId),
    ["b"],
  );
});

test("a compose about the page underneath is read from that page's own pictures", async () => {
  const split = layoutById("SPLIT")!;
  const row = composedBoard("board-7", split, [["a", "img-1", 400, 300]], {
    id: "under",
    name: "Act one",
  });
  (row.elements as unknown[]).push(
    { id: "over-el", type: "image", fileId: "ref:b", x: 1750, y: 350, width: 300, height: 300 },
    pageFrame({ x: 960, y: 0, ...split.page }, { name: "Act two", makeId: () => "over" }),
  );
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")], [board("board-7", [], row)]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "c", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add the doorway",
    boardId: "board-7",
    pageId: "under",
    addReferenceIds: ["c"],
  });

  assert.match(String(result.status), /kept their slots/);
});

test("inspect_board reads one page alone and marks what hangs over its edge", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("c"), photo("d")],
    [
      spread(
        "board-7",
        [
          ["p1", "Page 1", 0],
          ["p2", "Cold open", 2120],
        ],
        [
          ["a", 100, 100],
          ["c", 2220, 100],
          ["d", 3800, 100],
        ],
      ),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "inspect_board", {
    boardId: "board-7",
    pageId: "p2",
  });

  assert.deepEqual(result.page, {
    pageId: "p2",
    name: "Cold open",
    position: 2,
    of: 2,
    size: "1920×1080",
    preset: "LANDSCAPE_HD",
  });
  assert.deepEqual(
    (result.pictures as { id: string; clipped?: boolean }[]).map(({ id, clipped }) => [
      id,
      clipped ?? false,
    ]),
    [
      ["c", false],
      ["d", true],
    ],
  );
  assert.match(String(result.clippedNote), /overflow/);
  assert.match(String(result.status), /Cold open/);

  assert.equal(result.pages, undefined);
  assert.equal(result.picturesOnNoPage, undefined);

  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");
});

test("a page read reports the size label the user's own rectangle derives to", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a")],
    [
      board("board-7", [], {
        layout: split.id,
        elements: [
          pageFrame(
            { x: 0, y: 0, width: split.page.width * 2, height: split.page.height * 2 },
            { name: "Cold open", makeId: () => "page-7" },
          ),
        ] as never,
      }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", {
    boardId: "board-7",
    pageId: "page-7",
  });

  assert.deepEqual(result.page, {
    pageId: "page-7",
    name: "Cold open",
    position: 1,
    of: 1,
    size: "3840×2160",
    preset: "Custom",
  });
});

test("a page read says where each block sits on it, as a share of that page", async () => {
  const { db } = fakeDb(
    [photo("a"), photo("c"), photo("d")],
    [
      spread(
        "board-7",
        [
          ["p1", "Page 1", 0],
          ["p2", "Cold open", 2120],
        ],
        [
          ["a", 100, 100],
          ["c", 2220, 100],
          ["d", 3800, 100],
        ],
      ),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "p2" });

  assert.deepEqual(result.arrangement, [
    { kind: "image", referenceId: "c", box: [93, 52, 370, 260], z: 0 },
    { kind: "image", referenceId: "d", box: [93, 875, 370, 1000], z: 1, clipped: true },
  ]);
  assert.match(String(result.arrangementNote), /\[ymin, xmin, ymax, xmax\]/);
  assert.equal(result.arrangementOmitted, undefined);

  const whole = await run(toolset, "inspect_board", { boardId: "board-7" });
  assert.equal(whole.result.arrangement, undefined);
  assert.equal(whole.result.arrangementNote, undefined);
});

test("inspect_board refuses a page that board has not got, and lists the ones it has", async () => {
  const { db } = fakeDb(
    [photo("a")],
    [
      spread("board-7", [["p1", "Page 1", 0]], [["a", 100, 100]]),
      arranged("board-8", [["a", 0, 0]]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "p9" });
  assert.match(String(result.error), /no page called p9/);
  assert.deepEqual(
    (result.pages as { pageId: string }[]).map(({ pageId }) => pageId),
    ["p1"],
  );

  const none = await run(toolset, "inspect_board", { boardId: "board-8", pageId: "p1" });
  assert.match(String(none.result.error), /no page called p1/);
  assert.equal(none.result.pages, undefined);
  assert.match(String(none.result.pagesNote), /no pages/);
});

test("inspect_board says which pictures sit loosely in their slot, without composing anything", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-2")!;
  const { db, of } = fakeDb(
    [photo("a", { width: 1000, height: 300 }), photo("b", { width: panel.width, height: panel.height })],
    [composedBoard("board-7", split, [
      ["a", "img-1", 1000, 300],
      ["b", "img-2", panel.width, panel.height],
    ])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.deepEqual(
    (result.looseInSlot as { referenceId: string; slotId: string; cropTo: string }[]).map(
      ({ referenceId, slotId, cropTo }) => [referenceId, slotId, cropTo],
    ),
    [["a", "img-1", "1:1"]],
  );
  assert.match(String(result.looseInSlotNote), /crop_reference/);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a picture sitting loosely on the board's second page is reported, and said to be on that page", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-2")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-2", panel.width, panel.height]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 1000, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.deepEqual(
    (result.looseInSlot as { referenceId: string; slotId: string; page: string; pageId: string }[]).map(
      ({ referenceId, slotId, page, pageId }) => [referenceId, slotId, page, pageId],
    ),
    [["c", "img-1", "Act two", "page-2"]],
  );
});

test("a page-scoped read reports that page's loose fits alone, without renaming the page on each", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 1000, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "page-2" });

  const loose = result.looseInSlot as Record<string, unknown>[];
  assert.deepEqual(
    loose.map(({ referenceId, slotId }) => [referenceId, slotId]),
    [["c", "img-1"]],
  );
  assert.equal("pageId" in loose[0]!, false);
});

test("a page-scoped read names the template only while that page is standing in it", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        {
          id: "page-1",
          name: "Cold open",
          placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]],
        },
        { id: "page-2", name: "Act two", placed: [] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const onOne = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "page-1" });
  assert.equal(onOne.result.composedAs, "SPLIT");

  const onTwo = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "page-2" });
  assert.equal(onTwo.result.composedAs, undefined);
  const [tile] = onTwo.attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.includes("Split"), false);

  const whole = await run(toolset, "inspect_board", { boardId: "board-7" });
  assert.equal(whole.result.composedAs, "SPLIT");
});

test("a page-scoped read shows that page in the chat rather than the whole spread", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        {
          id: "page-1",
          name: "Cold open",
          placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]],
        },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]], lines: ["ACT TWO"] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const scoped = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "page-2" });
  const [tile] = scoped.attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.images, 1);
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
  assert.deepEqual(tile?.kind === "board" ? tile.lines : [], ["ACT TWO"]);
  assert.equal(tile?.kind === "board" ? tile.preview?.items.length : 0, 2);

  const whole = await run(toolset, "inspect_board", { boardId: "board-7" });
  const [board] = whole.attachments ?? [];
  assert.equal(board?.kind === "board" && board.images, 3);
  assert.equal(board?.kind === "board" && board.caption.includes("page"), false);
});

test("duplicate_board files a second board holding the first one's scene, and changes nothing on it", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const source = composedBoard("board-7", split, [["a", "img-1", panel.width, panel.height]]);
  const { db, of } = fakeDb([photo("a")], [{ ...source, title: "Act two" }]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "duplicate_board", { boardId: "board-7" });

  const [created] = of("moodboard", "create");
  const data = (created!.args as { data: Record<string, unknown> }).data;
  assert.equal(data.title, "Act two (copy)");
  assert.equal(data.widthPx, split.page.width);
  assert.equal(data.heightPx, split.page.height);
  assert.equal(data.layout, "SPLIT");
  assert.deepEqual((data.elements as { fileId: string }[]).map((el) => el.fileId), ["ref:a"]);

  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);

  assert.equal(result.copyOf, "board-7");
  assert.equal(result.pictures, 1);
  assert.equal(result.composedAs, "SPLIT");
  assert.match(String(result.status), /nothing on the board it was copied from changed/);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "board" && attachment.boardId, result.boardId);
  assert.equal(attachment?.kind === "board" && attachment.caption, "1 photograph · Split");
  assert.equal(attachment?.kind === "board" && attachment.preview?.items.length, 1);
});

test("a copy is named against the copies this turn has already made, and a named one wins", async () => {
  const { db, of } = fakeDb([photo("a")], [{ ...arranged("board-7", [["a", 0, 0]]), title: "Act two" }]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "duplicate_board", { boardId: "board-7" });
  await run(toolset, "duplicate_board", { boardId: "board-7" });
  await run(toolset, "duplicate_board", { boardId: "board-7", title: "  Night version  " });

  assert.deepEqual(
    of("moodboard", "create").map(
      (call) => (call.args as { data: { title: string } }).data.title,
    ),
    ["Act two (copy)", "Act two (copy 2)", "Night version"],
  );
});

test("a board composed this turn stands in the same turn's brief, not only in its count", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose, currentBoardId: "board-1" });

  await run(toolset, "compose_moodboard", { intention: "the ridge", referenceIds: ["a", "b"] });

  const brief = await toolset.brief();
  assert.match(brief, /board-1 · the ridge · 1920×1080 · SPLIT/);
  assert.equal((await toolset.state()).boards, 1);
  assert.equal(of("moodboard", "findMany").length, 1);
});

test("a copy made this turn stands beside the board it was made from", async () => {
  const { db } = fakeDb([photo("a")], [{ ...arranged("board-7", [["a", 0, 0]]), title: "Act two" }]);
  const toolset = referenceToolset({ db, projectId: "p1", currentBoardId: "board-7" });

  await run(toolset, "duplicate_board", { boardId: "board-7" });

  const brief = await toolset.brief();
  assert.match(brief, /The project holds 2 boards\. The one the user has open:\nboard-7 · Act two/);
  assert.equal((await toolset.state()).boards, 2);

  const { result } = await run(toolset, "list_boards", {});
  assert.deepEqual(result.boards, [
    "board-1 · Act two (copy) · 1920×1080",
    "board-7 · Act two · 1920×1080",
  ]);
});

test("discard_board shows the board with the question on it, and deletes nothing", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const source = composedBoard("board-7", split, [["a", "img-1", panel.width, panel.height]]);
  const { db, of } = fakeDb([photo("a")], [{ ...source, title: "Act two" }]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_board", { boardId: "board-7" });

  assert.equal(of("moodboard", "delete").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("moodboard", "create").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  assert.equal(result.boardId, "board-7");
  assert.equal(result.title, "Act two");
  assert.equal(result.pictures, 1);
  assert.equal(result.pageSize, `${split.page.width}×${split.page.height}`);
  assert.equal(result.composedAs, "SPLIT");
  assert.match(String(result.status), /offered, not done/);
  assert.equal(result.pages, undefined);
  assert.match(String(result.status), /never say the board is gone, deleted or removed/);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "board");
  assert.equal(attachment?.kind === "board" && attachment.boardId, "board-7");
  assert.equal(attachment?.kind === "board" && attachment.discard, true);
  assert.equal(attachment?.kind === "board" && attachment.images, 1);
  assert.equal(attachment?.kind === "board" && attachment.preview?.items.length, 1);
});

test("a discard offer quotes the lines on the board it would take with it", async () => {
  const { db } = fakeDb(
    [photo("a", { width: 1000, height: 300 })],
    [titled("board-7", layoutById("SPLIT")!, "Dawn pitch")],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_board", { boardId: "board-7" });

  assert.deepEqual(result.lines, ["Dawn pitch"]);
  assert.deepEqual(attachments?.[0]?.kind === "board" && attachments[0].lines, ["Dawn pitch"]);
});

test("a discard offer names the pages of a spread it would take, not just its pictures", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]], lines: ["ACT TWO"] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_board", { boardId: "board-7" });

  assert.deepEqual(
    (result.pages as { name: string; position: number; of: number; pictures: number }[]).map(
      ({ name, position, of, pictures }) => [name, `${position} of ${of}`, pictures],
    ),
    [["Cold open", "1 of 2", 2], ["Act two", "2 of 2", 1]],
  );
  assert.match(String(result.pagesNote), /the discard takes all of them/);
  assert.equal(result.pageSize, `${split.page.width}×${split.page.height}`);
});

test("a copy of a spread reports the pages it holds, addressed by the copy's own board id", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "duplicate_board", { boardId: "board-7" });

  assert.notEqual(result.boardId, "board-7");
  assert.deepEqual(
    (result.pages as { pageId: string; name: string }[]).map(({ pageId, name }) => [pageId, name]),
    [["page-1", "Cold open"], ["page-2", "Act two"]],
  );
  assert.match(String(result.pagesNote), /pass one of them with this copy's boardId/);
  assert.equal(result.pageSize, `${split.page.width}×${split.page.height}`);
});

test("discard_page offers one page of a spread and leaves the board and its other pages standing", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        {
          id: "page-2",
          name: "Act two",
          placed: [["b", "img-1", 400, 300], ["c", "img-2", 400, 300]],
          lines: ["ACT TWO"],
        },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_page", {
    boardId: "board-7",
    pageId: "page-2",
  });

  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("moodboard", "delete").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  assert.equal(result.boardId, "board-7");
  assert.equal(result.pageId, "page-2");
  assert.equal(result.name, "Act two");
  assert.equal(result.position, 2);
  assert.equal(result.of, 2);
  assert.deepEqual(result.pictures, ["b", "c"]);
  assert.deepEqual(result.lines, ["ACT TWO"]);
  assert.equal(result.emptiesBoard, undefined);
  assert.match(String(result.status), /offered, not done/);
  assert.match(String(result.status), /never say the page is gone, removed or deleted/);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "board" && attachment.discard, true);
  assert.deepEqual(attachment?.kind === "board" && attachment.discardPage, {
    pageId: "page-2",
    name: "Act two",
  });
  assert.equal(attachment?.kind === "board" && attachment.images, 2);
  assert.match(String(attachment?.kind === "board" && attachment.caption), /“Act two”, page 2 of 2/);
});

test("discard_page says when the page it would take is the board's only one", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_page", { boardId: "board-7", pageId: "page-1" });

  assert.equal(result.emptiesBoard, true);
  assert.match(String(result.emptiesBoardNote), /leaves the board standing with nothing on it/);
  assert.match(String(result.emptiesBoardNote), /discard_board/);
});

test("a page the board has not got is refused with the pages that would have worked", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_page", {
    boardId: "board-7",
    pageId: "page-9",
  });

  assert.match(String(result.error), /no page called page-9/);
  assert.deepEqual(
    (result.pages as { pageId: string }[]).map(({ pageId }) => pageId),
    ["page-1", "page-2"],
  );
  assert.equal(attachments, undefined);
});

test("a board this project does not hold has no page offered off it either", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_page", { boardId: "board-9", pageId: "page-1" });

  assert.match(String(result.error), /no board called board-9/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a board this project does not hold is not offered for discarding either", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_board", { boardId: "board-9" });

  assert.match(String(result.error), /no board called board-9/);
  assert.equal(attachments, undefined);
  assert.equal(of("moodboard", "delete").length, 0);
});

test("a board this project does not hold is copied nowhere", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "duplicate_board", { boardId: "board-9" });

  assert.match(String(result.error), /no board called board-9/);
  assert.equal(of("moodboard", "create").length, 0);
});

test("a copy made in the same round as an edit copies the edited board", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("c")],
    [arranged("board-7", [["a", 0, 0], ["b", 900, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  await Promise.all([
    run(toolset, "swap_on_board", { boardId: "board-7", swaps: [{ takeOff: "a", putOn: "c" }] }),
    run(toolset, "duplicate_board", { boardId: "board-7" }),
  ]);

  const [created] = of("moodboard", "create");
  const data = (created!.args as { data: { elements: { fileId: string }[] } }).data;
  assert.deepEqual(data.elements.map((element) => element.fileId), ["ref:c", "ref:b"]);
});

test("a copy inherits the board's picture, and a copy whose picture fails is still a copy", async () => {
  const withRender = {
    ...arranged("board-7", [["a", 0, 0]]),
    renderUri: "gs://director-bucket/projects/p1/boards/board-7/render.png",
    renderRevision: 3,
  };
  const copied: string[] = [];
  const { db, of } = fakeDb([photo("a")], [withRender]);
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    copyRender: async (sourceId, targetId) => {
      copied.push(`${sourceId}→${targetId}`);
      return `gs://director-bucket/projects/p1/boards/${targetId}/render.png`;
    },
  });

  const { result } = await run(toolset, "duplicate_board", { boardId: "board-7" });

  assert.deepEqual(copied, [`board-7→${result.boardId}`]);
  const [update] = of("moodboard", "update");
  assert.deepEqual((update!.args as { data: Record<string, unknown> }).data, {
    renderUri: `gs://director-bucket/projects/p1/boards/${result.boardId}/render.png`,
    renderRevision: 0,
  });

  const failing = fakeDb([photo("a")], [withRender]);
  const second = referenceToolset({
    db: failing.db,
    projectId: "p1",
    copyRender: async () => {
      throw new Error("bucket said no");
    },
  });
  const { result: answer } = await run(second, "duplicate_board", { boardId: "board-7" });
  assert.equal(answer.error, undefined);
  assert.equal(failing.of("moodboard", "create").length, 1);
  assert.equal(failing.of("moodboard", "update").length, 0);
});

test("a copy made this turn is counted in what the project holds", async () => {
  const { db } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  assert.equal((await toolset.state()).boards, 1);
  await run(toolset, "duplicate_board", { boardId: "board-7" });
  assert.equal((await toolset.state()).boards, 2);
});

test("a board whose pictures were dragged off their slots is not held to the template", async () => {
  const split = layoutById("SPLIT")!;
  const composed = composedBoard("board-7", split, [["a", "img-1", 1000, 1500]]);
  const dragged = {
    ...composed,
    elements: (composed.elements as unknown as { x: number }[]).map((element) => ({
      ...element,
      x: element.x + 120,
    })) as never,
  };
  const { db } = fakeDb([photo("a", { width: 1000, height: 1500 })], [dragged]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.equal((result.pictures as unknown[]).length, 1);
  assert.equal(result.looseInSlot, undefined);
  assert.equal(result.looseInSlotNote, undefined);
});

test("a board read back is captioned by the template it is standing in", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const seated = composedBoard("board-7", split, [["a", "img-1", panel.width, panel.height]]);
  const dragged = {
    ...seated,
    id: "board-8",
    elements: (seated.elements as unknown as { x: number }[]).map((element) => ({
      ...element,
      x: element.x + 120,
    })) as never,
  };
  const { db } = fakeDb([photo("a", { width: panel.width, height: panel.height })], [seated, dragged]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const still = (await run(toolset, "inspect_board", { boardId: "board-7" })).attachments?.[0];
  assert.equal(still?.kind === "board" && still.caption, "1 photograph · Split");

  const moved = (await run(toolset, "inspect_board", { boardId: "board-8" })).attachments?.[0];
  assert.equal(moved?.kind === "board" && moved.caption, "1 photograph · 1920×1080");
});

test("a board with no template of its own reports no fits at all", async () => {
  const { db } = fakeDb([photo("a", { width: 1000, height: 1500 })], [arranged("board-8", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  assert.equal((await run(toolset, "inspect_board", { boardId: "board-8" })).result.looseInSlot, undefined);
});

test("inspect_board of a board this project does not hold reads nothing", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "inspect_board", { boardId: "board-9" });

  assert.match(String(result.error), /no board called board-9/);
  assert.deepEqual(attachments ?? [], []);
  assert.deepEqual((of("moodboard", "findFirst")[0]!.args as { where: unknown }).where, {
    id: "board-9",
    projectId: "p1",
  });
});

test("swap_on_board puts the cut where the frame was and leaves the rest alone", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const { db, of } = fakeDb(
    [
      photo("wide", { width: 1000, height: 300 }),
      photo("cut", { width: panel.width, height: panel.height }),
      photo("b", { width: panel.width, height: panel.height }),
    ],
    [composedBoard("board-7", split, [
      ["wide", "img-1", 1000, 300],
      ["b", "img-2", panel.width, panel.height],
    ])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: [{ takeOff: "wide", putOn: "cut" }],
  });

  assert.deepEqual(result.swapped, [{ takeOff: "wide", putOn: "cut", slotId: "img-1" }]);
  assert.equal(of("agentRun", "create").length, 0);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);
  assert.equal(data.widthPx, undefined);

  const written = data.elements as { fileId: string; x: number; width: number }[];
  assert.deepEqual(
    written.map((element) => element.fileId),
    ["ref:cut", "ref:b"],
  );
  assert.equal(written[0]!.width, panel.width);
  assert.equal(result.looseInSlot, undefined);
  assert.equal((attachments ?? []).length, 1);
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption, "2 photographs · Split");
});

test("swap_on_board trades two pictures the board already holds, each refitted to its new slot", async () => {
  const split = layoutById("SPLIT")!;
  const first = split.slots.find((slot) => slot.id === "img-1")!;
  const second = split.slots.find((slot) => slot.id === "img-2")!;
  const { db, of } = fakeDb(
    [photo("a", { width: 1000, height: 300 }), photo("b", { width: 300, height: 1000 })],
    [composedBoard("board-7", split, [
      ["a", "img-1", 1000, 300],
      ["b", "img-2", 300, 1000],
    ])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: [{ takeOff: "a", putOn: "b" }],
  });

  assert.equal(result.swapped, undefined);
  assert.deepEqual(result.tradedPlaces, [
    { takeOff: "a", putOn: "b", putOnSlotId: "img-1", takeOffSlotId: "img-2" },
  ]);
  assert.equal(of("agentRun", "create").length, 0);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);

  const written = data.elements as { fileId: string; x: number; width: number; height: number }[];
  assert.deepEqual(
    written.map((element) => element.fileId),
    ["ref:b", "ref:a"],
  );
  assert.ok(written[0]!.height === first.height && written[0]!.width < first.width);
  assert.ok(written[1]!.width === second.width && written[1]!.height < second.height);
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption, "2 photographs · Split");
});

test("a swap on the second page refits to that page's slot and keeps the spread's name", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const { db, of } = fakeDb(
    [
      photo("a", { width: panel.width, height: panel.height }),
      photo("wide", { width: 1000, height: 300 }),
      photo("cut", { width: panel.width, height: panel.height }),
    ],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", panel.width, panel.height]] },
        { id: "page-2", name: "Act two", placed: [["wide", "img-1", 1000, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: [{ takeOff: "wide", putOn: "cut" }],
  });

  assert.deepEqual(result.swapped, [{ takeOff: "wide", putOn: "cut", slotId: "img-1" }]);

  const { data } = of("moodboard", "updateMany")[0]!.args as {
    data: { elements: { fileId?: string; x: number; width: number }[] };
  };
  const landed = data.elements.find((element) => element.fileId === "ref:cut")!;
  assert.equal(landed.width, panel.width);
  assert.equal(landed.x, panel.x + split.page.width + PAGE_GAP);

  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption, "2 photographs · Split");
});

test("a swap of a picture the board does not hold changes nothing and says which", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("cut")],
    [composedBoard("board-7", split, [["a", "img-1", 1000, 300]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: [{ takeOff: "ghost", putOn: "cut" }],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  assert.deepEqual(result.notOnBoard, ["ghost"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a swap naming a picture outside the project is refused before the write", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [composedBoard("board-7", split, [["a", "img-1", 1000, 300]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: [{ takeOff: "a", putOn: "elsewhere" }],
  });

  assert.deepEqual(result.notInThisProject, ["elsewhere"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a board saved by the user mid-swap is refused rather than overwritten", async () => {
  const split = layoutById("SPLIT")!;
  const row = composedBoard("board-7", split, [["a", "img-1", 1000, 300]]);
  const { db } = fakeDb([photo("a"), photo("cut")], [row]);
  const read = db.moodboard.findFirst;
  db.moodboard.findFirst = (async (args: never) => {
    const board = await read(args);
    row.revision = 4;
    return board;
  }) as typeof db.moodboard.findFirst;
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: [{ takeOff: "a", putOn: "cut" }],
  });

  assert.match(String(result.error), /changed while I was editing it/);
});

test("swap_on_board of a board this project does not hold reads nothing", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-9",
    swaps: [{ takeOff: "a", putOn: "b" }],
  });

  assert.match(String(result.error), /no board called board-9/);
  assert.deepEqual((of("moodboard", "findFirst")[0]!.args as { where: unknown }).where, {
    id: "board-9",
    projectId: "p1",
  });
});

test("a malformed swap list is a refusal rather than a crash", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("board-7", split, [["a", "img-1", 1000, 300]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: ["a", { takeOff: "a" }],
  });

  assert.match(String(result.error), /which picture to take off/);
  assert.equal(result.unreadable, 2);
});

test("swap_on_board named a page exchanges the copy on that page and leaves the board's others standing", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const { db, of } = fakeDb(
    [
      photo("a", { width: 1000, height: 300 }),
      photo("cut", { width: panel.width, height: panel.height }),
    ],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 300]] },
        { id: "page-2", name: "Act two", placed: [["a", "img-1", 1000, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    pageId: "page-2",
    swaps: [{ takeOff: "a", putOn: "cut" }],
  });

  assert.deepEqual(result.swapped, [{ takeOff: "a", putOn: "cut", slotId: "img-1" }]);
  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  assert.match(String(result.status), /“Act two”/);
  assert.match(String(result.status), /other page is untouched/);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const written = data.elements as { id: string; fileId?: string; x: number; width: number }[];
  assert.deepEqual(
    written.filter((element) => element.fileId).map((element) => [element.id, element.fileId]),
    [["page-1-el-0", "ref:a"], ["page-2-el-0", "ref:cut"]],
  );
  const onPageTwo = written.find((element) => element.id === "page-2-el-0")!;
  assert.equal(onPageTwo.width, panel.width);
  assert.equal(onPageTwo.x, panel.x + split.page.width + PAGE_GAP);
});

test("swap_on_board named a page answers about that page alone", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a", { width: 1000, height: 300 }), photo("b", { width: 300, height: 1000 }), photo("cut", { width: 1600, height: 900 })],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 300]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-2", 300, 1000]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    pageId: "page-2",
    swaps: [{ takeOff: "b", putOn: "cut" }],
  });

  assert.deepEqual(
    ((result.looseInSlot as { pageId?: string }[]) ?? []).map((fit) => fit.pageId),
    ["page-2"],
  );
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
  assert.equal(tile?.kind === "board" && tile.images, 1);

  const { result: refused } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    pageId: "page-2",
    swaps: [{ takeOff: "a", putOn: "cut" }],
  });

  assert.match(String(refused.error), /nothing on “Act two” changed/);
  assert.deepEqual(refused.notOnBoard, ["a"]);
  assert.match(String(refused.notOnBoardNote), /another of its pages/);
});

test("swap_on_board refuses a page the board has not got with the ones that would have worked", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a", { width: 1000, height: 300 }), photo("cut", { width: 1600, height: 900 })],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 300]] },
        { id: "page-2", name: "Act two", placed: [] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    pageId: "page-9",
    swaps: [{ takeOff: "a", putOn: "cut" }],
  });

  assert.match(String(result.error), /no page called page-9/);
  assert.deepEqual(
    ((result.pages as { pageId: string }[]) ?? []).map((page) => page.pageId),
    ["page-1", "page-2"],
  );
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("swap_on_board names the exchanges its ceiling cut off", async () => {
  const onBoard = Array.from({ length: SWAP_LIMIT + 2 }, (_, index) => `on-${index}`);
  const joining = Array.from({ length: SWAP_LIMIT + 2 }, (_, index) => `new-${index}`);
  const { db, of } = fakeDb(
    [...onBoard, ...joining].map((id) => photo(id, { width: 400, height: 400 })),
    [board("board-7", onBoard)],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: onBoard.map((takeOff, index) => ({ takeOff, putOn: joining[index]! })),
  });

  assert.equal((result.swapped as unknown[]).length, SWAP_LIMIT);
  assert.deepEqual(result.notMade, [
    { takeOff: `on-${SWAP_LIMIT}`, putOn: `new-${SWAP_LIMIT}` },
    { takeOff: `on-${SWAP_LIMIT + 1}`, putOn: `new-${SWAP_LIMIT + 1}` },
  ]);
  assert.match(String(result.notMadeNote), /call again with them/);
  const written = (of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown } }).data
    .elements as { fileId: string }[];
  assert.deepEqual(
    written.slice(0, SWAP_LIMIT).map((element) => element.fileId),
    joining.slice(0, SWAP_LIMIT).map((id) => `ref:${id}`),
  );
});

test("swap_on_board counts a half pair it could not read even when the rest ran", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const { db } = fakeDb(
    [
      photo("wide", { width: 1000, height: 300 }),
      photo("cut", { width: panel.width, height: panel.height }),
      photo("b", { width: panel.width, height: panel.height }),
    ],
    [
      composedBoard("board-7", split, [
        ["wide", "img-1", 1000, 300],
        ["b", "img-2", panel.width, panel.height],
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    swaps: [{ takeOff: "wide", putOn: "cut" }, { putOn: "b" }],
  });

  assert.deepEqual(result.swapped, [{ takeOff: "wide", putOn: "cut", slotId: "img-1" }]);
  assert.equal(result.unreadable, 1);
  assert.match(String(result.unreadableNote), /both takeOff and putOn/);
});

test("the toolset declares what this project can use, off the reads it already makes", async () => {
  const { db, of } = fakeDb([
    photo("a"),
    photo("b", { source: { id: "a", title: "a" } }),
  ]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  assert.deepEqual(await toolset.state(), {
    photographs: 1,
    crops: 1,
    boards: 0,
    generated: 0,
  });
  assert.deepEqual(
    (await toolset.declarations()).map((tool) => tool.name),
    [
      "list_references",
      "show_references",
      "crop_reference",
      "discard_reference",
      "read_references",
      "add_board",
      "generate_image",
    ],
  );

  await toolset.brief();
  await toolset.declarations();
  assert.equal(of("reference", "findMany").length, 1);
  assert.equal(of("moodboard", "findMany").length, 1);
});

test("an empty project is handed the two tools that need no picture", async () => {
  const { db } = fakeDb([]);
  assert.deepEqual(
    (await referenceToolset({ db, projectId: "p1" }).declarations()).map(
      (tool) => tool.name,
    ),
    ["add_board", "generate_image"],
  );
});

test("the board tools arrive on the round after compose_moodboard files the first one", async () => {
  const { db } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const before = (await toolset.declarations()).map((tool) => tool.name);
  assert.ok(
    !before.includes("inspect_board") && !before.includes("swap_on_board"),
  );

  await run(toolset, "compose_moodboard", {
    intention: "dusk",
    referenceIds: ["a", "b"],
  });

  const after = (await toolset.declarations()).map((tool) => tool.name);
  assert.ok(after.includes("inspect_board") && after.includes("design_page"));
  assert.equal((await toolset.state()).boards, 1);
});

test("a project with boards is handed the tools that read and edit them", async () => {
  const { db } = fakeDb([photo("a")], [board("board-1", ["a"])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  assert.deepEqual(
    (await toolset.declarations()).map((tool) => tool.name),
    [
      "list_references",
      "show_references",
      "crop_reference",
      "discard_reference",
      "read_references",
      "list_boards",
      "get_board_brief",
      "inspect_board",
      "add_page",
      "duplicate_page",
      "resize_page",
      "duplicate_board",
      "set_canvas_background",
      "read_canvas",
      "discard_page",
      "discard_board",
      "design_page",
      "add_board",
      "generate_image",
    ],
  );
});

function titled(id: string, layout: MoodboardLayout, line: string) {
  const composed = composedBoard(id, layout, [["a", "img-1", 1000, 300]]);
  return {
    ...composed,
    elements: [
      ...composed.elements,
      {
        id: "el-text",
        type: "text",
        text: line,
        originalText: line,
        x: 100,
        y: 900,
        width: 600,
        height: 40,
      },
    ] as never,
  };
}

test("reword_on_board rewrites the line in place with no compositor call and nothing else moved", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb([photo("a", { width: 1000, height: 300 })], [
    titled("board-9", split, "Act two exterios"),
  ]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "reword_on_board", {
    boardId: "board-9",
    rewordings: [{ from: "act two exterios", to: "Act two exteriors" }],
  });

  assert.deepEqual(result.reworded, [
    { from: "Act two exterios", to: "Act two exteriors" },
  ]);
  assert.equal(of("agentRun", "create").length, 0);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-9", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);
  assert.equal(data.widthPx, undefined);
  assert.equal(data.title, undefined);

  const written = data.elements as { id: string; text?: string; x: number; width: number }[];
  assert.equal(written.length, 2);
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const drawn = fitInSlot(panel, { id: "a", kind: "image", width: 1000, height: 300 });
  assert.equal(written[0]!.id, "el-0");
  assert.deepEqual(
    { x: written[0]!.x, width: written[0]!.width },
    { x: drawn.x, width: drawn.width },
  );
  assert.equal(written[1]!.text, "Act two exteriors");
  assert.equal(written[1]!.x, 100);

  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption, "1 photograph · 1 line · Split");
});

test("a wording the board does not carry writes nothing and says which", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb([photo("a", { width: 1000, height: 300 })], [
    titled("board-9", split, "Act two"),
  ]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reword_on_board", {
    boardId: "board-9",
    rewordings: [{ from: "Act three", to: "Act four" }],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  assert.deepEqual(result.notOnBoard, ["Act three"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a reword of a board this project does not hold reads nothing", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-9", ["a"])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reword_on_board", {
    boardId: "other-project-board",
    rewordings: [{ from: "Act two", to: "Act three" }],
  });

  assert.match(String(result.error), /no board called other-project-board/);
  const read = of("moodboard", "findFirst")[0]!;
  assert.deepEqual((read.args as { where: unknown }).where, {
    id: "other-project-board",
    projectId: "p1",
  });
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a reword loses to the user's own autosave rather than overwriting it", async () => {
  const split = layoutById("SPLIT")!;
  const row = titled("board-9", split, "Act two");
  const { db } = fakeDb([photo("a", { width: 1000, height: 300 })], [row]);
  const moodboard = (db as unknown as { moodboard: { findFirst: (a: unknown) => unknown } }).moodboard;
  const read = moodboard.findFirst;
  moodboard.findFirst = async (args: unknown) => {
    const answer = await read(args);
    row.revision += 1;
    return answer;
  };
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reword_on_board", {
    boardId: "board-9",
    rewordings: [{ from: "Act two", to: "Act three" }],
  });

  assert.match(String(result.error), /changed while I was editing it/);
});

test("a reword with no usable pair asks for one rather than reading the board twice", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb([photo("a", { width: 1000, height: 300 })], [
    titled("board-9", split, "Act two"),
  ]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reword_on_board", {
    boardId: "board-9",
    rewordings: [{ from: "Act two", to: "  " }],
  });

  assert.match(String(result.error), /to take a line off, use design_page/);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(result.unreadable, 1);
});

test("reword_on_board named a page rewrites that page's line and leaves the same words on the others", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a", { width: 1000, height: 300 })],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 300]], lines: ["THE HEADING"] },
        { id: "page-2", name: "Act two", placed: [], lines: ["THE HEADING"] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "reword_on_board", {
    boardId: "board-7",
    pageId: "page-2",
    rewordings: [{ from: "the heading", to: "ACT TWO" }],
  });

  assert.deepEqual(result.reworded, [{ from: "THE HEADING", to: "ACT TWO" }]);
  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  assert.match(String(result.status), /“Act two”/);
  const [tile] = attachments ?? [];
  assert.deepEqual(tile?.kind === "board" ? tile.lines : [], ["ACT TWO"]);
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(
    (data.elements as { id: string; text?: string }[])
      .filter((element) => element.text)
      .map((element) => [element.id, element.text]),
    [["page-1-txt-0", "THE HEADING"], ["page-2-txt-0", "ACT TWO"]],
  );
});

test("reword_on_board named a page writes nothing for a line on another page", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a", { width: 1000, height: 300 })],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 300]], lines: ["COLD OPEN"] },
        { id: "page-2", name: "Act two", placed: [], lines: ["ACT TWO"] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reword_on_board", {
    boardId: "board-7",
    pageId: "page-2",
    rewordings: [{ from: "cold open", to: "COLD OPENING" }],
  });

  assert.match(String(result.error), /nothing on “Act two” changed/);
  assert.deepEqual(result.notOnBoard, ["cold open"]);
  assert.match(String(result.notOnBoardNote), /another of its pages/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("reword_on_board names the lines its ceiling cut off and the pairs it could not read", async () => {
  const split = layoutById("SPLIT")!;
  const lines = Array.from({ length: REWORD_LIMIT + 1 }, (_, index) => `Act ${index + 1}`);
  const composed = titled("board-9", split, lines[0]!);
  const { db, of } = fakeDb([photo("a", { width: 1000, height: 300 })], [
    {
      ...composed,
      elements: [
        ...composed.elements,
        ...lines.slice(1).map((line, index) => ({
          id: `el-text-${index}`,
          type: "text",
          text: line,
          originalText: line,
          x: 100,
          y: 900 + 60 * (index + 1),
          width: 600,
          height: 40,
        })),
      ] as never,
    },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reword_on_board", {
    boardId: "board-9",
    rewordings: [
      ...lines.map((from) => ({ from, to: `${from} exteriors` })),
      { from: "Act one" },
    ],
  });

  assert.equal((result.reworded as unknown[]).length, REWORD_LIMIT);
  assert.deepEqual(result.notReworded, [
    { from: `Act ${REWORD_LIMIT + 1}`, to: `Act ${REWORD_LIMIT + 1} exteriors` },
  ]);
  assert.match(String(result.notRewordedNote), /call again with them/);
  assert.equal(result.unreadable, 1);
  const written = (of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown } }).data
    .elements as { text?: string }[];
  assert.ok(written.some((element) => element.text === "Act 1 exteriors"));
  assert.ok(written.some((element) => element.text === `Act ${REWORD_LIMIT + 1}`));
});

test("a cut for a board is held to the slot's own shape, not to the nearest name", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [composedBoard("bd1", hero, [["b", "img-1", 1600, 900], ["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "2.39:1",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "3.52:1");
  assert.equal(filedCut(of("reference", "create")).editAspect, "3.52:1");
  assert.equal(result.aspect, "3.52:1");
  assert.match(String(result.heldToSlot), /held to 3\.52:1/);
  assert.match(String(result.heldToSlot), /img-2 slot/);

  const [created] = of("agentRun", "create");
  assert.equal(
    (created!.args as { data: { input: { aspect: string } } }).data.input.aspect,
    "3.52:1",
  );
});

test("a cut for a board with no shape asked for is still held to the slot", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect?: string }).aspect, "3.52:1");
  assert.equal(filedCut(of("reference", "create")).editAspect, "3.52:1");
});

test("a cut for a picture on the board's second page is held to that page's slot", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("bd1", hero, [
        { id: "page-1", name: "Cold open", placed: [["b", "img-2", 1000, 1500]] },
        { id: "page-2", name: "Act two", placed: [["a", "img-2", 1000, 1500]] },
      ]),
    ],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "2.39:1",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "3.52:1");
  assert.equal(result.aspect, "3.52:1");
  assert.match(String(result.heldToSlot), /img-2 slot/);
});

function heroSpread(id: string) {
  return spreadBoard(id, layoutById("HERO_LEFT")!, [
    { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 1500]] },
    { id: "page-2", name: "Act two", placed: [["a", "img-2", 1000, 1500]] },
  ]);
}

test("a cut named a page is held to that page's opening and swaps on that page", async () => {
  const spread = heroSpread("bd1");
  const { db } = fakeDb([photo("a")], [spread]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
    pageId: "page-2",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "3.52:1");
  assert.equal(result.aspect, "3.52:1");
  assert.match(String(result.heldToSlot), /img-2 slot/);
  assert.match(String(result.heldToSlot), /“Act two”/);
  assert.deepEqual(
    spread.elements.flatMap((element) => (element.fileId ? [element.fileId] : [])),
    ["ref:a", "ref:made-1"],
  );
  assert.match(String(result.status), /“Act two”/);
});

test("a cut for the same picture with no page named falls back to reading order", async () => {
  const unpaged = heroSpread("bd1");
  const { db } = fakeDb([photo("a")], [unpaged]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "1.12:1");
  assert.match(String(result.heldToSlot), /img-1 slot/);
  assert.deepEqual(
    unpaged.elements.flatMap((element) => (element.fileId ? [element.fileId] : [])),
    ["ref:made-1", "ref:a"],
  );
});

test("a cut named a page the board has not got is refused with its pages", async () => {
  const { db } = fakeDb([photo("a")], [heroSpread("bd1")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
    pageId: "page-9",
  });

  assert.match(String(result.error), /no page called page-9/);
  assert.deepEqual(
    (result.pages as { pageId: string }[]).map((page) => page.pageId),
    ["page-1", "page-2"],
  );
  assert.equal(asked.length, 0);
});

test("a cut named a page the picture is not on is filed without the board", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("bd1", layoutById("HERO_LEFT")!, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 1000, 1500]] },
        { id: "page-2", name: "Act two", placed: [["b", "img-2", 1000, 1500]] },
      ]),
    ],
  );
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
    pageId: "page-2",
  });

  assert.match(String(result.notOnThatBoard), /not on “Act two”/);
  assert.match(String(result.notOnThatBoard), /a page away/);
  assert.match(
    String(result.notOnThatBoard),
    /the cut was filed and nothing on that board changed/,
  );
  assert.ok(!String(result.notOnThatBoard).includes("will not be put on it"));
  assert.match(String(result.notOnThatBoard), /design_page naming made-1/);
  assert.equal(result.heldToSlot, undefined);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference"],
  );
});

test("a shape the user asked for that is not the slot's is left alone", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "1:1",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "1:1");
  assert.equal(filedCut(of("reference", "create")).editAspect, "1:1");
  assert.equal(result.heldToSlot, undefined);
});

test("a ratio the user named themselves is not replaced by the slot's", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "5:4",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "1.25:1");
  assert.equal(result.heldToSlot, undefined);
});

test("a picture on a hand-arranged board is cut at the shape that was asked for", async () => {
  const { db } = fakeDb([photo("a")], [board("bd1", ["a"], { title: "Ridge" })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "16:9",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "16:9");
  assert.equal(result.heldToSlot, undefined);
});

test("a frame with no recorded size is not held to its slot", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db, of } = fakeDb(
    [photo("a", { width: null, height: null })],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect?: string }).aspect, undefined);
  assert.equal(filedCut(of("reference", "create")).editAspect, "");
  assert.equal(result.heldToSlot, undefined);
});

test("two edits of one board in a round both land, in turn", async () => {
  const fixture = lettered("board-7", ["a", "b"], ["Act two exterrors"]);
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")], [fixture]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const [swap, reword] = await Promise.all([
    run(toolset, "swap_on_board", {
      boardId: "board-7",
      swaps: [{ takeOff: "a", putOn: "c" }],
    }),
    run(toolset, "reword_on_board", {
      boardId: "board-7",
      rewordings: [{ from: "Act two exterrors", to: "Act two exteriors" }],
    }),
  ]);

  assert.equal(swap.result.error, undefined);
  assert.equal(reword.result.error, undefined);

  const writes = of("moodboard", "updateMany");
  assert.equal(writes.length, 2);
  const guards = writes.map((write) => (write.args as { where: { revision: number } }).where.revision);
  assert.deepEqual(guards, [3, 4]);

  const elements = fixture.elements as { type: string; fileId?: string; text?: string }[];
  assert.deepEqual(
    elements.filter((element) => element.type === "image").map((element) => element.fileId),
    ["ref:c", "ref:b"],
  );
  assert.equal(elements.find((element) => element.type === "text")?.text, "Act two exteriors");
});

test("edits of two different boards in a round do not wait for each other", async () => {
  const first = lettered("board-7", ["a", "b"], []);
  const second = lettered("board-8", ["a", "b"], []);
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")], [first, second]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await Promise.all([
    run(toolset, "swap_on_board", { boardId: "board-7", swaps: [{ takeOff: "a", putOn: "c" }] }),
    run(toolset, "swap_on_board", { boardId: "board-8", swaps: [{ takeOff: "b", putOn: "c" }] }),
  ]);

  const guards = of("moodboard", "updateMany").map(
    (write) => (write.args as { where: { id: string; revision: number } }).where,
  );
  assert.deepEqual(guards.map((where) => where.revision), [3, 3]);
  assert.deepEqual(new Set(guards.map((where) => where.id)), new Set(["board-7", "board-8"]));
});

test("a composed board hands the chat the words it was given", async () => {
  const { db } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "caption-1", slotId: "text-1" },
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { attachments } = await run(toolset, "compose_moodboard", {
    intention: "first light",
    referenceIds: ["a", "b"],
    captions: ["ACT ONE"],
  });

  const [tile] = attachments ?? [];
  assert.equal(tile?.kind, "board");
  assert.deepEqual(tile?.kind === "board" && tile.lines, ["ACT ONE"]);
  assert.ok(tile?.caption.includes("1 line"));
});

test("a reworded board hands the chat the words as they now stand", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a", { width: 1000, height: 300 })],
    [titled("b1", split, "ACT ONE")],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { attachments } = await run(toolset, "reword_on_board", {
    boardId: "b1",
    rewordings: [{ from: "act one", to: "ACT TWO" }],
  });

  const [tile] = attachments ?? [];
  assert.deepEqual(tile?.kind === "board" && tile.lines, ["ACT TWO"]);
});

test("a loose shape is framed by the cropper rather than cut to a ratio", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping({
    box: { ymin: 100, xmin: 200, ymax: 900, xmax: 800 },
  });
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the doorway",
    aspect: "square",
  });

  const sent = asked[0] as { aspect?: string; loose?: { id: string }; frame?: { width: number } };
  assert.equal(sent.aspect, undefined);
  assert.equal(sent.loose?.id, "square");
  assert.equal(sent.frame?.width, 4000);

  const filed = filedCut(of("reference", "create"));
  assert.deepEqual(filed.cropBox, [100, 200, 900, 800]);
  assert.equal(filed.editAspect, "square");

  assert.equal(result.aspect, undefined);
  assert.match(String(result.framedAs), /roughly square/);
  assert.match(String(result.framedAs), /came out 1:1/);

  const [created] = of("agentRun", "create");
  assert.equal(
    (created!.args as { data: { input: { aspect: string } } }).data.input.aspect,
    "square",
  );
});

test("a loose ask for a board is held to the slot when the slot is that shape", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "landscape",
    boardId: "bd1",
  });

  const sent = asked[0] as { aspect?: string; loose?: unknown };
  assert.equal(sent.aspect, "3.52:1");
  assert.equal(sent.loose, undefined);
  assert.equal(result.aspect, "3.52:1");
  assert.equal(result.framedAs, undefined);
  assert.match(String(result.heldToSlot), /held to 3\.52:1/);
});

test("a loose ask the slot does not satisfy stays loose", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "square",
    boardId: "bd1",
  });

  const sent = asked[0] as { aspect?: string; loose?: { id: string } };
  assert.equal(sent.aspect, undefined);
  assert.equal(sent.loose?.id, "square");
  assert.equal(result.heldToSlot, undefined);
  assert.match(String(result.framedAs), /roughly square/);
});

const READING = {
  title: "The ridge at dusk",
  colorPalette: ["#1b2a41", "#c9a227"],
  lighting: ["golden-hour"],
  texture: ["fine-grain"],
  composition: ["wide-shot"],
  subject: ["landscape"],
  contrastDepth: ["layered-depth"],
  rationale: "Warm light on cold rock, both read as one plane.",
};

test("the whole analysis comes back, including the two fields no digest carries", async () => {
  const { db, of } = fakeDb([photo("a", { analysis: READING })]);

  const { result, attachments } = await run(
    referenceToolset({ db, projectId: "p1" }),
    "read_references",
    { referenceIds: ["a"] },
  );

  const [read] = result.read as Record<string, unknown>[];
  assert.deepEqual(read!.palette, ["#1b2a41", "#c9a227"]);
  assert.equal(read!.rationale, "Warm light on cold rock, both read as one plane.");
  assert.deepEqual(read!.lighting, ["Golden hour"]);
  assert.deepEqual(read!.contrastDepth, ["Layered depth"]);
  assert.equal("tags" in read!, false);
  assert.equal(read!.title, "The ridge at dusk");
  assert.equal(read!.shape, "4:3");

  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(attachments, undefined);
});

test("a picture with no properties is left out of the answer rather than described in it", async () => {
  const { db } = fakeDb(
    [photo("a", { analysis: READING }), photo("b", { analysis: null })],
    [],
    [{ input: { referenceId: "b" }, status: "FAILED" }],
  );

  const { result } = await run(
    referenceToolset({ db, projectId: "p1" }),
    "read_references",
    { referenceIds: ["a", "b", "ghost"] },
  );

  assert.deepEqual((result.read as { id: string }[]).map((read) => read.id), ["a"]);
  assert.deepEqual(result.notRead, [{ id: "b", mark: "could not be read" }]);
  assert.match(String(result.notReadNote), /do not describe the rest as plain/);
  assert.match(String(result.notReadNote), /properties panel/);
  assert.equal(String(result.notReadNote).includes("read_references"), false);
  assert.deepEqual(result.notFound, ["ghost"]);
});

test("a reading still on its way is named by the mark the model was already shown", async () => {
  const { db } = fakeDb(
    [photo("b", { analysis: null })],
    [],
    [{ input: { referenceId: "b" }, status: "RUNNING" }],
  );

  const { result } = await run(
    referenceToolset({ db, projectId: "p1" }),
    "read_references",
    { referenceIds: ["b"] },
  );

  assert.deepEqual(result.read, []);
  assert.deepEqual(result.notRead, [{ id: "b", mark: "not read yet" }]);
});

test("a drawing the analyzer has not reached still says what it was drawn from", async () => {
  const { db } = fakeDb(
    [
      photo("drawn", {
        analysis: null,
        origin: "GENERATED",
        generationPrompt: "  Warm grey paper texture, lit flat, no grain  ",
      }),
      photo("shot", { analysis: null }),
    ],
    [],
    [{ input: { referenceId: "drawn" }, status: "QUEUED" }],
  );

  const { result } = await run(
    referenceToolset({ db, projectId: "p1" }),
    "read_references",
    { referenceIds: ["drawn", "shot"] },
  );

  assert.deepEqual(result.read, []);
  assert.deepEqual(result.notRead, [
    {
      id: "drawn",
      mark: "not read yet",
      drawnFrom: "Warm grey paper texture, lit flat, no grain",
    },
    { id: "shot", mark: "never read" },
  ]);
  assert.match(String(result.notReadNote), /unless one carries a “drawn from”/);
  assert.match(String(result.drawnFromNote), /what to vary/);
});

test("a drawing that has been read keeps its mark and its description beside the analysis", async () => {
  const { db } = fakeDb([
    photo("drawn", {
      analysis: READING,
      origin: "GENERATED",
      generationPrompt: "Dusk gradient over water",
    }),
  ]);

  const { result } = await run(
    referenceToolset({ db, projectId: "p1" }),
    "read_references",
    { referenceIds: ["drawn"] },
  );

  const [read] = result.read as Record<string, unknown>[];
  assert.equal(read!.made, true);
  assert.equal(read!.drawnFrom, "Dusk gradient over water");
  assert.equal(read!.rationale, "Warm light on cold rock, both read as one plane.");
  assert.equal(result.notRead, undefined);
  assert.match(String(result.drawnFromNote), /what was asked for/);
});

test("the same picture asked about twice in one turn is answered twice", async () => {
  const { db, of } = fakeDb([photo("a", { analysis: READING })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const first = await run(toolset, "read_references", { referenceIds: ["a"] });
  const second = await run(toolset, "read_references", { referenceIds: ["a"] });

  assert.equal((first.result.read as unknown[]).length, 1);
  assert.deepEqual(second.result.read, first.result.read);
  assert.equal(of("reference", "findMany").length, 1);
});

test("the ceiling names the pictures whose properties it did not look up", async () => {
  const ids = Array.from({ length: READ_LIMIT + 2 }, (_, index) => `u${index}`);
  const { db } = fakeDb(ids.map((id) => photo(id, { analysis: READING })));
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "read_references", { referenceIds: ids });
  assert.equal((result.read as unknown[]).length, READ_LIMIT);
  assert.deepEqual(result.notLookedUp, ids.slice(READ_LIMIT));
  assert.match(String(result.notLookedUpNote), /ask for these in another call/);

  const rest = await run(toolset, "read_references", {
    referenceIds: ids.slice(READ_LIMIT),
  });
  assert.deepEqual(
    (rest.result.read as { id: string }[]).map((read) => read.id),
    ids.slice(READ_LIMIT),
  );
});

test("the reader is declared for any project with a picture in it", async () => {
  const read = fakeDb([photo("a", { analysis: READING })]);
  assert.ok(
    (await referenceToolset({ db: read.db, projectId: "p1" }).declarations()).some(
      (tool) => tool.name === "read_references",
    ),
  );

  const empty = fakeDb([]);
  assert.ok(
    !(await referenceToolset({ db: empty.db, projectId: "p1" }).declarations()).some(
      (tool) => tool.name === "read_references",
    ),
  );
});

test("a cut named for cropping is a nudge of it, asked of the frame it came out of", async () => {
  const { db, of } = fakeDb([photo("a"), cut("cut-1", "a", { editAspect: "16:9" })]);
  const { asked, crop } = cropping();
  const seam = cutting();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...seam.deps,
  });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "cut-1",
    intention: "a little wider",
  });

  const ask = asked[0] as { gcsUri: string; previous?: unknown; aspect?: string };
  assert.equal(ask.gcsUri, "gs://director-bucket/uploads/a.jpg");
  assert.deepEqual(ask.previous, { cropBox: [100, 200, 700, 800], editIntent: "the doorway" });
  assert.equal(ask.aspect, "16:9");
  assert.deepEqual(
    seam.cuts.map((made) => made.gcsUri),
    ["gs://director-bucket/uploads/a.jpg"],
  );

  assert.equal(result.referenceId, "made-1");
  assert.equal(result.cutOf, "a");
  assert.equal(filedCut(of("reference", "create")).sourceReferenceId, "a");
  assert.match(String(result.nudgeOf), /cut-1 is untouched/);
  assert.match(String(result.nudgeOf), /filed as a second cut of a/);
  assert.match(String(result.nudgeOf), /discard/);
  assert.ok(!String(result.nudgeOf).includes("offered as a second cut"));
  assert.ok(!String(result.nudgeOf).includes("taking it leaves the old one"));
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "reference" && attachment.referenceId, "made-1");

  const [created] = of("agentRun", "create");
  const input = (created!.args as { data: { input: Record<string, unknown> } }).data.input;
  assert.equal(input.referenceId, "a");
  assert.equal(input.nudgeOf, "cut-1");
  assert.deepEqual(input.previous, { cropBox: [100, 200, 700, 800], editIntent: "the doorway" });
});

test("a shape the user names wins over the shape the cut was filed at", async () => {
  const { db } = fakeDb([photo("a"), cut("cut-1", "a", { editAspect: "16:9" })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  await run(toolset, "crop_reference", {
    referenceId: "cut-1",
    intention: "make it square",
    aspect: "square",
  });

  assert.equal((asked[0] as { aspect?: string }).aspect, undefined);
  assert.equal((asked[0] as { loose?: { id: string } }).loose?.id, "square");
});

test("a nudge of a cut that is on a board takes that cut's place, at that slot's shape", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const standing = composedBoard("bd1", hero, [["cut-1", "img-2", 1000, 1500]]);
  const { db } = fakeDb([photo("a"), cut("cut-1", "a", { editAspect: "2.39:1" })], [standing]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "cut-1",
    intention: "a little more sky",
    boardId: "bd1",
  });

  assert.deepEqual(
    standing.elements.flatMap((element) =>
      element.fileId?.startsWith("ref:") ? [element.fileId] : [],
    ),
    ["ref:made-1"],
  );
  assert.equal((asked[0] as { aspect?: string }).aspect, "3.52:1");
  assert.match(String(result.status), /in place of cut-1/);
});

test("a cut of a frame the board is standing on takes the frame's place", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const held = composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]]);
  const { db } = fakeDb([photo("a")], [held]);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.deepEqual(
    held.elements.flatMap((element) =>
      element.fileId?.startsWith("ref:") ? [element.fileId] : [],
    ),
    ["ref:made-1"],
  );
  assert.match(String(result.status), /in place of the frame/);
});

test("a cut with no recorded box is refused before the read, naming the frame", async () => {
  const { db, of } = fakeDb([photo("a"), cut("cut-1", "a", { cropBox: [] })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "cut-1",
    intention: "a little wider",
  });

  assert.match(String(result.error), /no box to move — crop a/);
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a nudge of a cut on a board names the board when none was passed", async () => {
  const { db, of } = fakeDb(
    [photo("a"), cut("cut-1", "a")],
    [board("bd1", ["cut-1", "other"]), board("bd2", ["unrelated"])],
  );
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "cut-1",
    intention: "tighter on the head",
  });

  const note = String(result.alsoOnBoards);
  assert.match(note, /no board was changed/);
  assert.match(note, /“Board bd1” \(bd1\), which is standing on cut-1/);
  assert.doesNotMatch(note, /bd2/);
  assert.match(note, /call design_page with the cut's id/);
  assert.equal(of("moodboard", "findMany").filter((call) => "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {})).length, 1);
});

test("a crop that was given a board says nothing about standing on one", async () => {
  const { db } = fakeDb([photo("a")], [board("bd1", ["a"])]);
  const { crop } = cropping();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.equal(result.alsoOnBoards, undefined);
  assert.match(String(result.status), /put on “Board bd1”/);
});

test("a crop of a picture on no board reads no scenes and says nothing", async () => {
  const empty = fakeDb([photo("a")]);
  const toolset = referenceToolset({
    db: empty.db,
    projectId: "p1",
    crop: cropping().crop,
    ...cutting().deps,
  });
  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
  });
  assert.equal(result.alsoOnBoards, undefined);
  assert.equal(
    empty
      .of("moodboard", "findMany")
      .filter((call) => "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {})).length,
    0,
  );

  const elsewhere = fakeDb([photo("a"), photo("b")], [board("bd1", ["b"])]);
  const other = referenceToolset({
    db: elsewhere.db,
    projectId: "p1",
    crop: cropping().crop,
    ...cutting().deps,
  });
  const { result: none } = await run(other, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
  });
  assert.equal(none.alsoOnBoards, undefined);
});

test("a crop that refuses before there is a cut reads no scenes", async () => {
  const { db, of } = fakeDb([photo("a", { width: null })], [board("bd1", ["a"])]);
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    crop: cropping().crop,
    ...cutting().deps,
  });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "16:9",
  });

  assert.ok(result.error);
  assert.equal(
    of("moodboard", "findMany").filter(
      (call) => "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {}),
    ).length,
    0,
  );
});

test("discard_reference offers the picture with what it would take with it, and deletes nothing", async () => {
  const { db, of } = fakeDb(
    [photo("a", { title: "Ridge study" }), cut("a1", "a"), cut("a2", "a1"), photo("b")],
    [arranged("board-7", [["a1", 0, 0]]), { ...arranged("board-8", [["b", 0, 0]]), title: "Act two" }],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "a" });

  assert.equal(of("reference", "delete").length, 0);
  assert.equal(of("reference", "update").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  assert.equal(result.referenceId, "a");
  assert.equal(result.title, "Ridge study");
  assert.deepEqual(
    (result.cutsThatWouldGoWithIt as { id: string }[]).map((made) => made.id),
    ["a1", "a2"],
  );
  assert.equal(result.onBoards, undefined);
  assert.deepEqual(result.boardsShowingItsCuts, [{ id: "board-7", title: "Board board-7" }]);
  assert.match(String(result.gap), /design_page/);
  assert.match(String(result.status), /offered, not done/);
  assert.match(String(result.status), /never say the picture is gone, deleted or removed/);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "reference");
  assert.equal(attachment?.kind === "reference" && attachment.referenceId, "a");
  assert.equal(attachment?.kind === "reference" && attachment.discard?.cuts, 2);
  assert.deepEqual(attachment?.kind === "reference" && attachment.discard?.boards, [
    { id: "board-7", title: "Board board-7" },
  ]);
});

test("a cut offered for removal names the frame that stays", async () => {
  const { db } = fakeDb([photo("a"), cut("a1", "a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_reference", { referenceId: "a1" });

  assert.match(String(result.cutOf), /^a — this is a cut/);
  assert.equal(result.cutsThatWouldGoWithIt, undefined);
  assert.equal(result.gap, undefined);
});

test("a cut of a drawn picture reports a drawn picture standing behind it", async () => {
  const { db } = fakeDb([
    photo("a", { origin: "GENERATED" }),
    cut("a1", "a", { origin: "GENERATED" }),
  ]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "a1" });

  assert.match(String(result.cutOf), /^a — this is a cut, and the drawn picture it was cut from/);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "reference" && attachment.origin, "GENERATED");
});

test("a photograph offered for removal says nothing about how it was made", async () => {
  const { db } = fakeDb([photo("a"), cut("a1", "a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "a1" });

  assert.match(String(result.cutOf), /and the photograph it was cut from stays in the gallery/);
  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "reference" && attachment.origin, undefined);
});

test("a picture on a board is named as on it rather than through its cuts", async () => {
  const { db } = fakeDb(
    [photo("a"), cut("a1", "a")],
    [arranged("board-7", [["a", 0, 0], ["a1", 500, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_reference", { referenceId: "a" });

  assert.deepEqual(result.onBoards, [{ id: "board-7", title: "Board board-7" }]);
  assert.equal(result.boardsShowingItsCuts, undefined);
});

test("a removal from a spread names the pages the picture is on", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["b", "img-1", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["a", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_reference", { referenceId: "a" });

  assert.deepEqual(result.onBoards, [
    { id: "board-7", title: "Board board-7", pages: [{ pageId: "page-2", name: "Act two" }] },
  ]);
  assert.match(String(result.pages), /pass that pageId to design_page/);
});

test("a removal from a board of one page says nothing about pages", async () => {
  const { db } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_reference", { referenceId: "a" });

  assert.deepEqual(result.onBoards, [{ id: "board-7", title: "Board board-7" }]);
  assert.equal(result.pages, undefined);
});

test("a project with no boards reads no scenes to offer a removal", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "a" });

  assert.equal(result.referenceId, "a");
  assert.equal(attachments?.length, 1);
  assert.equal(
    of("moodboard", "findMany").filter(
      (call) => "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {}),
    ).length,
    0,
  );
});

test("a picture this project does not hold is not offered for removal", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "z" });

  assert.match(String(result.error), /no reference called z/);
  assert.equal(attachments, undefined);
  assert.equal(of("reference", "delete").length, 0);
});

const pageRender = (boardId: string, pageId: string, revision: number) =>
  `gs://test-bucket/projects/p1/boards/${boardId}/pages/${pageId}@${revision}.png`;

const attachable = () =>
  fakeDb(
    [photo("a"), photo("b"), photo("c", { title: "the doorway" })],
    [
      spreadBoard("board-7", layoutById("SPLIT")!, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );

test("an attached page is described from the stored scene, that page alone", async () => {
  const { db, of } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts, pages } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-2", revision: 3 },
  ]);

  assert.deepEqual(pages, [
    { boardId: "board-7", pageId: "page-2", name: "Act two", rendered: false },
  ]);
  const said = (parts[0] as { text: string }).text;
  assert.match(said, /^The user attached “Act two” — page 2 of 2 of the board “Board board-7”/);
  assert.match(said, /The tools reach it as boardId board-7, pageId page-2\./);
  assert.match(said, /\nc · the doorway · 4:3 · \[\d+,\d+,\d+,\d+\] · Golden_hour, Landscape$/);
  assert.equal(said.includes("\na · "), false);
  const read = of("moodboard", "findMany").find((call) =>
    "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {}),
  );
  assert.deepEqual((read!.args as { where: unknown }).where, {
    id: { in: ["board-7"] },
    projectId: "p1",
  });
});

test("the picture rides only when it is the object this server would have signed for", async () => {
  const { db } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts, pages } = await toolset.attachedPages([
    {
      boardId: "board-7",
      pageId: "page-2",
      revision: 3,
      renderUri: pageRender("board-7", "page-2", 3),
    },
  ]);

  assert.deepEqual(parts[0], {
    fileData: {
      fileUri: "gs://test-bucket/projects/p1/boards/board-7/pages/page-2@3.png",
      mimeType: "image/png",
    },
  });
  assert.match((parts[1] as { text: string }).text, /The image above is that page\./);
  assert.equal(pages[0]!.rendered, true);

  const elsewhere = await toolset.attachedPages([
    {
      boardId: "board-7",
      pageId: "page-2",
      revision: 3,
      renderUri: "gs://someone-elses-bucket/projects/p2/boards/board-1/pages/page-1@3.png",
    },
  ]);
  assert.equal(elsewhere.parts[0]!.fileData, undefined);
});

test("a page whose board has moved since it was drawn goes up as text only", async () => {
  const { db } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts, pages } = await toolset.attachedPages([
    {
      boardId: "board-7",
      pageId: "page-2",
      revision: 2,
      renderUri: pageRender("board-7", "page-2", 2),
    },
  ]);

  assert.equal(parts.length, 1);
  assert.match((parts[0] as { text: string }).text, /There is no picture of it/);
  assert.equal(pages[0]!.rendered, false);
});

test("a pageId naming no page on the board it names is not attached at all", async () => {
  const { db } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts, pages } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-9", revision: 3 },
  ]);

  assert.deepEqual(parts, []);
  assert.deepEqual(pages, []);
});

test("a message carrying more pages than the cap attaches the first two", async () => {
  const { db } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { pages } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-1", revision: 3 },
    { boardId: "board-7", pageId: "page-2", revision: 3 },
    { boardId: "board-7", pageId: "page-1", revision: 3 },
  ]);

  assert.deepEqual(pages.map((page) => page.pageId), ["page-1", "page-2"]);
});

test("an attached page is called composed at a template only while it is standing in it", async () => {
  const spread = spreadBoard("board-7", layoutById("SPLIT")!, [
    { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
    { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
  ]);
  const pulledApart = {
    ...spread,
    elements: spread.elements.map((element) =>
      (element as { id: string }).id === "page-2-el-0"
        ? { ...(element as Record<string, unknown>), y: 400 }
        : element,
    ) as typeof spread.elements,
  };
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")], [pulledApart]);
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-1", revision: 3 },
    { boardId: "board-7", pageId: "page-2", revision: 3 },
  ]);

  assert.match((parts[0] as { text: string }).text, /1920×1080, composed at SPLIT\./);
  const dragged = (parts[1] as { text: string }).text;
  assert.match(dragged, /“Act two” — page 2 of 2 of the board “Board board-7”, 1920×1080\./);
  assert.equal(dragged.includes("composed at"), false);
});

test("a page added to a composed board is not described as composed at the board's template", async () => {
  const { db } = fakeDb(
    [photo("a"), photo("b")],
    [
      spreadBoard("board-7", layoutById("SPLIT")!, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-2", revision: 3 },
  ]);

  const said = (parts[0] as { text: string }).text;
  assert.match(said, /1920×1080\. The tools reach it as boardId board-7, pageId page-2\./);
  assert.match(said, /There is nothing on it\.$/);
  assert.equal(said.includes("composed at"), false);
});

test("an attached page the user resized is described as a size of their own", async () => {
  const split = layoutById("SPLIT")!;
  const theirs = { width: split.page.width * 2, height: split.page.height * 2 };
  const { db } = fakeDb(
    [photo("a")],
    [
      board("board-7", [], {
        layout: split.id,
        elements: [
          pageFrame({ x: 0, y: 0, ...theirs }, { name: "Cold open", makeId: () => "page-7" }),
        ] as never,
      }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-7", revision: 3 },
  ]);

  const said = (parts[0] as { text: string }).text;
  assert.match(said, /3840×2160\./);
  assert.match(said, /That size is the user's own rather than a page preset/);
});

test("an attached page still at a preset says nothing about its size", async () => {
  const { db } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-2", revision: 3 },
  ]);

  assert.equal((parts[0] as { text: string }).text.includes("the user's own"), false);
});

test("a message with no page attached reads no scenes", async () => {
  const { db, of } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([]);

  assert.deepEqual(parts, []);
  assert.equal(of("moodboard", "findMany").length, 0);
});

test("a picture moved to another page comes off the one it was on and the board holds it once", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "move_to_page", {
    boardId: "board-7",
    fromPageId: "page-1",
    toPageId: "page-2",
    referenceIds: ["b"],
  });

  assert.deepEqual(result.moved, ["b"]);
  assert.deepEqual(result.from, { pageId: "page-1", name: "Cold open" });
  assert.deepEqual(result.to, { pageId: "page-2", name: "Act two" });

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = pagesInReadingOrder(boardPages(data.elements));
  const items = boardItems(data.elements as never);
  assert.deepEqual(pageItems(items, pages[0]!).map((item) => item.referenceId), ["a"]);
  assert.deepEqual(
    pageItems(items, pages[1]!).map((item) => item.referenceId).sort(),
    ["b", "c"],
  );
  assert.equal(items.filter((item) => item.referenceId === "b").length, 1);
  const landed = (data.elements as { fileId?: string; frameId?: string }[]).find(
    (element) => element.fileId === "ref:b",
  );
  assert.equal(landed?.frameId, "page-2");

  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
});

test("a move onto a page that was standing in its template offers to lay it out again", async () => {
  const split = layoutById("SPLIT")!;
  const { db } = fakeDb(
    [photo("a"), photo("b"), photo("c"), photo("d")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300], ["d", "img-2", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "move_to_page", {
    boardId: "board-7",
    fromPageId: "page-1",
    toPageId: "page-2",
    referenceIds: ["b"],
  });

  assert.match(String(result.layoutNote), /standing exactly as SPLIT composed it/);
  assert.match(String(result.status), /off “Cold open” and on “Act two”/);
});

test("a picture that is not on the page named is said as that and the board is not written", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "move_to_page", {
    boardId: "board-7",
    fromPageId: "page-1",
    toPageId: "page-2",
    referenceIds: ["c"],
  });

  assert.deepEqual(result.notOnThatPage, ["c"]);
  assert.match(String(result.notOnThatPageNote), /the board may hold them on another of its pages/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a move naming a page the board has not got is refused with its pages", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "move_to_page", {
    boardId: "board-7",
    fromPageId: "page-1",
    toPageId: "page-9",
    referenceIds: ["b"],
  });

  assert.match(String(result.error), /no page called page-9/);
  assert.deepEqual(
    (result.pages as { pageId: string }[]).map((page) => page.pageId),
    ["page-1", "page-2"],
  );
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a move with the same page at both ends is refused", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a"), photo("b"), photo("c")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
        { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "move_to_page", {
    boardId: "board-7",
    fromPageId: "page-1",
    toPageId: "page-1",
    referenceIds: ["b"],
  });

  assert.match(String(result.error), /both ends of that move/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("read_canvas hands back handles, boxes and titles without touching the board", async () => {
  const { db, of } = fakeDb(
    [photo("a", { title: "Dune" }), photo("b", { title: "Ridge" })],
    [arranged("board-7", [["a", 0, 0], ["b", 900, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "read_canvas", { boardId: "board-7" });

  assert.equal(result.boardId, "board-7");
  const objects = result.objects as {
    objectId: string;
    kind: string;
    referenceId: string;
    title?: string;
    box: number[];
    boxUnit: string;
    z: number;
  }[];
  assert.deepEqual(
    objects.map(({ objectId, kind, referenceId, title }) => [objectId, kind, referenceId, title]),
    [
      ["el-0", "image", "a", "Dune"],
      ["el-1", "image", "b", "Ridge"],
    ],
  );
  assert.equal(objects[0]!.boxUnit, "px");
  assert.deepEqual(objects[0]!.box, [0, 0, 300, 400]);
  assert.deepEqual([objects[0]!.z, objects[1]!.z], [0, 1]);

  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(attachments, undefined);
});

test("read_canvas lists a colour block and counts what has no handle", async () => {
  const { db } = fakeDb(
    [photo("a")],
    [
      board("board-7", [], {
        elements: [
          {
            id: "block",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 900,
            height: 600,
            backgroundColor: "#8b2f1d",
            strokeColor: "transparent",
            opacity: 40,
          },
          { id: "pointer", type: "arrow", x: 1000, y: 0, width: 200, height: 10 },
          { id: "scribble", type: "freedraw", x: 1000, y: 200, width: 200, height: 200 },
        ] as never,
      }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "read_canvas", { boardId: "board-7" });

  assert.deepEqual(result.objects, [
    {
      objectId: "block",
      kind: "shape",
      shape: "rectangle",
      fill: "#8b2f1d",
      stroke: "transparent",
      strokeWidth: 1,
      opacity: 40,
      box: [0, 0, 600, 900],
      boxUnit: "px",
      z: 0,
    },
  ]);
  assert.equal(
    result.unaddressable,
    "2 things on this board are not objects you can address: 1 arrow, 1 freehand drawing",
  );
});

test("read_canvas of a page the board has not got refuses with what would have worked", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "read_canvas", { boardId: "board-7", pageId: "ghost" });

  assert.match(String(result.error), /no page called ghost/);
  assert.match(String(result.pagesNote), /no pages/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("put_on_canvas writes a guarded scene edit and hands back the new handle", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("c", { width: 4000, height: 3000 })],
    [arranged("board-7", [["a", 0, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: [{ kind: "image", referenceId: "c", box: [100, 500, 400, 900] }],
  });

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);

  const written = data.elements as {
    id: string;
    fileId?: string;
    status?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  assert.deepEqual(written.map((element) => element.fileId), ["ref:a", "ref:c"]);
  const landed = written[1]!;
  assert.equal(landed.status, "saved");
  assert.deepEqual(
    [landed.y, landed.x, landed.height, landed.width],
    [100, 500, 300, 400],
  );

  const put = result.put as { objectId: string; kind: string }[];
  assert.equal(put[0]!.objectId, landed.id);
  assert.equal(put[0]!.kind, "image");
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind, "board");
});

test("agent 6's put says nothing about the type clamp — the note is one it was never given", async () => {
  const { db } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: [{ kind: "text", text: "AMARA & INES", box: [0, 0, 200, 900] }],
  });

  assert.equal((result.put as unknown[]).length, 1);
  assert.ok(!("typeSet" in result));
  assert.ok(!("typeSetNote" in result));
});

test("agent 6's put breaks the words and says nothing about it", async () => {
  const { db } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: [
      {
        kind: "text",
        text: "Sourced directly from smallholder farms and washed at altitude in the dry season",
        box: [0, 0, 20, 400],
      },
    ],
  });

  assert.equal((result.put as unknown[]).length, 1);
  assert.ok(!("textSet" in result));
  assert.ok(!("textSetNote" in result));

  const { result: read } = await run(toolset, "read_canvas", { boardId: "board-7" });
  const set = (read.objects as Record<string, unknown>[]).find(
    (object) => object.objectId === (result.put as { objectId: string }[])[0]!.objectId,
  )!;
  assert.ok(String(set.text).includes("\n"), "the words were still broken to the box");
});

test("agent 6's put lands type its ground swallows and says nothing about it", async () => {
  const { db } = fakeDb(
    [photo("a")],
    [
      board("board-8", [], {
        elements: [
          {
            id: "pg1",
            type: "frame",
            name: "Page 1",
            x: 0,
            y: 0,
            width: 1080,
            height: 1920,
            customData: { page: true },
          },
          {
            id: "bg1",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 1080,
            height: 1920,
            frameId: "pg1",
            backgroundColor: "#101418",
            fillStyle: "solid",
            strokeColor: "transparent",
            customData: { pageBackground: true },
          },
        ] as never,
      }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-8",
    objects: [
      { kind: "text", text: "Amara & Ines", pageId: "pg1", box: [400, 100, 460, 900], colour: "#1e2329" },
    ],
  });

  assert.equal((result.put as unknown[]).length, 1);
  assert.ok(!("cannotBeRead" in result));
  assert.ok(!("cannotBeReadNote" in result));
});

test("agent 6's resize stops at the type floor and says nothing about it", async () => {
  const copy =
    "Sourced directly from smallholder farms and washed at altitude in the dry season";
  const { db } = fakeDb(
    [photo("a")],
    [
      board("board-7", [], {
        elements: [
          {
            id: "t1",
            type: "text",
            text: copy,
            originalText: copy,
            autoResize: false,
            fontSize: 20,
            x: 0,
            y: 0,
            width: 600,
            height: 25,
          },
        ] as never,
      }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "transform_on_canvas", {
    boardId: "board-7",
    changes: [{ objectId: "t1", size: [10, 240] }],
  });

  assert.deepEqual(result.transformed, ["t1"]);
  assert.ok(!("typeSet" in result));
  assert.ok(!("typeSetNote" in result));

  const { result: read } = await run(toolset, "read_canvas", { boardId: "board-7" });
  const line = (read.objects as Record<string, unknown>[]).find(
    (object) => object.objectId === "t1",
  )!;
  assert.ok(String(line.text).includes("\n"), "the words re-broke to the box the type no longer fills");
});

test("put_on_canvas lands a shape, and read_canvas reads it back as the shape that was asked for", async () => {
  const { db } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: [
      {
        kind: "shape",
        shape: "rectangle",
        box: [0, 0, 400, 600],
        fill: "#ffcc00",
        opacity: 40,
      },
    ],
  });

  const put = result.put as { objectId: string; kind: string }[];
  assert.equal(put[0]!.kind, "shape");

  const { result: read } = await run(toolset, "read_canvas", { boardId: "board-7" });
  const shape = (read.objects as Record<string, unknown>[]).find(
    (object) => object.objectId === put[0]!.objectId,
  )!;
  assert.equal(shape.kind, "shape");
  assert.equal(shape.shape, "rectangle");
  assert.equal(shape.fill, "#ffcc00");
  assert.equal(shape.stroke, "transparent");
  assert.equal(shape.opacity, 40);
});

test("put_on_canvas refuses a picture outside the project before the write", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: [{ kind: "image", referenceId: "ghost" }],
  });

  assert.match(String(result.error), /nothing joined/);
  assert.deepEqual(result.notInThisProject, ["ghost"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("remove_from_canvas takes every copy of a reference and names what matched nothing", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [arranged("board-7", [["a", 0, 0], ["a", 900, 0], ["b", 450, 400]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "remove_from_canvas", {
    boardId: "board-7",
    objects: ["a", "ghost"],
  });

  assert.deepEqual(result.removed, [{ object: "a", kind: "reference", count: 2 }]);
  assert.deepEqual(result.notOnBoard, ["ghost"]);
  assert.match(String(result.notOnBoardNote), /read_canvas/);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const written = (write.args as { data: { elements: { fileId?: string }[] } }).data.elements;
  assert.deepEqual(written.map((element) => element.fileId), ["ref:b"]);
});

test("remove_from_canvas that matches nothing writes nothing", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "remove_from_canvas", {
    boardId: "board-7",
    objects: ["ghost"],
  });

  assert.match(String(result.error), /nothing came off/);
  assert.deepEqual(result.notOnBoard, ["ghost"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("transform_on_canvas moves an object and names the id that was not one", async () => {
  const { db, of } = fakeDb(
    [photo("a")],
    [arranged("board-7", [["a", 0, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "transform_on_canvas", {
    boardId: "board-7",
    changes: [
      { objectId: "el-0", to: [500, 600] },
      { objectId: "ghost", to: [5, 5] },
    ],
  });

  assert.deepEqual(result.transformed, ["el-0"]);
  assert.deepEqual(result.notOnBoard, ["ghost"]);
  assert.match(String(result.notOnBoardNote), /read_canvas/);
  assert.equal(of("agentRun", "create").length, 0);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  const moved = (data.elements as { id: string; x: number; y: number }[]).find(
    (element) => element.id === "el-0",
  )!;
  assert.deepEqual([moved.y, moved.x], [500, 600]);
});

test("a transform to where the object already stands writes nothing", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "transform_on_canvas", {
    boardId: "board-7",
    changes: [{ objectId: "el-0", to: [0, 0] }],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  assert.deepEqual(result.unchanged, ["el-0"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a page cannot be rotated, and the reason is said rather than the change skipped", async () => {
  const split = layoutById("SPLIT")!;
  const { db, of } = fakeDb(
    [photo("a")],
    [
      spreadBoard("board-7", split, [
        { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300]] },
      ]),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "transform_on_canvas", {
    boardId: "board-7",
    changes: [{ objectId: "page-1", angle: 30 }],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  const [refusal] = result.refused as { objectId: string; reason: string }[];
  assert.equal(refusal!.objectId, "page-1");
  assert.match(refusal!.reason, /cannot rotate/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a board saved by the user mid-transform is refused rather than overwritten", async () => {
  const row = arranged("board-7", [["a", 0, 0]]);
  const { db } = fakeDb([photo("a")], [row]);
  const read = db.moodboard.findFirst;
  db.moodboard.findFirst = (async (args: never) => {
    const board = await read(args);
    row.revision = 4;
    return board;
  }) as typeof db.moodboard.findFirst;
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "transform_on_canvas", {
    boardId: "board-7",
    changes: [{ objectId: "el-0", to: [500, 600] }],
  });

  assert.match(String(result.error), /changed while I was moving things on it/);
});

test("changes past the transform cap are reported back, never silently dropped", async () => {
  const placed = Array.from(
    { length: 11 },
    (_, index): [string, number, number] => ["a", index * 150, 0],
  );
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", placed)]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "transform_on_canvas", {
    boardId: "board-7",
    changes: Array.from({ length: 11 }, (_, index) => ({
      objectId: `el-${index}`,
      to: [600, index * 150],
    })),
  });

  assert.equal((result.transformed as string[]).length, 10);
  assert.deepEqual(result.notTransformed, ["el-10"]);
  assert.match(String(result.notTransformedNote), /call again with them/);
  assert.equal(of("moodboard", "updateMany").length, 1);
});

test("restyle_on_canvas repaints an object and names the field the kind does not take", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "restyle_on_canvas", {
    boardId: "board-7",
    changes: [
      { objectId: "el-0", opacity: 40, font: "display" },
      { objectId: "ghost", opacity: 40 },
    ],
  });

  assert.deepEqual(result.restyled, [
    {
      objectId: "el-0",
      set: ["opacity"],
      refused: ["font is a text block's, and this is an image"],
    },
  ]);
  assert.deepEqual(result.notOnBoard, ["ghost"]);
  assert.match(String(result.notOnBoardNote), /read_canvas/);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  const painted = (data.elements as { id: string; opacity: number }[]).find(
    (element) => element.id === "el-0",
  )!;
  assert.equal(painted.opacity, 40);
});

test("a restyle to how the object already looks writes nothing", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const first = await run(toolset, "restyle_on_canvas", {
    boardId: "board-7",
    changes: [{ objectId: "el-0", opacity: 40 }],
  });
  assert.equal((first.result.restyled as unknown[]).length, 1);

  const { result } = await run(toolset, "restyle_on_canvas", {
    boardId: "board-7",
    changes: [{ objectId: "el-0", opacity: 40 }],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  assert.deepEqual(result.unchanged, ["el-0"]);
  assert.equal(of("moodboard", "updateMany").length, 1);
});

test("a board saved by the user mid-restyle is refused rather than overwritten", async () => {
  const row = arranged("board-7", [["a", 0, 0]]);
  const { db } = fakeDb([photo("a")], [row]);
  const read = db.moodboard.findFirst;
  db.moodboard.findFirst = (async (args: never) => {
    const board = await read(args);
    row.revision = 4;
    return board;
  }) as typeof db.moodboard.findFirst;
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "restyle_on_canvas", {
    boardId: "board-7",
    changes: [{ objectId: "el-0", opacity: 40 }],
  });

  assert.match(String(result.error), /changed while I was restyling it/);
});

test("changes past the restyle cap are reported back, never silently dropped", async () => {
  const placed = Array.from(
    { length: 11 },
    (_, index): [string, number, number] => ["a", index * 150, 0],
  );
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", placed)]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "restyle_on_canvas", {
    boardId: "board-7",
    changes: Array.from({ length: 11 }, (_, index) => ({
      objectId: `el-${index}`,
      opacity: 40,
    })),
  });

  assert.equal((result.restyled as unknown[]).length, 10);
  assert.deepEqual(result.notRestyled, ["el-10"]);
  assert.match(String(result.notRestyledNote), /call again with them/);
  assert.equal(of("moodboard", "updateMany").length, 1);
});

test("reorder_on_canvas restacks by array order and regenerates the moved element's index", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [
      board("board-7", [], {
        elements: [
          { id: "el-0", type: "image", fileId: "ref:a", x: 0, y: 0, width: 400, height: 300, index: "a0" },
          { id: "el-1", type: "image", fileId: "ref:b", x: 50, y: 50, width: 400, height: 300, index: "a1" },
        ] as never,
      }),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reorder_on_canvas", {
    boardId: "board-7",
    moves: [{ objectId: "el-0", to: "front" }],
  });

  assert.deepEqual(result.reordered, ["el-0"]);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const written = (write.args as { data: { elements: { id: string; index?: string }[] } }).data
    .elements;
  assert.deepEqual(written.map((element) => element.id), ["el-1", "el-0"]);
  assert.equal("index" in written[1]!, false);
  assert.equal(written[0]!.index, "a1");
});

test("front on the frontmost writes nothing", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [arranged("board-7", [["a", 0, 0], ["b", 50, 50]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reorder_on_canvas", {
    boardId: "board-7",
    moves: [{ objectId: "el-1", to: "front" }],
  });

  assert.match(String(result.error), /nothing on that board changed/);
  assert.deepEqual(result.unchanged, ["el-1"]);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a reorder move naming no destination or two is counted rather than guessed at", async () => {
  const { db, of } = fakeDb(
    [photo("a"), photo("b")],
    [arranged("board-7", [["a", 0, 0], ["b", 50, 50]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "reorder_on_canvas", {
    boardId: "board-7",
    moves: [{ objectId: "el-0" }, { objectId: "el-0", to: "front", above: "el-1" }],
  });

  assert.match(String(result.error), /exactly one destination/);
  assert.equal(result.unreadable, 2);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

test("a copy made in the same round as a canvas transform copies the moved board", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await Promise.all([
    run(toolset, "transform_on_canvas", {
      boardId: "board-7",
      changes: [{ objectId: "el-0", to: [500, 600] }],
    }),
    run(toolset, "duplicate_board", { boardId: "board-7" }),
  ]);

  const [created] = of("moodboard", "create");
  const copied = (created!.args as { data: { elements: { x: number; y: number }[] } }).data
    .elements;
  assert.deepEqual([copied[0]!.y, copied[0]!.x], [500, 600]);
});


const GENERATE_USAGE = { promptTokens: 40, outputTokens: 1490, totalTokens: 1530 };

function pngBytes(width: number, height: number) {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return new Uint8Array(header);
}

function drawing(answer: Partial<GeneratedImage> = {}) {
  const asked: unknown[] = [];
  const generate = async (input: unknown) => {
    asked.push(input);
    return {
      model: MODELS.IMAGE,
      mimeType: "image/png",
      bytes: pngBytes(1376, 768),
      attempts: 1,
      usage: GENERATE_USAGE,
      ...answer,
    } as GeneratedImage;
  };
  return { asked, generate: generate as never };
}

function filing(gcsUri = "gs://director-bucket/projects/p1/references/made.png") {
  const stored: { contentType: string; bytes: Uint8Array }[] = [];
  const kicks: number[] = [];
  const thumbKicks: { referenceId: string; bytes: Uint8Array }[] = [];
  return {
    stored,
    kicks,
    thumbKicks,
    storeImage: async (contentType: string, bytes: Uint8Array) => {
      stored.push({ contentType, bytes });
      return gcsUri;
    },
    kickAnalyzer: () => kicks.push(1),
    kickThumbnail: (referenceId: string, bytes: Uint8Array) =>
      void thumbKicks.push({ referenceId, bytes }),
  };
}

test("a generated picture is stored, filed as a reference and queued for reading", async () => {
  const { db, of } = fakeDb([]);
  const { asked, generate } = drawing();
  const { stored, kicks, thumbKicks, storeImage, kickAnalyzer, kickThumbnail } = filing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, storeImage, kickAnalyzer, kickThumbnail });

  const { result, attachments } = await run(toolset, "generate_image", {
    description: "A warm grey paper texture, lit flat, no grain",
    aspect: "16:9",
  });

  assert.deepEqual(asked, [
    {
      description: "A warm grey paper texture, lit flat, no grain",
      shape: { label: "16:9", shape: { label: "16:9", ratio: 16 / 9 }, loose: null },
    },
  ]);

  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.contentType, "image/png");
  assert.equal(kicks.length, 1);
  assert.equal(thumbKicks.length, 1);
  assert.equal(thumbKicks[0]!.referenceId, result.imageId);
  assert.equal(thumbKicks[0]!.bytes, stored[0]!.bytes);

  const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(written.projectId, "p1");
  assert.equal(written.origin, "GENERATED");
  assert.equal(written.generationPrompt, "A warm grey paper texture, lit flat, no grain");
  assert.equal(written.title, "A warm grey paper texture");
  assert.equal(written.width, 1376);
  assert.equal(written.height, 768);

  assert.equal(of("$transaction", "run").length, 1);
  const job = (of("agentRun", "create")[1]!.args as { data: Record<string, unknown> }).data;
  assert.equal(job.agent, "ANALYZER");
  assert.equal(job.status, "QUEUED");
  assert.deepEqual(job.input, { referenceId: result.imageId });

  assert.equal(result.title, "A warm grey paper texture");
  assert.equal(result.width, 1376);
  assert.equal(result.height, 768);
  assert.match(String(result.status), /made rather than found/);
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind, "reference");
  assert.equal(tile?.referenceId, result.imageId);
});

test("a generation writes its own run row and what it spent", async () => {
  const { db, of } = fakeDb([]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  await run(toolset, "generate_image", { description: "a dusk gradient", aspect: "landscape" });

  const opened = (of("agentRun", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(opened.agent, "IMAGE_GENERATOR");
  assert.equal(opened.status, "RUNNING");
  assert.deepEqual(opened.input, {
    prompt: "a dusk gradient",
    aspect: "Landscape",
    via: "orchestrator",
  });

  const closed = of("agentRun", "update")[0]!;
  assert.equal((closed.args as { data: Record<string, unknown> }).data.status, "SUCCEEDED");
  assert.deepEqual(spentOf(closed), {
    model: MODELS.IMAGE,
    promptTokens: 40,
    outputTokens: 1490,
    totalTokens: 1530,
  });
});

test("a refused generation fails its run row and carries the tokens", async () => {
  const { db, of } = fakeDb([]);
  const refusal = Object.assign(new ImageGeneratorError("the image model would not draw that: no"), {
    usage: GENERATE_USAGE,
  });
  const generate = (async () => {
    throw refusal;
  }) as never;
  const { stored, kicks, storeImage, kickAnalyzer, kickThumbnail } = filing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, storeImage, kickAnalyzer, kickThumbnail });

  const { result } = await run(toolset, "generate_image", { description: "a face" });

  assert.match(String(result.error), /would not draw that/);
  const failed = of("agentRun", "update")[0]!;
  assert.equal((failed.args as { data: Record<string, unknown> }).data.status, "FAILED");
  assert.deepEqual(spentOf(failed), {
    model: MODELS.IMAGE,
    promptTokens: 40,
    outputTokens: 1490,
    totalTokens: 1530,
  });
  assert.equal(of("reference", "create").length, 0);
  assert.equal(stored.length, 0);
  assert.equal(kicks.length, 0);
});

test("a generation the service never answered is refused in words, with the page on the row", async () => {
  const { db, of } = fakeDb([]);
  const unreached = Object.assign(
    new ImageGeneratorError(
      "the drawing service is busy and did not answer, so there is no picture — tell the user it could not be drawn just now and offer to try again",
    ),
    {
      usage: GENERATE_USAGE,
      detail: "vertex 404 (retryable): <html><title>Error 404 (Not Found)</title></html>",
    },
  );
  const generate = (async () => {
    throw unreached;
  }) as never;
  const { stored, kicks, storeImage, kickAnalyzer, kickThumbnail } = filing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, storeImage, kickAnalyzer, kickThumbnail });

  const { result } = await run(toolset, "generate_image", { description: "a paper texture" });

  assert.match(String(result.error), /busy and did not answer/);
  assert.doesNotMatch(String(result.error), /html/i);

  const failed = of("agentRun", "update")[0]!;
  const data = (failed.args as { data: Record<string, unknown> }).data;
  assert.equal(data.status, "FAILED");
  assert.match(String(data.error), /^vertex 404 \(retryable\)/);
  assert.deepEqual(spentOf(failed), {
    model: MODELS.IMAGE,
    promptTokens: 40,
    outputTokens: 1490,
    totalTokens: 1530,
  });
  assert.equal(of("reference", "create").length, 0);
  assert.equal(stored.length, 0);
  assert.equal(kicks.length, 0);
});


test("the turn's generations are capped", async () => {
  const { db, of } = fakeDb([]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  for (let asked = 0; asked < GENERATE_CALL_LIMIT; asked += 1) {
    const { result } = await run(toolset, "generate_image", { description: `a wash ${asked}` });
    assert.ok(result.imageId, JSON.stringify(result));
  }

  const { result } = await run(toolset, "generate_image", { description: "one more wash" });
  assert.match(String(result.error), new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`));
  assert.equal(of("reference", "create").length, GENERATE_CALL_LIMIT);
});

test("a turn whose generations were all refused is capped without claiming a picture", async () => {
  const { db, of } = fakeDb([]);
  const refusal = Object.assign(new ImageGeneratorError("the image model would not draw that: no"), {
    usage: GENERATE_USAGE,
  });
  const generate = (async () => {
    throw refusal;
  }) as never;
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  for (let asked = 0; asked < GENERATE_CALL_LIMIT; asked += 1) {
    const { result } = await run(toolset, "generate_image", { description: `a face ${asked}` });
    assert.match(String(result.error), /would not draw that/);
  }

  const { result } = await run(toolset, "generate_image", { description: "one more face" });
  assert.match(String(result.error), /none of them could be drawn/);
  assert.ok(!String(result.error).includes("what you drew"));
  assert.equal(of("agentRun", "create").length, GENERATE_CALL_LIMIT);
  assert.equal(of("reference", "create").length, 0);
});

test("a capped turn counts the pictures it filed rather than the calls it spent", async () => {
  const { db } = fakeDb([]);
  const answers = [
    () => {
      throw Object.assign(new ImageGeneratorError("the image model would not draw that: no"), {
        usage: GENERATE_USAGE,
      });
    },
    () => ({
      model: MODELS.IMAGE,
      mimeType: "image/png",
      bytes: pngBytes(1376, 768),
      attempts: 1,
      usage: GENERATE_USAGE,
    }),
  ];
  const generate = (async () => answers.shift()!()) as never;
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const refused = await run(toolset, "generate_image", { description: "a face" });
  assert.match(String(refused.result.error), /would not draw that/);
  const drawn = await run(toolset, "generate_image", { description: "a wash" });
  assert.ok(drawn.result.imageId);

  const { result } = await run(toolset, "generate_image", { description: "another wash" });
  assert.match(String(result.error), /1 of them was drawn/);
  assert.match(String(result.error), /show the user what you did draw/);
});

test("an unreadable aspect is refused before anything is spent", async () => {
  const { db, of } = fakeDb([]);
  const { asked, generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const { result } = await run(toolset, "generate_image", {
    description: "a wash",
    aspect: "widescreen-ish",
  });

  assert.match(String(result.error), /is not a shape a picture can be drawn at/);
  assert.deepEqual(asked, []);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a generation with nothing to draw is refused", async () => {
  const { db, of } = fakeDb([]);
  const { asked, generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const { result } = await run(toolset, "generate_image", { description: "   " });

  assert.match(String(result.error), /say what the picture should show/);
  assert.deepEqual(asked, []);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a picture made this turn is on the canvas in the same turn", async () => {
  const { db, of } = fakeDb([], [arranged("board-7", [])]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const made = await run(toolset, "generate_image", { description: "a paper texture" });
  const imageId = String(made.result.imageId);

  const { result } = await run(toolset, "put_on_canvas", {
    boardId: "board-7",
    objects: [{ kind: "image", referenceId: imageId, box: [0, 0, 300, 400] }],
  });

  assert.equal(result.error, undefined);
  assert.equal((result.put as { objectId: string }[]).length, 1);
  const write = of("moodboard", "updateMany")[0]!;
  const elements = (write.args as { data: { elements: { fileId?: string }[] } }).data.elements;
  assert.deepEqual(elements.map((element) => element.fileId), [`ref:${imageId}`]);
  assert.equal(of("reference", "findMany").length, 1);
});

test("a second picture named like the first is numbered against the turn's own list", async () => {
  const { db, of } = fakeDb([]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const first = await run(toolset, "generate_image", {
    description: "A warm grey paper texture, lit flat",
  });
  const second = await run(toolset, "generate_image", {
    description: "A warm grey paper texture, but bluer",
  });

  assert.equal(first.result.title, "A warm grey paper texture");
  assert.equal(second.result.title, "A warm grey paper texture (2)");
  const written = of("reference", "create").map(
    (call) => (call.args as { data: { title: string } }).data.title,
  );
  assert.deepEqual(written, ["A warm grey paper texture", "A warm grey paper texture (2)"]);
  assert.equal(of("reference", "findMany").length, 1);
});

test("a picture is named clear of the photographs already in the project", async () => {
  const { db } = fakeDb([photo("p-1", { title: "A warm grey paper texture" })]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const { result } = await run(toolset, "generate_image", {
    description: "A warm grey paper texture, lit flat",
  });

  assert.equal(result.title, "A warm grey paper texture (2)");
});

test("the picture an empty project was given brings the rest of the tools with it", async () => {
  const { db } = fakeDb([]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  assert.deepEqual((await toolset.declarations()).map((tool) => tool.name), [
    "add_board",
    "generate_image",
  ]);

  await run(toolset, "generate_image", { description: "a paper texture" });

  const after = (await toolset.declarations()).map((tool) => tool.name);
  assert.ok(after.includes("list_references") && after.includes("show_references"), after.join());
  assert.deepEqual(await toolset.state(), {
    photographs: 1,
    crops: 0,
    boards: 0,
    generated: 1,
  });
});

test("a picture that did not come back at the shape asked for says so", async () => {
  const { db } = fakeDb([]);
  const { generate } = drawing({ bytes: pngBytes(1024, 1024) });
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const { result } = await run(toolset, "generate_image", {
    description: "a scope-shaped wash",
    aspect: "2.39:1",
  });

  assert.equal(result.aspect, "2.39:1");
  assert.match(String(result.drawnAt), /1024×1024, which is not 2\.39:1/);
});

test("a picture that could not be stored is not filed", async () => {
  const { db, of } = fakeDb([]);
  const { generate } = drawing();
  const toolset = referenceToolset({
    db,
    projectId: "p1",
    generate,
    storeImage: async () => {
      throw new Error("bucket said no");
    },
    kickAnalyzer: () => {},
  });

  const { result } = await run(toolset, "generate_image", { description: "a wash" });

  assert.match(String(result.error), /could not be stored/);
  assert.equal(of("reference", "create").length, 0);
  const failed = of("agentRun", "update")[0]!;
  assert.equal((failed.args as { data: Record<string, unknown> }).data.status, "FAILED");
  assert.equal(spentOf(failed).totalTokens, 1530);
});

test("a picture whose row could not be written is refused with its cost recorded", async () => {
  const { db, of } = fakeDb([]);
  const { generate } = drawing();
  const { stored, kicks, storeImage, kickAnalyzer, kickThumbnail } = filing();
  const broken = {
    ...(db as unknown as Record<string, unknown>),
    $transaction: async () => {
      throw new Error("could not serialize access");
    },
  } as unknown as PrismaClient;
  const toolset = referenceToolset({
    db: broken,
    projectId: "p1",
    generate,
    storeImage,
    kickAnalyzer,
    kickThumbnail,
  });

  const { result, attachments } = await run(toolset, "generate_image", { description: "a wash" });

  assert.match(String(result.error), /could not be filed/);
  assert.equal(result.imageId, undefined);
  assert.equal(attachments, undefined);
  assert.equal(stored.length, 1);
  assert.equal(kicks.length, 0);

  const failed = of("agentRun", "update")[0]!;
  assert.equal((failed.args as { data: Record<string, unknown> }).data.status, "FAILED");
  assert.equal(spentOf(failed).totalTokens, 1530);
});

test("add_board files a board with one empty page and decides nothing", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "add_board", {
    title: "a moodboard for the ridge",
  });

  assert.equal(result.boardId, "board-1");
  assert.equal(result.title, "a moodboard for the ridge");
  assert.equal(of("agentRun", "create").length, 0);

  const { data } = of("moodboard", "create")[0]!.args as {
    data: { widthPx: number; heightPx: number; layout?: string; elements: unknown[] };
  };
  assert.equal(data.widthPx, 1920);
  assert.equal(data.heightPx, 1080);
  assert.equal(data.layout, undefined);

  const pages = boardPages(data.elements);
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.name, "Page 1");
  assert.equal((result.page as { pageId: string }).pageId, pages[0]!.id);
  assert.match(String(result.status), /call design_page/);

  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-1");
});

test("add_board takes the shape the user asked for, and the name they gave the page", async () => {
  const { db, of } = fakeDb([]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "add_board", {
    title: "the gate sign",
    preset: "PORTRAIT_HD",
    pageName: "Act two",
  });

  const { data } = of("moodboard", "create")[0]!.args as {
    data: { widthPx: number; heightPx: number; elements: unknown[] };
  };
  assert.equal(data.widthPx, 1080);
  assert.equal(data.heightPx, 1920);
  const [page] = boardPages(data.elements);
  assert.equal(page!.width, 1080);
  assert.equal(page!.height, 1920);
  assert.equal(page!.name, "Act two");
  assert.equal((result.page as { name: string }).name, "Act two");
});

test("add_board falls back to landscape for a preset it was not given", async () => {
  for (const args of [{}, { preset: "TABLOID" }]) {
    const { db, of } = fakeDb([]);
    const toolset = referenceToolset({ db, projectId: "p1" });
    await run(toolset, "add_board", args);
    const { data } = of("moodboard", "create")[0]!.args as {
      data: { widthPx: number; heightPx: number };
    };
    assert.deepEqual({ w: data.widthPx, h: data.heightPx }, { w: 1920, h: 1080 }, JSON.stringify(args));
  }
});

test("add_board names the board after the intention, or falls back rather than filing an empty name", async () => {
  const { db, of } = fakeDb([]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "add_board", {});
  await run(toolset, "add_board", { title: "   " });

  for (const call of of("moodboard", "create")) {
    const { data } = call.args as { data: { title: string } };
    assert.equal(data.title, "Composed board");
  }
});

test("the board tools arrive on the round after add_board files the first one", async () => {
  const { db } = fakeDb([photo("a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const before = (await toolset.declarations()).map((tool) => tool.name);
  assert.ok(!before.includes("design_page") && !before.includes("inspect_board"), before.join());

  const { result } = await run(toolset, "add_board", { title: "dusk" });

  const after = (await toolset.declarations()).map((tool) => tool.name);
  assert.ok(after.includes("design_page") && after.includes("inspect_board"), after.join());
  assert.equal((await toolset.state()).boards, 1);

  const brief = await run(toolset, "get_board_brief", { boardId: String(result.boardId) });
  assert.equal(brief.result.error, undefined, JSON.stringify(brief.result));
  assert.match(String(brief.result.board), /dusk/);
});

const designed = (
  boardId: string,
  over: Partial<DesignPageAnswer> = {},
): DesignPageAnswer => ({
  line: "done",
  boardId,
  boardTitle: "Ridge Study",
  calls: [],
  runId: "run-8",
  report: { pages: [], placed: [], lines: [], background: null },
  scene: {
    board: {
      id: boardId,
      title: "Ridge Study",
      widthPx: 1920,
      heightPx: 1080,
      layout: null,
      layoutSlots: null,
    },
    elements: [],
  },
  ...over,
});

function designing(answer: Partial<DesignPageAnswer & { error: string; runId: string }> = {}) {
  const asked: Record<string, unknown>[] = [];
  const design = (async (args: Record<string, unknown>) => {
    asked.push(args);
    if (typeof answer.error === "string") {
      return { error: answer.error, ...(answer.runId && { runId: answer.runId }) };
    }
    return designed(String(args.boardId ?? ""), {
      line: "The sign reads across the top third, with the two portraits under it.",
      calls: ["read_canvas", "put_on_canvas"],
      ...answer,
    });
  }) as unknown as typeof designPage;
  return { asked, design };
}

test("design_page hands agent 8 the ask as agent 6 was given it", async () => {
  const { db } = fakeDb([photo("a"), photo("b")], [board("board-7", ["a"])]);
  const { asked, design } = designing();
  const toolset = referenceToolset({ db, projectId: "p1", design });

  const { result } = await run(toolset, "design_page", {
    boardId: "  board-7 ",
    pageId: " pg-2 ",
    intention: "  a welcome sign for the gate  ",
    imageIds: ["a", "b"],
    newPage: true,
  });

  const { budget, ...handed } = asked[0]!;
  assert.deepEqual(handed, {
    db,
    projectId: "p1",
    boardId: "board-7",
    pageId: "pg-2",
    intention: "  a welcome sign for the gate  ",
    imageIds: ["a", "b"],
    newPage: true,
  });
  assert.deepEqual(budget, { generations: { asked: 0, filed: 0 }, crops: { asked: 0, filed: 0 } });
  assert.match(String(result.line), /reads across the top third/);
  assert.deepEqual(result.designed, ["read_canvas", "put_on_canvas"]);
});

test("design_page passes only the arguments it was given", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { asked, design } = designing();
  const toolset = referenceToolset({ db, projectId: "p1", design });

  await run(toolset, "design_page", { boardId: "board-7", intention: "a poster", imageIds: [] });

  assert.deepEqual(Object.keys(asked[0]!).sort(), [
    "boardId",
    "budget",
    "db",
    "intention",
    "projectId",
  ]);
});

test("a designed page comes back with a tile of the board as the design left it", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { design } = designing();
  const toolset = referenceToolset({ db, projectId: "p1", design });

  await run(toolset, "inspect_board", { boardId: "board-7" });
  const { result, attachments } = await run(toolset, "design_page", {
    boardId: "board-7",
    intention: "a welcome sign",
  });

  assert.equal(result.boardId, "board-7");
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");
  assert.equal(of("moodboard", "findFirst").length, 1);
});

test("the design's answer carries the read of the page it left", async () => {
  const { db } = fakeDb([photo("a"), photo("b")], [board("board-7", ["a"])]);
  const { design } = designing({
    pageId: "pg-1",
    report: {
      page: {
        pageId: "pg-1",
        name: "Act two",
        position: 1,
        of: 2,
        width: 1920,
        height: 1080,
        preset: "LANDSCAPE_HD",
        pictures: 1,
        lines: 1,
        shapes: 0,
        clipped: 0,
      },
      placed: [{ referenceId: "a", clipped: false }],
      lines: ["ACT TWO"],
      background: "bg-1",
      notPlaced: ["b"],
      looseOnBoard: ["c"],
      made: { generated: ["drawn-1"], cropped: ["cut-1"] },
    },
  });
  const toolset = referenceToolset({ db, projectId: "p1", design });

  const { result } = await run(toolset, "design_page", {
    boardId: "board-7",
    intention: "a welcome sign",
    imageIds: ["a", "b"],
  });

  assert.equal(result.pageId, "pg-1");
  assert.equal(result.boardTitle, "Ridge Study");
  assert.deepEqual(result.placed, [{ referenceId: "a", clipped: false }]);
  assert.deepEqual(result.lines, ["ACT TWO"]);
  assert.equal(result.background, "bg-1");
  assert.equal((result.page as { name: string }).name, "Act two");

  assert.deepEqual(result.notPlaced, ["b"]);
  assert.match(String(result.notPlacedNote), /leaving one off is a decision/);
  assert.deepEqual(result.looseOnBoard, ["c"]);
  assert.match(String(result.looseOnBoardNote), /not part of the page that was designed/);
  assert.deepEqual(result.made, { generated: ["drawn-1"], cropped: ["cut-1"] });
  assert.match(String(result.madeNote), /say it was made/);
});

test("a fresh page the design made is named in the answer", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { design } = designing({ pageId: "pg-new" });
  const toolset = referenceToolset({ db, projectId: "p1", design });

  const { result } = await run(toolset, "design_page", {
    boardId: "board-7",
    intention: "a poster for the exteriors as well",
    newPage: true,
  });

  assert.equal(result.pageId, "pg-new");
});

test("ids agent 8 could not find and a design that ran out of rounds are both said", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { design } = designing({ notFound: ["gone"], stopped: "rounds" });
  const toolset = referenceToolset({ db, projectId: "p1", design });

  const { result } = await run(toolset, "design_page", {
    boardId: "board-7",
    intention: "a welcome sign",
    imageIds: ["a", "gone"],
  });

  assert.deepEqual(result.notFound, ["gone"]);
  assert.match(String(result.notFoundNote), /do not write about those pictures/);
  assert.equal(result.stopped, "rounds");
  assert.match(String(result.stoppedNote), /what really landed rather than what was intended/);
});

test("four designs in one turn all run, and spend one picture budget between them", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { generate } = drawing();
  const asked: { generations: { asked: number; filed: number } }[] = [];
  const design = (async ({ budget }: { budget: { generations: { asked: number; filed: number } } }) => {
    asked.push(budget);
    const room = budget.generations.filed < GENERATE_CALL_LIMIT;
    if (room) {
      budget.generations.asked += 1;
      budget.generations.filed += 1;
    }
    return designed("board-7", { calls: room ? ["generate_image"] : [] });
  }) as unknown as typeof designPage;
  const toolset = referenceToolset({ db, projectId: "p1", generate, design, ...filing() });

  const pages = [];
  for (const intention of ["a poster", "a banner", "a cover", "a sign"]) {
    pages.push(await run(toolset, "design_page", { boardId: "board-7", intention }));
  }

  for (const page of pages) {
    assert.equal(page.result.error, undefined, JSON.stringify(page.result));
  }
  assert.equal(asked.length, 4);

  assert.ok(asked.every((budget) => budget.generations === asked[0]!.generations));
  assert.deepEqual(asked[0]!.generations, { asked: GENERATE_CALL_LIMIT, filed: GENERATE_CALL_LIMIT });

  const { result } = await run(toolset, "generate_image", { description: "one more wash" });
  assert.match(String(result.error), new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`));
});

test("a design refused above the run row leaves the turn where it was", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const asked: Record<string, unknown>[] = [];
  const design = (async (args: Record<string, unknown>) => {
    asked.push(args);
    return args.boardId === "board-7"
      ? designed("board-7")
      : { error: `no board called ${args.boardId} in this project` };
  }) as unknown as typeof designPage;
  const toolset = referenceToolset({ db, projectId: "p1", design });

  const refused = await run(toolset, "design_page", { boardId: "board-9", intention: "a sign" });
  assert.match(String(refused.result.error), /no board called board-9/);

  const again = await run(toolset, "design_page", { boardId: "board-7", intention: "a sign" });
  assert.equal(again.result.error, undefined);
  assert.equal(asked.length, 2);
});

test("a design holds the board's queue until it is finished", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const order: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const design = (async (args: Record<string, unknown>) => {
    order.push("design started");
    await held;
    order.push("design finished");
    return designed(String(args.boardId));
  }) as unknown as typeof designPage;
  const toolset = referenceToolset({ db, projectId: "p1", design });

  const both = Promise.all([
    run(toolset, "design_page", { boardId: "board-7", intention: "a sign" }),
    run(toolset, "add_page", { boardId: "board-7" }).then(() => order.push("page added")),
  ]);
  release();
  await both;

  assert.deepEqual(order, ["design started", "design finished", "page added"]);
});

test("a design is handed what the turn has already spent", async () => {
  const { db } = fakeDb([], [board("board-7", [])]);
  const { generate } = drawing();
  const { asked, design } = designing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, design, ...filing() });

  const drawn = await run(toolset, "generate_image", { description: "a paper texture" });
  assert.ok(drawn.result.imageId, JSON.stringify(drawn.result));

  await run(toolset, "design_page", { boardId: "board-7", intention: "a welcome sign" });

  assert.deepEqual(asked[0]!.budget, {
    generations: { asked: 1, filed: 1 },
    crops: { asked: 0, filed: 0 },
  });
});

test("a picture the design drew is a picture the turn has spent", async () => {
  const { db, of } = fakeDb([], [board("board-7", [])]);
  const { generate } = drawing();
  const design = (async ({ budget }: { budget: { generations: { asked: number; filed: number } } }) => {
    budget.generations.asked = GENERATE_CALL_LIMIT;
    budget.generations.filed = GENERATE_CALL_LIMIT;
    return designed("board-7", { calls: ["generate_image"] });
  }) as unknown as typeof designPage;
  const toolset = referenceToolset({ db, projectId: "p1", generate, design, ...filing() });

  await run(toolset, "design_page", { boardId: "board-7", intention: "a welcome sign" });

  const { result } = await run(toolset, "generate_image", { description: "one more wash" });
  assert.match(String(result.error), new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`));
  assert.equal(of("reference", "create").length, 0);
});

test("a cut the design made is a cut the turn has spent", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { crop } = cropping();
  const design = (async ({ budget }: { budget: { crops: { asked: number; filed: number } } }) => {
    budget.crops.asked = CROP_CALL_LIMIT;
    budget.crops.filed = CROP_CALL_LIMIT;
    return designed("board-7", { calls: ["crop_image"] });
  }) as unknown as typeof designPage;
  const toolset = referenceToolset({ db, projectId: "p1", crop, design, ...cutting().deps });

  await run(toolset, "design_page", { boardId: "board-7", intention: "a welcome sign" });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the hands",
  });
  assert.match(String(result.error), new RegExp(`already filed ${CROP_CALL_LIMIT} cuts`));
  assert.equal(of("agentRun", "create").length, 0);
});
