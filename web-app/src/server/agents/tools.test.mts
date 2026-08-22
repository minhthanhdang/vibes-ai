import { test } from "node:test";
import assert from "node:assert/strict";

import { referenceToolset } from "./tools";
import type { DesignPageAnswer, designPage } from "@/server/agents/designer/design";
import {
  CROP_CALL_LIMIT,
  DESIGN_CALL_LIMIT,
  DESIGN_CEILING_SAID,
  GENERATE_CALL_LIMIT,
  READ_LIMIT,
  REWORD_LIMIT,
  SHOWN_LIMIT,
  SWAP_LIMIT,
} from "@/lib/agent/agent-tools";
/// Through the alias, not through `./cropper`: the executor imports it that
/// way, and under the test runner the two specifiers resolve to two copies of
/// the module — so an error built from the relative one is not `instanceof` the
/// class the executor is checking against.
import { CropperError } from "@/server/agents/cropper";
import { LayoutReaderError } from "@/server/agents/layout-reader";
import { ImageGeneratorError } from "@/server/agents/image-generator";
import { customLayoutColumns, layoutFromBoxes } from "@/lib/layout/custom-layout";
import { MODELS } from "@/server/google/vertex";
import { ObjectTooLargeError } from "@/server/google/storage";
import { PAGE_GAP, fitInSlot, layoutById } from "@/lib/layout/moodboard-layouts";
import { boardPages, pageFrame, pageItems, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageContents } from "@/lib/pages/page-contents";
import { boardItems } from "@/lib/boards/board-contents";
import type { MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { THUMBNAIL_CONTENT_TYPE, thumbnailBox } from "@/lib/intake/thumbnail";
import { referencesOwedCopies } from "@/lib/intake/reference-derived";
import { forDisplay } from "@/server/references/display";
import { hashFileContent } from "@/lib/intake/content-hash";
import type { CropperResult } from "./cropper";
import type { CompositorResult } from "./compositor";
import type { Cut } from "@/server/references/cut";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import type { GeneratedImage } from "./image-generator";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/// The executor half of the tool seam: the part that reads the project, spends
/// the model calls and writes the rows. Everything under it is pure and tested
/// elsewhere, so what this file asserts is the three things only the executor
/// knows — what a tool costs, what it writes, and what of the database it lets
/// out to the model.

type Call = { table: string; op: string; args: Record<string, unknown> };

type Row = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  editAspect: string;
  /// The region a cut was taken from, in the model's own 0-1000 numbers. Empty on
  /// a photograph, and what a nudge of a cut is asked about.
  cropBox: number[];
  /// The user's star, as the column holds it. On the fixture rather than left
  /// undefined because it is the one field here they wrote themselves, and a
  /// falsy-by-omission column tests nothing about the one that is set.
  isFavorite: boolean;
  gcsUri: string;
  thumbGcsUri: string | null;
  source: { id: string; title: string } | null;
  /// Agent 2's row as the tools select it. Every field optional because a test
  /// about the catalog names two dimensions and leaves the rest out — the two
  /// that only `read_references` reads are the palette and the rationale.
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
  /// Where the bytes came from, and on a drawing the description behind them.
  /// Optional because nearly every row in this file is a photograph, and a
  /// fixture that said so on all of them would be saying nothing.
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

/// A cut of a frame: a reference in every respect, plus the box it was taken at
/// and the shape it was asked to be.
function cut(id: string, frameId: string, over: Partial<Row> = {}): Row {
  return photo(id, {
    source: { id: frameId, title: frameId },
    editIntent: "the doorway",
    cropBox: [100, 200, 700, 800],
    ...over,
  });
}

/// A board as the rebuild path reads it: the revision it is guarded on and the
/// scene the pictures already on it are read out of.
type BoardRow = {
  id: string;
  title: string;
  revision: number;
  widthPx: number;
  heightPx: number;
  /// The template it was last composed at, null for one dragged together by hand.
  layout: string | null;
  /// The geometry behind a `CUSTOM` id — the page the user handed in as an image.
  /// Absent on every board composed at one of the ten templates, which is what
  /// `CUSTOM` is distinguished from.
  layoutSlots?: unknown;
  /// Derived from the scene by every write to it, which is why the fixture
  /// derives it too rather than letting a test hand-count its own frames.
  pageCount: number;
  /// Derived the same way and in the same reading order the priming says them
  /// in, so a fixture cannot name pages the scene it carries does not have.
  pageNames: string[];
  elements: { id: string; type: string; fileId?: string }[];
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

/// A recorder, not a database. Every assertion is about what the executor sent,
/// so the fake answers with whatever the test handed it and keeps the calls.
function fakeDb(
  rows: readonly Row[],
  boardRows: readonly BoardRow[] = [],
  /// The analyzer's own rows, newest first, read only when a photograph has no
  /// analysis to show for itself.
  analyzerRuns: readonly { input: unknown; status: string }[] = [],
  /// The project row itself — what the user called the work and what they
  /// wrote it was for. Two columns nothing but the priming reads.
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
      /// A generated picture's row, answered in the shape the executor selected
      /// it in — the tools' own columns, so what comes back can be folded
      /// straight into the turn's memoized read.
      create: record("reference", "create", (args) => {
        const written = args.data as Record<string, unknown>;
        /// A cut names the frame it came out of, and the columns that make it a
        /// version are selected straight back — a filed cut that folded into the
        /// turn's read as a photograph would be one the next round can neither
        /// nudge nor tell apart from its frame.
        const frameId = written.sourceReferenceId as string | undefined;
        return photo(`made-${++made}`, {
          title: String(written.title ?? ""),
          width: (written.width as number | undefined) ?? null,
          height: (written.height as number | undefined) ?? null,
          gcsUri: String(written.gcsUri ?? ""),
          thumbGcsUri: (written.thumbGcsUri as string | undefined) ?? null,
          analysis: null,
          /// Written by the executor and selected back by it, so the fold into
          /// the turn's read carries them: without these the picture drawn this
          /// turn reads as one the user brought for the rest of it.
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
      /// A copy, the way a read is: the row the executor holds is what the
      /// database said a moment ago, and a test that moves the stored row under
      /// it must not move the copy it is guarding on.
      findFirst: record("moodboard", "findFirst", (args) => {
        const where = args.where as { id: string };
        const row = boardRows.find((entry) => entry.id === where.id);
        return row ? { ...row } : null;
      }),
      /// Unguarded, the way the user's own rename is: the title is not part
      /// of the document an open tab is autosaving.
      update: record("moodboard", "update", (args) => {
        const where = args.where as { id: string };
        const data = args.data as { title: string };
        const row = boardRows.find((entry) => entry.id === where.id);
        return { id: where.id, title: data.title ?? row?.title };
      }),
      /// Answered in the shape the executor selected it in — the columns the
      /// turn's own boards read is made of, so what comes back can be folded
      /// straight into it, exactly as a filed reference is.
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
      /// Counts the way a guarded update does: a row whose revision has moved is
      /// no row at all, which is how the losing writer finds out. And it *lands*
      /// the write, because a second edit in the same turn reads the row back —
      /// a recorder that only counts would let two edits of one board each read
      /// the board as it was before either of them.
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
        hit.revision += 1;
        return { count: 1 };
      }),
    },
  };

  /// The transaction the row and its analyzer job land in, as a fake keeps one:
  /// the same recorder, handed to the callback. What a test asserts is that both
  /// writes were made through it, not that Postgres rolled anything back.
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

/// The catalog half of a primed turn, by line. A brief now opens with a block
/// of the user's own — what they called the project and what they wrote it
/// was for — so a test about a photograph's line reads the block that holds it
/// rather than counting from the top of the instruction.
/// The columns a cut was filed under, off the write the tool made — what used
/// to be readable on the offer it handed back.
const filedCut = (calls: Call[]) => (calls[0]!.args as { data: Record<string, unknown> }).data;

const catalogOf = (brief: string) => (brief.split("\n\n")[1] ?? "").split("\n");

const BOX = { ymin: 200, xmin: 200, ymax: 800, xmax: 800 };

/// What one photograph read comes to, and what one text call comes to. The
/// numbers are arbitrary; that they are *different* is the point, since the
/// thing worth asserting is that a crop's row and a board's row do not end up
/// carrying each other's.
const CROP_USAGE = { promptTokens: 1800, outputTokens: 120, totalTokens: 1920 };
const COMPOSE_USAGE = { promptTokens: 900, outputTokens: 60, totalTokens: 960 };
/// And what one page read comes to. Different again for the same reason: a
/// compose that read a layout image pays for two calls, and the only way to see
/// that neither row carries the other's tokens is for the two numbers to differ.
const READ_USAGE = { promptTokens: 2600, outputTokens: 180, totalTokens: 2780 };

/// The four columns a run row records a spend in, off whatever write put them
/// there.
const spentOf = (write: { args: unknown }) => {
  const { model, promptTokens, outputTokens, totalTokens } = (
    write.args as { data: Record<string, unknown> }
  ).data;
  return { model, promptTokens, outputTokens, totalTokens };
};

/// One answer, or one per read with the last standing for the reads after it —
/// which is what a turn whose second cut is refused and whose first is not needs
/// to be written down at all.
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

/// The codec and the bucket a filed cut goes through, as a test holds them.
///
/// Nothing is decoded here. Which pixels a region names is arithmetic shared
/// with the browser and tested against real bytes in `cut.test.mts`; what this
/// file is about is that the tool asked for the right region of the right frame,
/// stored what came back, and filed a row from it.
///
/// Typed against the codec's own `Cut` rather than cast past the compiler, the
/// way the model-call fakes above are: those stand in for an answer the network
/// gives, while this one stands in for a function in this repo — and it is the
/// only description of that function any test of this file has. A shape that
/// drifted from `cut.ts` would leave every crop here passing against a cut the
/// server can no longer make.
function cutting(
  size = { width: 2400, height: 1800 },
  /// What the codec says the cut came out as, which is the frame's own encoding
  /// for everything but a PNG. Defaulted rather than derived, because the fake
  /// decodes nothing: only the tests about what reaches the bucket care.
  contentType: Cut["contentType"] = "image/jpeg",
) {
  const cuts: { gcsUri: string; region: unknown }[] = [];
  const stored: { contentType: string; bytes: Uint8Array }[] = [];
  const kicks: number[] = [];
  const put = async (contentType: string, bytes: Uint8Array) => {
    stored.push({ contentType, bytes });
    return `gs://director-bucket/projects/p1/references/cut-${stored.length}.jpg`;
  };
  /// The codec's rule and not a flag of this fake's own: a cut already inside
  /// the box comes back without a copy, because there is nothing to downscale.
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
    /// Present only on an edit to a board that is keeping its arrangement: what
    /// is already seated, and therefore not open to assignment.
    inPlace?: { slotId: string; id: string }[];
    /// Present only when the board holds more than one page, or when this compose
    /// is adding one: which page of it is being laid out (§V).
    page?: { name?: string; page: string; board?: string; fresh?: true };
  }[] = [];
  const compose = async (input: unknown) => {
    asked.push(input as never);
    return { model: "gemini-pro", assignments, note, usage: COMPOSE_USAGE } as CompositorResult;
  };
  return { asked, compose: compose as never };
}

/// The boxes a page of two photographs over a line is drawn with, in the
/// reader's own 0-1000 y-first numbers.
const PAGE_BOXES = [
  { box: [60, 60, 520, 480], kind: "image" },
  { box: [60, 520, 520, 940], kind: "image" },
  { box: [580, 60, 700, 940], kind: "text" },
];

/// The layout reader, injected. What it answers with is a *validated* layout, so
/// the fake builds one through `layoutFromBoxes` rather than hand-writing slots —
/// otherwise a test of the executor would be asserting against a page the agent
/// could never have returned.
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

/// The user's own statement of what the work is, which sat in a column
/// nothing read while the header rendered it above the chat. It opens the
/// priming because every line under it is read against it.
test("the user's brief reaches the model, off two small columns", async () => {
  const { db, of } = fakeDb([photo("a")], [], [], {
    title: "Cold open",
    brief: "Night exteriors, sodium light, nothing lit from the front.",
  });
  const brief = await referenceToolset({ db, projectId: "p1" }).brief();

  assert.match(brief, /^This project is called “Cold open”\./);
  assert.match(brief, /Night exteriors, sodium light, nothing lit from the front\./);
  assert.match(brief, /You cannot write or change the brief/);

  /// Never the whole row: `libraryItems` alone is a project's saved excalidraw
  /// groups, which is the same megabytes-per-turn argument the boards read makes.
  const [read] = of("project", "findUnique");
  assert.deepEqual((read!.args as { select: Record<string, unknown> }).select, {
    title: true,
    brief: true,
  });
});

/// One read for the whole turn, like the references and the boards: the brief is
/// asked for once and the answer is the one the tools were built against.
test("the project is read once however many times the turn asks", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await toolset.brief();
  await toolset.brief();
  await toolset.declarations();
  await run(toolset, "list_references");

  assert.equal(of("project", "findUnique").length, 1);
});

/// Priming the turn is the read the tools were going to make anyway. If it were
/// a second query the round it saves would be paid for in latency, and worse,
/// the model could be handed one list and have its ids resolved against another.
test("the brief comes off the same read the tools use", async () => {
  const { db, of } = fakeDb([photo("a"), photo("cut", { source: { id: "a", title: "a" } })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  await run(toolset, "show_references", { referenceIds: ["a"] });

  assert.equal(of("reference", "findMany").length, 1);
  /// The project's own name first — the user's word for the work — then the
  /// photographs by line and the cuts by count, the count being the only reason
  /// left to spend a round on list_references.
  assert.match(brief, /^This project is called “p1”\./);
  assert.match(brief, /The project holds 1 photograph: 1 cut has been made of them\.\na · a · 4:3/);
  assert.ok(!brief.includes("gs://"), brief);
});

/// The door to every picture, so the crops are in the answer nobody argued
/// about. Left out only when the call says to leave them out — a cut missing
/// from a list that says it is the project reads as a cut that is not there.
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

/// The star already decided the order the model is shown the gallery in. Read
/// off the same row it sorts by, it becomes a fact the model can act on rather
/// than an ordering it cannot see the reason for.
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

/// Agent 4 decides which picture the board is *about* — the largest slot — and
/// the user has already answered that question with a star. Without it on
/// the block, that judgement is made from tags a machine read while the
/// user's own answer sits one column away.
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

/// The analyzer runs out of band, so the turn right after an upload talks about
/// photographs whose tags have not landed. Before this the brief was silent
/// about that, which reads as a photograph with nothing in it.
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

/// A second query, and the only one here a turn can be spared entirely: a
/// project agent 2 has finished with has no blank line to explain.
test("the analyzer runs are not read when every picture has been read", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  await run(toolset, "list_references");

  assert.equal(of("agentRun", "findMany").length, 0);
  assert.equal(brief.includes("property analyzer"), false);
});

/// The one door that lists cuts, and a cut filed a moment ago is as unread as a
/// photograph uploaded a moment ago. The digest's mark is a word; the note is
/// what says what to do about it.
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

  /// The photographs alone are all read, so that answer says nothing about it.
  const photosOnly = (await run(toolset, "list_references", { includeCrops: false })).result as {
    unreadNote?: string;
  };
  assert.equal(photosOnly.unreadNote, undefined);
});

/// A run past the cap, or a reference that predates the queue, has no row to
/// answer with — and "nobody ever offered this to agent 2" is what that is.
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

/// The other half of "what it asked for and what appeared". An id that answers to
/// nothing has always been reported; one that answers to a real picture and did
/// not survive the strip's limit used to appear in neither list, so a reply could
/// describe twelve pictures beside eight.
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

  /// The uri reaches agent 3 from the row, not from anything the model wrote.
  assert.equal((asked[0] as { gcsUri: string }).gcsUri, "gs://director-bucket/uploads/a.jpg");
  /// And the *original* is what is cut, never the thumbnail: a crop of a 640px
  /// copy throws away the resolution the crop was made to keep.
  /// The region cut is the box *after* it was opened out to 16:9, not the one
  /// the cropper answered with — a cut filed as 16:9 that is not 16:9 would be
  /// worse than no cut.
  assert.deepEqual(seam.cuts, [
    {
      gcsUri: "gs://director-bucket/uploads/a.jpg",
      region: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
    },
  ]);
  /// The cut and its grid-sized copy, both stored before the row was written —
  /// a cut filed this way lands complete rather than owing a thumbnail.
  assert.deepEqual(
    seam.stored.map((entry) => entry.contentType),
    ["image/jpeg", "image/jpeg"],
  );
  assert.equal(seam.kicks.length, 1);

  assert.match(String(result.status), /cut and filed as a version of a/);
  /// The frame is the other half of that sentence: what was cropped is a version
  /// beside the original, and a model told only that a cut was filed is a model
  /// that may report the user's photograph as having been changed.
  assert.match(String(result.status), /frame it came out of is untouched/);
  /// The way out, in the sentence that announces the cut: a cut nobody wanted
  /// now costs a row rather than nothing.
  assert.match(String(result.status), /discard_reference/);
  /// And the reply is told which of the two words to use, because "offered" is
  /// what this tool's answer said for as long as it had nothing to show.
  assert.match(String(result.status), /made rather than offered/);
  /// The answer is about the row that did not exist when the call was made.
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
  /// The analyzer job is in the same transaction as the row: a reference with no
  /// job is one the panel offers to analyze by hand.
  assert.equal(of("$transaction", "run").length, 1);
  assert.equal(of("agentRun", "create").length, 2);

  /// An ordinary reference tile, because there are real bytes now.
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
  /// The filed row on the run, which is what the ledger could never say while
  /// this tool ended at an offer.
  assert.equal(data.output.referenceId, "made-1");
  /// What the ask cost, on the row: a box got right first time and one reached
  /// on the third read are the same crop and not the same bill.
  assert.equal(data.output.attempts, 2);
  /// And what the reads came to, in columns rather than in `output`: this is the
  /// one thing about a run that is summed across every row of a project, and a
  /// sum over JSON is a sum the database cannot do.
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...CROP_USAGE });
});

/// The one reading the retirement of the crop tile left with nowhere else to go.
/// While the chat drew an offer, how much of the frame a box keeps and how big
/// that is in pixels were under the picture the user was deciding on; the tile is
/// gone and the row is filed by the time the model writes, so the caption reaches
/// the model or it reaches nobody — and a cut that keeps 4% of a screenshot is
/// the one the user most needs told.
test("the answer says what the cut keeps, since nothing draws it any more", async () => {
  const { db } = fakeDb([photo("a")]);
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...cutting().deps });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the middle sunflower",
    aspect: "16:9",
  });

  /// The three readings of the box the panel's review card is judged on, off the
  /// 4000 × 3000 frame and the region the cut was taken at.
  assert.equal(result.size, "16:9 · Keeps 48% of the frame · About 3200 × 1800 px");
  /// And nowhere else: the status names the row and the way out of it, not the
  /// shape of what was kept, so dropping this key would lose the reading rather
  /// than say it twice.
  const { size, ...rest } = result as Record<string, unknown>;
  assert.ok(size);
  assert.ok(!JSON.stringify(rest).includes("Keeps"));
  assert.ok(!JSON.stringify(rest).includes(" px"));
});

/// The other half of "a cut lands complete": a cut small enough to be its own
/// thumbnail is complete without one. `needsDerivedCopy` reads the same box off
/// the same two columns, so the workspace's sweep leaves this row alone rather
/// than fetching it back to make a copy of something already inside the box.
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
  /// One object in the bucket, not two.
  assert.equal(seam.stored.length, 1);
  const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(written.thumbGcsUri, undefined);
  assert.equal(written.width, 480);
  assert.equal(written.height, 320);
});

/// And the sweep itself agrees, which is the claim the two tests above only
/// imply. `useDerivedReferenceCopies` reads every reference of the project and
/// fetches back the ones that owe a grid-sized copy; a cut is the one row the
/// chat files that is never in that set, because the frame had to be decoded to
/// cut it and the copy is one more resize in a pass already paid for. A drawn
/// picture is the contrast: same door, same transaction, and it lands owing one.
///
/// Read through `forDisplay`, since `hasThumbnail` is what the browser is
/// answered with and `thumbGcsUri` is what the tool writes — the two claims are
/// only the same claim through that mapping.
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

  /// The cut small enough to be its own thumbnail owes nothing for the other
  /// reason: `thumbnailBox` is the same box on both sides of the seam, so the row
  /// the codec left without a copy is not one the sweep would make one for.
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

/// Which bytes the digest is of, and that it is the digest the other door
/// writes. Nothing reads a version's `contentHash` — both lookups are asked of
/// originals only — so the column is only ever compared against itself, which is
/// exactly the kind of value that can be wrong for a year without a symptom.
/// The cut's bytes, not the thumbnail's: a row claiming the identity of its own
/// 640px copy would be a photograph indistinguishable from every other cut small
/// enough to be its own thumbnail.
test("the cut is filed under the digest of the cut, not of its copy", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { crop } = cropping();
  const seam = cutting();
  const toolset = referenceToolset({ db, projectId: "p1", crop, ...seam.deps });

  await run(toolset, "crop_reference", { referenceId: "a", intention: "the middle sunflower" });

  /// Copied into a blob the way the browser's canvas hands one over. Through
  /// `hashFileContent` rather than `hashBytes` because the claim is about the
  /// panel: a cut the user frames by hand is hashed off the `File` the canvas
  /// wrote, and the same crop filed by the assistant has to land under the same
  /// 64 characters.
  const asFile = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]);
  const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(written.contentHash, await hashFileContent(asFile(seam.stored[0]!.bytes)));
  assert.notEqual(written.contentHash, await hashFileContent(asFile(seam.stored[1]!.bytes)));
});

/// What the bucket is told the bytes are. `cropOutputType` keeps a PNG a PNG —
/// a screenshot cut down to one panel is still flat colour with hard edges, and
/// re-encoding it as a JPEG is the one conversion that makes a picture visibly
/// worse — while the grid-sized copy is a JPEG whatever the cut is. Two objects,
/// two answers, and the type is recorded only here: the tile is served under the
/// `Content-Type` this call stored, and nothing downstream reads the bytes back
/// to correct it.
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

/// The expensive case is the one that answers with nothing. A ledger that only
/// counted the successes would say a bad afternoon was cheap.
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
  /// The error names no model — the cropper only ever calls one — so the column
  /// is filled from the same constant the agent reads.
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

/// The spec asks for "a specific ratio, or loose square/rectangle" and the
/// declaration used to offer six names. A user asking for a print format got
/// the nearest of the six and was told nothing about the substitution.
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

  /// Cut at 1.25:1, not at the 4:3 that is nearest to it — and the cropper is
  /// told the shape it is framing for, in the one spelling everything downstream
  /// reads back, down to the column the row is filed under.
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

/// The other half of widening the vocabulary: a string that is not a shape at
/// all used to be dropped, and the cut was then framed around the subject under
/// a reply saying it was held to the format the user asked for.
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
  /// It names what is readable, so the correction costs a sentence rather than a
  /// round spent guessing at the spelling.
  assert.match(String(result.error), /16:9/);
  /// Both vocabularies, since either could be the one they meant.
  assert.match(String(result.error), /square\/landscape/);
  assert.equal(asked.length, 0);
  /// And nothing was filed for a call that never reached the cropper.
  assert.equal(of("agentRun", "create").length, 0);
});

/// The crop→board loop's last turn, removed. A cut asked for a board is cut,
/// filed and put in the frame's place by the one call — so the model is told the
/// swap is already made, rather than being sent back for a third turn to make a
/// call that is free but not roundless.
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

  /// The cut is on the board by the time this answers — no click, no second
  /// turn — and the frame it came out of is off it.
  assert.deepEqual(
    rows[0]!.elements.map((element) => element.fileId),
    ["ref:made-1", "ref:b"],
  );
  /// Through the same guarded write every other scene edit goes through.
  assert.equal(of("moodboard", "updateMany").length, 1);
  assert.match(String(result.status), /put on “Ridge”/);
  /// The board branch carries the same two clauses as the plain one: the frame
  /// survived the swap it was taken off, and the row is discardable by id.
  assert.match(String(result.status), /frame itself is untouched/);
  assert.match(String(result.status), /discard_reference on made-1/);
  assert.equal(result.notOnThatBoard, undefined);
  assert.equal(result.notPutOnBoard, undefined);

  /// The cut first, then the board it changed: the reply is written beside both
  /// things that happened.
  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference", "board"],
  );
});

/// The other boards standing on the frame are the answer to a cut nobody said
/// where to put. Said here they would be a contradiction: `standingOnNote` opens
/// "this cut is filed and no board was changed", which stops being true the
/// moment the swap above lands. With a board given there are only two ways this
/// goes, and both are already answered — the swap, or `notOnThatBoard`.
///
/// The guard is a bill as well as a sentence. What that note is built from is a
/// read of every board's `elements`, the one column priming refuses because it
/// is megabytes; a crop that named its board pays for none of it.
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
  /// Coast is still standing on the frame and is not named.
  assert.equal(result.alsoOnBoards, undefined);
  assert.equal(of("moodboard", "findMany").length, 0);
});

/// The cut is still worth having — the user asked for it — so the board is
/// dropped rather than the crop refused. What must not happen silently is the
/// swap never coming.
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
  /// What happened, rather than what will not: the cut is a row before the board
  /// is ever looked at, so the sentence this answer used to carry — true of a
  /// tool that could only offer — would now name the wrong outcome twice over.
  assert.match(
    String(result.notOnThatBoard),
    /the cut was filed and nothing on that board changed/,
  );
  assert.ok(!String(result.notOnThatBoard).includes("will not be put on it"));
  /// Named with the call that would close it, now that the cut is a row a swap
  /// can name.
  assert.match(String(result.notOnThatBoard), /swap_on_board with made-1/);
  assert.match(String(result.status), /cut and filed/);
  assert.ok(!String(result.status).includes("Ridge"));
  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference"],
  );
});

/// The one branch of this tool where the two halves of the call disagree: the
/// cut is a row and the board would not take it. Said rather than thrown,
/// because a reply that reports a board change it did not get is worse than one
/// that reports a cut and a board that refused it.
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

  /// The user's tab saves under the swap — the same window every scene edit has,
  /// reached here through the read the swap makes for itself.
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

  /// Filed: the row is written, the analyzer is kicked and the id is the answer's
  /// own, none of which the board's refusal reaches.
  assert.equal(result.referenceId, "made-1");
  assert.equal(of("reference", "create").length, 1);
  assert.equal(filedCut(of("reference", "create")).sourceReferenceId, "a");
  /// The board is as it was — the guarded write missed rather than landing.
  assert.equal(of("moodboard", "updateMany").length, 1);
  assert.deepEqual(
    rows[0]!.elements.map((element) => element.fileId),
    ["ref:a", "ref:b"],
  );

  assert.match(String(result.notPutOnBoard), /the cut is filed/);
  assert.match(String(result.notPutOnBoard), /changed while I was editing it/);
  /// And the status does not claim the board changed, which is the sentence the
  /// model would otherwise write.
  assert.match(String(result.status), /cut and filed/);
  assert.ok(!String(result.status).includes("put on"));

  /// The cut alone: a board attachment beside a refusal would show the user the
  /// board they were told did not change.
  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference"],
  );

  /// The run still succeeded, since what it was asked for — a cut — was made.
  const updates = of("agentRun", "update");
  const finish = updates[updates.length - 1]!;
  const { status } = (finish.args as { data: { status: string } }).data;
  assert.equal(status, "SUCCEEDED");
  assert.equal(calls.filter((c) => c.table === "$transaction").length, 1);
});

/// Read before the vision call, like every other refusal this tool can make: a
/// board id the model invented costs a sentence rather than a photograph.
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

  /// The id came out of a model argument, so it is looked up inside the project
  /// the toolset is closed over rather than on its own.
  const [read] = of("moodboard", "findFirst");
  assert.deepEqual((read!.args as { where: unknown }).where, { id: "elsewhere", projectId: "p1" });
});

/// One frame more than a turn may cut, named off the ceiling rather than
/// written out: these four tests are about what happens *at* the limit, and a
/// fixture of three photographs was a fixture that only reached it while the
/// limit happened to be two.
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

/// The ceiling is on the reads and the sentence is about the cuts, so the turn
/// the cropper refused every time is the one the wording has to survive: a model
/// told to describe the cuts it filed is holding none of them.
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
  /// The first read comes back with a box and every read after it with the whole
  /// frame, which the tool refuses — so the turn spends its ceiling and holds one
  /// cut.
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

/// The refusal is the end of the cropping, not a question about it. A turn that
/// hit the ceiling has filed every cut it holds and shown them beside the reply,
/// so a model told to ask which one is the one ends the longest turn in the app
/// by handing the work back.
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

/// The ceiling bounded vision calls alone while the tool ended at an offer: a
/// third box nobody took cost the read and nothing else. It stands in front of
/// the user's project now, so what the refusal has to be worth is a row — past
/// it nothing is decoded, nothing reaches the bucket, no reference is written
/// and the analyzer is not woken.
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
  /// Two rows a cut: the cropper's own run and the analyzer job filed beside the
  /// reference — so the ceiling bounds what the worker is asked to read as well.
  assert.equal(of("agentRun", "create").length, 2 * CROP_CALL_LIMIT);
  /// And the project the next round is primed with holds the two it was told
  /// about rather than a third the refusal said it did not file.
  assert.deepEqual(await toolset.state(), {
    photographs: EVERY_FRAME.length,
    crops: CROP_CALL_LIMIT,
    boards: 0,
    generated: 0,
  });
});

/// The whole reason the tool is worth a round now: the id it answers with
/// resolves against the turn's own read, so the cut can be placed on the round
/// after it was made rather than after the user sends another message.
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
  /// Still one read of the project: the row was folded into it rather than
  /// bought a second time.
  assert.equal(of("reference", "findMany").length, 1);
});

/// The fold that puts it there is `filePicture`, written for `generate_image` —
/// which files a *photograph*. A cut folded in as one would be counted as a
/// photograph in the state the next round is primed with, listed as one in the
/// catalog a compose reads, and unnudgeable: a nudge is asked of the frame a cut
/// names, and a row folded in without its frame names none.
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
  /// Newest of the unstarred first, which is where `GALLERY_ORDER` puts a row
  /// filed a second ago — the same place the fold puts it, so the list the model
  /// reads and the grid the user is looking at are still the same list.
  assert.deepEqual(withCrops.references.map((reference) => reference.id), [cutId, "a"]);

  /// And it can be nudged in the turn it was filed in, which is the other half
  /// of the id being resolvable: the fold carries the frame the cut came out of
  /// and the box it was filed at, and those two are the whole of the nudge.
  await run(toolset, "crop_reference", { referenceId: cutId, intention: "a little wider" });
  const nudge = asked[1] as { gcsUri: string; previous?: unknown };
  assert.equal(nudge.gcsUri, "gs://director-bucket/uploads/a.jpg");
  assert.deepEqual(nudge.previous, {
    cropBox: [200, 200, 800, 800],
    editIntent: "the middle sunflower",
  });

  /// Still one read of the project across all four calls.
  assert.equal(of("reference", "findMany").length, 1);
});

/// The fold is chained onto the memoized read rather than computed off its
/// value, and this is the round that tells the two apart: a round's tool calls
/// run under one `Promise.all`, so two crops both start from the list as it was
/// before either of them filed anything. A fold that built its list off that
/// snapshot would have the second cut overwrite the first, and the turn would
/// answer with an id it no longer holds.
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
  /// Both at the front, where `GALLERY_ORDER` puts the two newest unstarred rows
  /// — which of them is first depends on which transaction landed first and is
  /// not something either call promised.
  assert.deepEqual(
    listed.references.map((reference) => reference.id).slice(0, 2).sort(),
    [...cuts].sort(),
  );

  /// And both ids are good for the next round, which is the promise the tool's
  /// declaration makes about the one it just answered with.
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

/// `crop_reference` writes a scene now, so it queues with the other board
/// writes. Unqueued, two crops for one board in a round read the same revision,
/// one write lands and the other is told the user has the board open — which
/// nobody did.
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

/// And the other half of that queue: an empty key is not a key. A crop that
/// names no board contends with nothing, so two of them in one round stay two
/// vision calls with nothing between them — queued behind a shared key they
/// would run one after the other, doubling the wall clock of the most expensive
/// round this tool has to protect a board neither call is writing.
test("two crops for no board read their frames at the same time", async () => {
  const { db } = fakeDb([photo("a"), photo("b")]);

  let inFlight = 0;
  let mostAtOnce = 0;
  let bothIn!: () => void;
  const both = new Promise<void>((resolve) => {
    bothIn = resolve;
  });
  /// So a round that serialises fails on the count below rather than hanging on
  /// a second reader that is never let in.
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

/// The codec is the one thing in this path that fails on its own terms — a
/// frame whose bytes the bucket no longer holds, or a photograph sharp will not
/// decode. Nothing is stored and nothing is filed, and the sentence says there
/// is no cut, because a model told only that something went wrong writes a reply
/// describing the cut anyway.
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
  /// The read of the photograph is already paid for by the time the codec is
  /// reached, so the failed row carries it.
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...CROP_USAGE });
});

/// A photograph too large to read into a function is the one codec failure that
/// is not worth trying again — the file will weigh the same on the second call —
/// so it is said as its own sentence and the model is told to stop, rather than
/// spending the other cut the ceiling allows on the same refusal.
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

/// The bucket refusing the *second* object is the half worth naming: the cut's
/// own bytes are up there already and only the grid-sized copy is missing. It is
/// still no cut — a row pointing at a thumbnail nothing wrote would be a tile
/// that never draws, and an object nobody can reach is the cheaper of the two.
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

/// Every new failure point gets a sentence rather than an exception. The
/// expensive one is this: the photograph is read and paid for, the bytes are in
/// the bucket, and the row that would make them a reference is not there.
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
  /// And it still carries what the read cost: a failure after the model answered
  /// is the most expensive kind there is.
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
  /// Nothing was cut and nothing was filed: the cropper read the photograph
  /// correctly, and a second copy of it filed as a crop of itself is what this
  /// refusal is for.
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
  /// The two photographs and the page they are on.
  assert.equal(data.elements.length, 3);

  /// The cover is whatever the compositor put in the layout's opening slot, not
  /// whatever the orchestrator listed first.
  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "board");
  assert.equal(attachment?.kind === "board" && attachment.thumbUrl, "/api/references/b/image?variant=thumb");
  assert.match(attachment?.caption ?? "", /^2 photographs · /);

  /// Text in, no image parts: the compositor is briefed with tags, never bytes.
  assert.equal(asked[0]!.intention, "the light before a storm");
  assert.ok(!JSON.stringify(asked[0]).includes("gs://"));
});

/// tech-spec §III.4: the board a compose files is a *page*, not pictures loose on
/// a canvas. It is what makes the arrangement one thing the user can name and
/// the model can be handed whole, and the compositor is where every board that
/// has one gets it.
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
  /// And the pictures are on it rather than beside it.
  assert.deepEqual(
    pageItems(boardItems(data.elements as never), pages[0]!).map((item) => item.clipped),
    [false, false],
  );
});

/// The id the next call needs. A compose that files a page and does not say what
/// it is called leaves `inspect_board`'s pageId reachable only by reading the
/// board back, which is a round spent learning what the call just decided.
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

  /// A rebuild reports the page it kept, so the id in the answer is the id the
  /// user's board carried before the call.
  const rebuilt = await run(toolset, "compose_moodboard", {
    intention: "add the third one",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });
  assert.deepEqual(rebuilt.result.page, { pageId: "page-7", name: "Cold open" });
});

/// The arrangement is what a rebuild replaces; the page is the board's. A page
/// renamed by the user and then rebuilt used to come back as "Page 1" with a
/// new id — a page nothing that held its id could still name.
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
  /// Including the picture that just joined: a page whose newest photograph is
  /// not a child of it is a page the user drags away from a third of a board.
  assert.deepEqual(
    (data.elements as { type: string; frameId?: string }[])
      .filter((element) => element.type === "image")
      .map((element) => element.frameId),
    ["page-7", "page-7", "page-7"],
  );
});

/// A board of two pages, the second a `PAGE_GAP` to the right of the first, each
/// standing as the template composed it.
///
/// Built here because nothing in the app files one yet: a compose draws one page
/// and no tool adds another. It is what the page-scoped compose has to be right
/// about before the tool that draws page 2 exists — and the case where being
/// wrong is a deletion, since a compose used to write the whole scene.
function spreadBoard(
  id: string,
  layout: MoodboardLayout,
  pages: readonly {
    id: string;
    name: string;
    placed: readonly [string, string, number, number][];
    /// The lines that page carries. A spread's pages say the same things as
    /// often as not — one heading each, in the same slot of the same template —
    /// which is the whole reason a reword has to be told which page it is about.
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

/// A picture put behind a page, as `put_on_canvas` and `reorder_on_canvas` leave
/// it: covering the page, bleeding off both sides because it is not the page's
/// shape, and first among the page's children — which is the back of the stack.
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

/// The read the whole of §3b hangs off: what the user has is five photographs on
/// a sketch, and a board that answers "six photographs" has counted the thing the
/// page is standing on as one of the things standing on it.
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
  /// It is still *drawn* in the arrangement — the model has to be able to see
  /// the page is standing on something, and the box is what says so.
  const behind = (result.arrangement as { referenceId: string; box: number[]; z: number }[]).find(
    (block) => block.referenceId === "sketch",
  );
  assert.deepEqual(behind?.box, [0, 0, 1000, 1000]);
  assert.equal(behind?.z, 0);
});

/// The failure this half of the change exists for. `sceneOffPage` keeps
/// everything *not* on the page being composed, so a rebuild used to delete the
/// background — a user who says "make it a grid" and loses the sketch they put
/// behind their page is being argued with by the pipeline.
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

  /// The backdrop is not offered to the compositor as a block to seat: it is what
  /// the page stands on, and a slot cut for a photograph is not where it goes.
  assert.deepEqual(
    asked[0]!.blocks.map(({ id }) => id),
    ["a", "b"],
  );

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const written = data.elements as { id: string; frameId?: string }[];
  const behind = written.find((element) => element.id === "page-1-behind");
  assert.ok(behind, "the background survived the rebuild");
  /// At the back of the page's own children, which is both where it was and
  /// where the rule that recognises one looks.
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

/// tech-spec §V: the arrangement a compose decides is one *page's*. A compose
/// used to write the board's whole scene, so laying out page 2 of a spread would
/// have deleted page 1 — every picture on it, and the page itself.
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
  /// The tile beside the reply is the page that was laid out — the miniature
  /// always was, since it is drawn from the placements, and now the caption says
  /// which page those are of.
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
  /// Only what is joining *that page*, and against its free slot: the picture
  /// already on page 2 keeps its place and the two on page 1 are not the
  /// compositor's business.
  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["d"]);
  assert.deepEqual(asked[0]!.inPlace?.map(({ slotId, id }) => [slotId, id]), [["img-1", "c"]]);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  /// Page 1 is returned as the elements it was, in the order it had them.
  assert.deepEqual(
    (data.elements as { id: string }[]).slice(0, 3).map((element) => element.id),
    ["page-1-el-0", "page-1-el-1", "page-1"],
  );

  const pages = boardPages(data.elements);
  assert.deepEqual(pages.map((page) => [page.id, page.name, page.x]), [
    ["page-1", "Cold open", 0],
    ["page-2", "Act two", split.page.width + PAGE_GAP],
  ]);
  /// And page 2 holds what it held plus what joined it, drawn at its own corner
  /// rather than back at the origin on top of page 1.
  assert.deepEqual(
    pageItems(boardItems(data.elements as never), pages[1]!).map((item) => item.clipped),
    [false, false],
  );
  assert.equal(pageItems(boardItems(data.elements as never), pages[0]!).length, 2);
});

/// The set a page is laid out from is the page's. Offered the board's instead, a
/// rebuild of page 2 would draw page 1's pictures onto it a second time while the
/// copies the user is looking at stayed where they were.
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
  /// And the answer says what changed, since "that board now holds this
  /// arrangement" would describe the loss of a page nobody touched.
  assert.match(String(result.status), /^laid out again on “Act two”/);
});

/// tech-spec §V: the compositor lays out one page, and until it is told which one
/// it composes as though the board were the page. The line it ends with is read
/// out to the user — "I put the doorway beside the rooftop, so the board
/// opens on the street" is a sentence about a board they have two pages of.
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
  /// And the run row says which page was composed, so a spread's every compose is
  /// not filed under one board id and nothing else.
  const { data } = of("agentRun", "create")[0]!.args as { data: { input: Record<string, unknown> } };
  assert.equal(data.input.onPage, "page-2");
});

/// A page of its own is the one case the compositor cannot read off the free
/// slots: an empty page and a page being laid out again both arrive with every
/// slot open, and on the fresh one every block it is given is the whole of what
/// the user will see there.
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

  /// Named as the user is about to see it named, and numbered past the pages
  /// the board already has.
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

/// A board holding one page *is* that page, so saying so costs tokens on every
/// compose in the app to tell the model something the layout already said. The
/// ordinary compose and the ordinary rebuild ask exactly what they always asked.
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

/// The same bargain `inspect_board` makes, and it matters more here: a guessed
/// page id on this tool is a compositor call away from writing over the wrong
/// arrangement.
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
  /// Refused before the compositor and before the write, like every other bad id.
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

/// A picture the user dragged off the page onto the canvas beside it is
/// theirs. It is not part of the set the page is laid out from — offered as one
/// it would be drawn a second time on the page while their copy stayed where they
/// left it — and a compose of the page does not delete it either.
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

  /// The picture beside the page was never offered to the compositor.
  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["c"]);
  assert.deepEqual(asked[0]!.inPlace?.map(({ id }) => id), ["a"]);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const loose = (data.elements as { id: string; x: number; y: number }[]).find(
    (element) => element.id === "beside",
  );
  assert.deepEqual([loose?.x, loose?.y], [200, split.page.height + 400]);
});

/// tech-spec §V.1: the rectangle is authoritative — "the size it actually is" —
/// and resizing a page "changes nothing else". A compose took its page size from
/// the template, so the one call that did change something else was a rebuild:
/// the user's own number, replaced without being asked, by a call they made
/// about the pictures on it.
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

  /// And the arrangement fills the page they made rather than a quarter of it in
  /// the corner: both pictures on the page, neither over its edge, reaching the
  /// far side of it.
  const items = pageItems(boardItems(data.elements as never), page!);
  assert.deepEqual(items.map((item) => item.clipped), [false, false]);
  assert.ok(Math.max(...items.map((item) => item.x + item.width)) > theirs.width * 0.9);
  /// The row's default page size is its first page's (§V.1), which is now theirs.
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

/// The other half of §V: a compose lays out a page the board has, or draws one it
/// has not. This is the only way a board grows a page — and the case where being
/// wrong is the whole board, since the same call with `newPage` left off writes
/// over the arrangement the user is looking at.
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

  /// Composed from what was named alone: a new page starts empty, so the
  /// pictures on the board's other pages are not offered to it and nothing is
  /// sitting in a slot to be kept.
  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["d"]);
  assert.equal(asked[0]!.inPlace, undefined);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.deepEqual(pages.map((page) => [page.name, page.x]), [
    ["Cold open", 0],
    ["Act two", split.page.width + PAGE_GAP],
    ["Page 3", 2 * (split.page.width + PAGE_GAP)],
  ]);
  /// The board it joined is the board it was, picture for picture.
  const items = boardItems(data.elements as never);
  assert.equal(pageItems(items, pages[0]!).length, 2);
  assert.equal(pageItems(items, pages[1]!).length, 1);
  assert.deepEqual(
    pageItems(items, pages[2]!).map((item) => [item.referenceId, item.clipped]),
    [["d", false]],
  );

  assert.deepEqual(result.page, { pageId: pages[2]!.id, name: "Page 3" });
  /// And the answer is about a page added rather than a board rebuilt, since
  /// "that board now holds this arrangement" would be a claim about the two
  /// pages that did not change.
  assert.match(String(result.status), /new page, “Page 3”/);
  assert.match(String(result.status), /3 pages now/);
});

/// A page named alongside `newPage` is where the new one *goes*, not what it
/// replaces. Read the other way round, the call that asked for a page beside
/// page 1 would have written over page 1.
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

/// Nothing on a new page to lay out again: the references named are the whole of
/// what goes on it, so a call that names none is a page nobody could see.
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

/// A page is added to a board, and a call with no board is already a new board —
/// which opens as its own first page.
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

/// §V.1: `Moodboard.widthPx`/`heightPx` stopped being the board's page and became
/// its *default* — what a first page is drawn at, and what a page added beside
/// the others falls back to — with `layout` the template that default stands in.
/// Written from every compose, the row would describe whichever page was laid out
/// last: ask for page 2 as a tall masonry and the board's default turns
/// 1080×1920, so the next page added beside two landscape ones comes out a
/// portrait and every page is read against a template only page 2 was drawn in.
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
  /// Left alone rather than written with the values it already had: a row this
  /// compose does not describe is not this compose's to write.
  assert.deepEqual(
    ["layout", "widthPx", "heightPx"].filter((key) => key in data),
    [],
  );
  /// The page did change shape, which is the change that was asked for.
  assert.deepEqual(
    boardPages(data.elements).map((page) => [page.name, page.width, page.height]),
    [
      ["Cold open", split.page.width, split.page.height],
      ["Act two", 1080, 1920],
    ],
  );
});

/// The same row, on the call that grows the board: a page added is not the board
/// changing shape, so a tall page put beside two landscape ones does not make
/// tall the shape the *next* one is drawn at.
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

/// A rebuild of the board's first page is what the row describes, so it still
/// writes it — the board's default follows the page a first page is drawn at.
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

/// One page of a spread outgrowing its template is that page changing shape. Said
/// as "your board changed shape" it is a sentence about pages that did not move —
/// and on this branch the board's row does not change at all.
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

/// A page the user sized themselves does not change shape when its template
/// does — it keeps their rectangle and the new arrangement is fitted into it — so
/// the sentence about the board changing shape is a sentence about a change that
/// did not happen.
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

/// tech-spec §V.2: a page arrives without anything being laid out. The board
/// this is written for is the one nothing else in the app can give a page to —
/// arranged by hand, never composed, and so unreadable a page at a time.
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
  /// The two pictures are on it, where the user left them, and owned by it —
  /// a page that did not adopt them is a rectangle they drag out from under
  /// their own board.
  assert.equal(pageItems(boardItems(data.elements as never), pages[0]!).length, 2);
  assert.deepEqual(
    (data.elements as { id: string; x?: number; frameId?: string }[])
      .filter((element) => element.id.startsWith("el-"))
      .map(({ x, frameId }) => [x, frameId]),
    [[0, pages[0]!.id], [900, pages[0]!.id]],
  );
});

/// tech-spec §V.1: "a page cannot contain a section — a board uses one or the
/// other". A hand-arranged board is the one board that may already be organized
/// in sections, and its first page is drawn around the whole of it, so this is
/// the only place the two meet.
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
  /// Only the loose picture changed hands: the section keeps its own, and the
  /// section frame is owned by nothing — excalidraw does not nest frames.
  assert.equal(result.drawnAround, 1);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  const pages = boardPages(data.elements);
  assert.deepEqual(
    (data.elements as { id: string; frameId?: string }[])
      .filter((element) => element.id !== pages[0]!.id)
      .map(({ id, frameId }) => [id, frameId]),
    [["sec-1", undefined], ["el-0", "sec-1"], ["el-1", pages[0]!.id]],
  );
  /// Both pictures are still *on* the page: membership is geometric, and the
  /// render draws them inside the rectangle whatever owns them.
  assert.equal(pageItems(boardItems(data.elements as never), pages[0]!).length, 2);
});

/// And the point of the last test: that board can now be read a page at a time,
/// which is the whole of what a page is for.
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
  /// Nothing was drawn around, so nothing is claimed to have been.
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
  /// No compositor was reached for and no page of the board was laid out again.
  assert.equal(of("agentRun", "create").length, 0);
});

/// The count on the row is only worth anything while it is true, and the only
/// thing that keeps it true is that the statement writing the scene writes it
/// too. A page added is the cheapest write that changes it.
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

/// The instruction tells the model to pass a pageId "on a board of more than one
/// page"; this is the only place in the whole prompt that says which boards
/// those are, and it says it without the boards read ever touching `elements`.
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
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  assert.match(brief, /board-7 · Board board-7 · 1920×1080 · SPLIT · 2 pages/);
  /// The board nobody has paged says nothing about pages rather than "1 page".
  assert.match(brief, /board-8 · Scraps · 1920×1080\n?/);
  assert.equal(/board-8[^\n]*pages/.test(brief), false);

  const select = (of("moodboard", "findMany")[0]!.args as { select: Record<string, unknown> })
    .select;
  assert.equal("elements" in select, false);
});

/// The count says a board is a spread; the names say which spread the user
/// means. "Put the stairwell on the exteriors page" carries no board id and no
/// page id, and this is the only thing in the prompt that can turn it into one —
/// still off the row's own columns, with the scene untouched.
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
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  assert.match(brief, /2 pages: “Cold open”, “Exteriors”/);
});

/// The names are only worth anything while they are the page's, and what keeps
/// them so is that the statement writing the scene writes them too — in the
/// order the pages are read in, so the third name is the third page.
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

/// tech-spec §V: the copy the board has had since long before its pages did.
/// "Try that page with the tall shot" is `duplicate_board`'s own sentence one
/// level down, and the board copy answers it by carrying every page they were not
/// talking about into a second tab.
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

  /// No compositor was reached for: copying is not a judgement.
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
  /// The copy holds what the page holds, at the same places inside its own
  /// rectangle — and the two pages it was not about are untouched.
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

  /// The page that was made, not a miniature of the whole spread: it is the one
  /// they are about to work on.
  const [attachment] = attachments ?? [];
  assert.match(String(attachment?.kind === "board" && attachment.caption), /“Page 3”, page 3 of 3/);
  assert.equal(attachment?.kind === "board" && attachment.images, 2);
  assert.match(String(result.status), /Make the change they asked for on this page/);
});

/// The one thing a copy landing in the same array must not do: two elements with
/// one id is a scene excalidraw draws once, and a shared group id would drag the
/// original page's pictures along with the copy's.
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

/// A board the user arranged by hand has no page to copy, and the answer says
/// which of the two calls gets them one rather than leaving the model to guess.
test("a board with no pages is told what to call instead of duplicate_page", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")], [handBoard("board-9")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "duplicate_page", { boardId: "board-9", pageId: "page-1" });

  assert.equal("pages" in result, false);
  assert.match(String(result.pagesNote), /add_page/);
  assert.match(String(result.pagesNote), /duplicate_board/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

/// tech-spec §V.1: "resizing a page is allowed and changes nothing else". The
/// user has always had it as a frame handle; the model's nearest call was a
/// compose at a template of another shape, which resizes the page *and* has agent 4
/// lay it out again on the way past.
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

  /// No compositor was reached for: a shape the user named is not a judgement.
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
  /// §V.1: the row's columns are the board's *default* page — its first page — so
  /// a shape given to page 2 is not a claim about them.
  assert.deepEqual(["widthPx", "heightPx"].filter((key) => key in data), []);

  /// SPLIT puts two panels across 1920; the right-hand one is outside a 1080-wide
  /// page. Nothing moved, so it is beside the page rather than gone.
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
  /// The page was standing exactly as SPLIT composed it, and the slots were cut
  /// for the old rectangle — which is something to say rather than something to
  /// follow with a compose the user did not ask for.
  assert.match(String(result.layoutNote), /standing exactly as SPLIT composed it/);
  assert.doesNotMatch(String(result.layoutNote), /offer to lay that page out again/);
  assert.match(String(result.layoutNote), /do not compose it again/);

  /// The page that changed shape, not a miniature of the whole spread.
  const [attachment] = attachments ?? [];
  assert.match(String(attachment?.kind === "board" && attachment.caption), /“Act two”, page 2 of 2/);
  assert.match(String(result.status), /is 1080×1920 now and nothing on it moved/);
});

/// The other half of §V.1's redefinition: those columns are what a first page is
/// drawn at and what §V.2 falls back to, and the board's first page is what they
/// describe — so this is the one page whose shape they follow.
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
  /// The template it was composed at is not a shape — a resize lays nothing out.
  assert.equal("layout" in data, false);
});

/// A page grown over what was lying beside it takes it in, because membership is
/// geometric (§V.3) — and it is adopted in the same edit, since excalidraw's own
/// drag reads `frameId` and a page that dragged out from under a photograph the
/// model has just called its own is the disagreement §V.3 exists to prevent.
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
  /// A picture the user dragged off the page, below it and clear of it.
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

/// Spending a revision on a page that is already that shape puts the scene the
/// user has open a version behind and disowns the board's render for nothing.
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
  /// Where another rectangle comes from is the caller's own sentence now that
  /// agent 8 shares this executor and draws its rectangles itself. Agent 6's is
  /// the one it has always answered with.
  assert.match(String(shapeless.result.presetsNote), /the user's own to drag on the canvas/);

  assert.equal(of("moodboard", "updateMany").length, 0);
});

/// A headline used to be asked for and dropped. Two photographs and a line is
/// three blocks, the template was picked on that three, and no three-slot
/// template has a text slot at all — so the compositor was offered a caption it
/// had nowhere to put and the board came back without it.
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

/// Agent 4's whole judgement is tag adjacency, so a board composed the minute
/// after an upload is composed on shape alone. The board is worth keeping — a
/// picture with no tags still has a shape — but a reply that does not say so is
/// claiming a reading of pictures nobody has read.
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
  /// The board is still filed and the compositor still sees the picture — with
  /// its shape and no tags, which is what it was given to work with.
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

/// A caption per photograph is a natural ask and used to cost the board its
/// photographs: the block budget counted blocks, so ten lines filled it and two
/// pictures reached the compositor. The lines are now bounded by what a template
/// can seat, and the ones that did not go on are said rather than swallowed.
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

/// Found live: "make me a board and give it a headline" was composed at
/// TRIPTYCH, which has no text block, and the headline came back as `unplaced` —
/// which reads as the compositor's taste. The reply said the headline was "set
/// as the board's title", which was true of the title and false about the board.
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
  /// Not the budget's report: the line was offered, it was the template that
  /// had nowhere to put it.
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

  /// Slot order, not the order the orchestrator named them in: the miniature is
  /// the board, so the picture on the left is the one in the left slot.
  assert.deepEqual(
    preview.items.map((item) => item.thumbUrl),
    ["/api/references/b/image?variant=thumb", "/api/references/a/image?variant=thumb"],
  );
  assert.ok(preview.items[0]!.left < preview.items[1]!.left);

  /// 4:3 pictures in SPLIT's taller-than-4:3 halves: each is drawn at the box it
  /// occupies, so the page shows above and below it rather than the photograph
  /// being stretched to the slot.
  assert.ok(preview.items.every((item) => item.height < 100 && item.kind === "image"));
});

/// The cheapest call in the pipeline is exactly the one that needs a row: a
/// block cap gets raised on evidence or on a feeling, and this is the evidence.
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
  /// No board: a page of slots with nothing in it is not a moodboard.
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

/// tech-spec §III.4's "all current blocks": asked to lay their board out again,
/// the user means the pictures already on it — which the executor reads off
/// the scene rather than making the model name them back.
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
  /// Guarded on the revision that was read, exactly as the autosave is.
  assert.deepEqual(where, { id: "board-7", revision: 3 });
  assert.deepEqual(data.revision, { increment: 1 });
  /// And the picture of the arrangement it replaced is disowned, or the tab row
  /// shows the old board as the preview of the new one.
  assert.equal(data.renderRevision, null);
  assert.equal((data.elements as unknown[]).length, 3);
});

/// The model is primed with a board's id and name, never with what is on it, so
/// "put the sunset on it too" can only be said as a change. Said as a selection
/// instead it would be the model's guess at the whole board, and every picture it
/// forgot would come off.
///
/// On a board still standing as its template composed it the picture joining it
/// is placed by the compositor — but only that picture. The ones already seated
/// keep their slots, so the call that named one photograph moves one photograph.
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

  /// Only the newcomer is open to assignment, and only the empty slots are.
  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["c"]);
  assert.deepEqual(asked[0]!.layout.slots.map((slot) => slot.id), ["img-3", "img-4"]);
  assert.deepEqual(asked[0]!.inPlace!.map((entry) => [entry.slotId, entry.id]), [
    ["img-1", "a"],
    ["img-2", "b"],
  ]);
  assert.deepEqual(result.added, ["c"]);
  assert.equal(result.keptTheirSlots, 2);
  assert.equal(result.removed, undefined);
  /// And on the board: three pictures, the two that were there in the boxes they
  /// were already drawn in.
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

/// Nothing joins, so nothing is left to decide: the compositor is not called at
/// all and the pictures that stay keep the slots they were in.
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
  /// No call, so no run row: a zero-token compose on the ledger would be a board
  /// nobody composed billed as one that was.
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
  /// The scene changed, so the guard bumps and the stored render is disowned.
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  const was = composedBoard("board-7", strip, [["c", "img-3", 400, 300]])
    .elements[0] as { x?: number };
  assert.equal(data.elements[1]!.x, was.x);
});

/// The other half of the same rule: a rebuild that names no change is a request
/// to lay the board out again, and there the compositor decides the whole of it.
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

/// And when the template runs out of room the board changes shape, so there are
/// no slots left to keep: every block goes back to the compositor.
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

/// A line joining a board whose pictures are all seated: the pictures are not
/// open to assignment, the free text slot is.
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
  /// The pictures, the line, and the page they are all on.
  assert.equal(data.elements.length, placed.length + 2);
  assert.equal(data.elements.at(-1)!.type, "frame");
  assert.equal(data.elements.at(-2)!.text, "Act two");
});

/// A picture named on that is already on: the scene it would be rewritten to is
/// the scene it has, so the write is skipped rather than made — a revision bump
/// would hand an open tab a conflict for a call that changed nothing.
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

/// The same cap on the branch that writes nothing. A board already carrying every
/// line a template can hold, asked for one more, changes nothing — and saying only
/// "nothing changed" would leave the user believing their words went on it.
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

/// The board the rebuild path could not be allowed near. A board the user
/// dragged together has no template to reflow into, so `layoutForBoard` picks one
/// from the block count and the rebuild writes it over their arrangement — which
/// makes "put the sunset on that too" a deletion of the board rather than an
/// addition to it.
///
/// Everything below is about the same call taking the other branch: no model
/// call, no run row, and every element that was already there returned as the
/// object it was.
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
  /// Guarded and disowned like every server-side scene write, but the template
  /// and the page size stay: putting a picture on a board is not a reshape of it.
  assert.deepEqual(where, { id: "board-7", revision: 3 });
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);
  assert.equal(data.widthPx, undefined);
  assert.equal(data.title, undefined);

  const elements = data.elements as { id: string; fileId?: string; y?: number }[];
  /// The three that were there, unmoved and in order, and the new one after them.
  assert.deepEqual(elements.slice(0, 3).map((element) => element.id), ["el-0", "el-1", "txt-0"]);
  assert.equal(elements[3]!.fileId, "ref:c");
  /// Under everything on the board (the caption's box ends at 548), not into it.
  assert.ok(elements[3]!.y! >= 548);
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");
});

test("a picture taken off a hand-arranged board leaves the rest exactly where they were", async () => {
  const fixture = lettered("board-7", ["a", "b"], ["Act two exteriors"]);
  /// Held before the call: the write lands on the stored row, so reading the
  /// fixture's elements afterwards would be reading what was written rather than
  /// what was there.
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
  /// An id the board never carried is the model having meant a different picture.
  assert.deepEqual(result.notOnBoard, ["z"]);

  const { data } = of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } };
  assert.deepEqual(data.elements, kept);
});

/// The gate is whether the board still *stands* as its template composed it, not
/// whether it was ever composed: a board with a template on the row and one
/// picture dragged out of its slot is an arrangement the user made, and a
/// rebuild would reflow it away.
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

/// tech-spec §V, on the other side of the branch. The compose was scoped to a
/// page two iterations ago and the scene edit was not, so a picture added to a
/// page the user had dragged about landed under the *board* — beneath the
/// widest page, on no page at all, where nothing can read it and no compose will
/// ever pick it up again.
function draggedSpread() {
  const split = layoutById("SPLIT")!;
  const spread = spreadBoard("board-7", split, [
    { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
    { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
  ]);
  /// Page two's picture dragged out of its slot: an arrangement the user made
  /// by hand, which is what sends the call to the scene edit rather than to the
  /// compositor.
  const index = spread.elements.findIndex((element) => element.id === "page-2-el-0");
  spread.elements[index] = {
    ...spread.elements[index]!,
    x: split.page.width + PAGE_GAP + 80,
    y: 700,
  } as never;
  return { spread, page: { x: split.page.width + PAGE_GAP, width: split.page.width, height: split.page.height } };
}

/// The scene edit is the other branch of this tool, and a rename dropped on its
/// floor would answer "done" to a call whose page is still called Page 2.
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
  /// One write, carrying both: the name is a string on the frame and the picture
  /// is an element beside it.
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
  /// The scene edit's tile is the page it landed on, the same as the rebuild's:
  /// "it went on the second page" beside a picture of both pages is the user
  /// hunting for what moved.
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
  /// On the page by geometry — which is the only membership §V.3 reads — and
  /// owned by its frame, so the user dragging the page takes it with them.
  assert.equal(joined.frameId, "page-2");
  assert.ok(joined.x >= page.x && joined.x + joined.width <= page.x + page.width);
  assert.ok(joined.y >= 0 && joined.y + joined.height <= page.height);
  /// Immediately before the frame, which is where excalidraw wants a child.
  assert.deepEqual(
    elements.map((element) => element.id).slice(-2),
    [joined.id, "page-2"],
  );
  /// Page one is returned as the elements it was, in the order it had them.
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
  /// The one thing the model could not have worked out for itself: the picture is
  /// on the board, and reading against a page is why it came back as missing.
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
  /// And the board's other page is not what saves it: the refusal is about the
  /// page the call named, which is the page it would have emptied.
  assert.equal(of("moodboard", "updateMany").length, 0);
});

/// The other half of the same hole. Iteration 31 stopped a photograph deleting a
/// hand-arranged board; a headline still did, because `addCaptions` went to the
/// compositor whichever board it was about.
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
  /// The two pictures unmoved, and the line above them rather than among them.
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

/// A board still standing in its template is the case the compositor is for: the
/// blocks move up into a template that holds the new count.
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

  /// The user's tab saves between the read and the write, which is the one
  /// window a scene edit has.
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

/// A board with lines of text set on it, which needs geometry the way any scene
/// read does — `board()`'s elements carry ids and nothing else.
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

/// The half of a board a rebuild used to write from the call alone. Asked to add
/// a photograph, the model passes no captions — and the board came back without
/// the headline the user set on it.
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
  /// Kept, not changed — nobody asked anything of the text, so there is nothing
  /// for the reply to say about it.
  assert.equal(result.linesAdded, undefined);
  assert.equal(result.linesRemoved, undefined);
});

/// The same change-not-set rule the pictures follow, said in words because a
/// line has nothing else to be pointed at by.
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
  /// A wording the board does not carry is the model quoting the user rather
  /// than the board, and only they can say which line was meant.
  assert.deepEqual(result.linesNotOnBoard, ["a line nobody set"]);
  assert.match(String(result.linesNotOnBoardNote), /inspect_board/);
});

/// The board is a thing the user already owns and has already named. A
/// rebuild is not a rename.
test("a rebuild keeps the board's name unless it is given a new one", async () => {
  const boards = [board("board-7", ["a"])];
  const { db, of } = fakeDb([photo("a")], boards);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", { intention: "tighter", boardId: "board-7" });
  const kept = (of("moodboard", "updateMany")[0]!.args as { data: { title: string } }).data;
  assert.equal(kept.title, "Board board-7");

  /// The selection restated, so this stays a rebuild: a title on its own is a
  /// rename and never reaches the compositor.
  await run(toolset, "compose_moodboard", {
    intention: "tighter",
    boardId: "board-7",
    referenceIds: ["a"],
    title: "Act two, exteriors",
  });
  const renamed = (of("moodboard", "updateMany")[1]!.args as { data: { title: string } }).data;
  assert.equal(renamed.title, "Act two, exteriors");
});

/// A rename is not a compose. Asked for one, the tool used to pay the compositor
/// and write back the arrangement it had just re-decided — so the board changed
/// shape as the price of changing its name.
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

  /// Nothing was asked of the model and no run row was opened: there is nothing
  /// here for the compositor to decide.
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);

  const write = of("moodboard", "update")[0]!.args as {
    where: { id: string };
    data: Record<string, unknown>;
  };
  assert.equal(write.where.id, "board-7");
  /// The title column alone. No elements, no revision bump — the tab the
  /// user may have open is autosaving against that revision — and the stored
  /// render is left standing, because it is still a picture of this board.
  assert.deepEqual(Object.keys(write.data), ["title"]);
  assert.equal(write.data.title, "Act two, exteriors");
  assert.equal(result.title, "Act two, exteriors");
  assert.match(String(result.status), /nothing on the board moved/);

  /// Shown as the board still is, under its new name: same template, same two
  /// pictures.
  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "board" && attachment.title, "Act two, exteriors");
  assert.equal(attachment?.kind === "board" && attachment.caption, "2 photographs · Split");
});

/// §V.1 makes the page's name "the user's to edit", and until now the only
/// name a page ever carried was the one it was made with. It is also the name
/// both of them say the page by — "put the stairwell on Act two" is addressed to
/// this string — so a page that cannot be renamed is a page the user has to
/// go to the canvas to address.
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

  /// Nothing was asked of the model and no run row opened: a string on a frame is
  /// not an assignment.
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  /// A board's name is a column and a page's is in the document a tab has open,
  /// so this one is the guarded scene write every other page edit makes — and the
  /// board's own title column is not written at all.
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
  /// The pictures are the ones the board had, in the order it had them: a rename
  /// moves nothing.
  assert.deepEqual(
    ((write.data as { elements: { id: string }[] }).elements).map((element) => element.id),
    ["page-1-el-0", "page-1-el-1", "page-1", "page-2-el-0", "page-2"],
  );

  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  assert.equal(result.title, "Board board-7");
  assert.match(String(result.status), /that page is now called “Act two”/);
  assert.match(String(result.status), /not laid out again/);
  /// Shown as the page they just named, so the caption under the reply carries the
  /// name rather than the board's.
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
});

/// The board and one of its pages named in one sentence is one call, and a status
/// naming only one of them reads as the other having been refused.
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

/// A page id left out means the board's first page everywhere else in this tool,
/// and a board with no page at all has no rectangle carrying a name — refused
/// rather than the board quietly renamed instead, which is a different thing done
/// without saying so.
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

/// A page being added is the one case where the name is not a rename: it is the
/// name the page is drawn with, and the compositor is told it because the line it
/// speaks names the page as the user knows it.
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

/// The page a compose is about, renamed by the same call that lays it out. The
/// name the compositor is told has to be the one the board ends up carrying, or
/// the line the user hears names a page they cannot find.
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

/// The one ambiguity the rename path can be wrong about is answered by making the
/// reshape askable in the same call: a template named is a rebuild whatever else
/// the call carries.
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

/// The board is the thing the user has been looking at, and its shape is
/// most of what they recognise it by. A rebuild that re-picks a template from the
/// block count changes that shape without being asked — and on the counts two
/// templates share, it could change it having changed nothing else at all.
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

  /// Five blocks resolve to GOLDEN_RATIO on a 2048 square when nothing is stored,
  /// so the page size is the tell: this board stayed the 1920×1080 hero it was.
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

/// A board with no template on it is one the user dragged together, and that
/// is exactly the board a rebuild has to choose a template for.
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

/// A page handed in as an image and a template named by id are two different
/// boards. Whichever one won would be a guess at which half of the call was the
/// ask — and the guess costs a vision read either way, so it is refused before one.
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

/// The id arrives in a model argument, like every other, and is checked against
/// the project the toolset is closed over.
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

/// The layout image is the *ask*, not a block: it is a picture of a page rather
/// than a photograph to put on one, so a model that named it in both places is
/// not asking for it to be composed beside the pictures it holds.
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
  /// `CUSTOM` names no template, so the answer says what it is instead of leaving
  /// the model to report a template by that name.
  assert.match(String(result.layoutRead), /not a template — that page was read off page/);
  /// Read from code, off the row, with the pixels the boxes are thousandths of —
  /// never a uri out of the conversation.
  assert.equal(read[0]!.gcsUri, "gs://director-bucket/uploads/page.jpg");
  assert.deepEqual(read[0]!.image, { width: 1600, height: 900 });

  /// Two rows for two calls, the reader's first, each carrying its own tokens.
  const rows = of("agentRun", "create").map(
    (call) => (call.args as { data: { agent: string } }).data.agent,
  );
  assert.deepEqual(rows, ["LAYOUT_READER", "COMPOSITOR"]);
  assert.deepEqual(spentOf(of("agentRun", "update")[0]!), { model: MODELS.FLASH, ...READ_USAGE });
});

/// The id `CUSTOM` names no constants file, so the geometry goes on the row
/// beside it — without it the next rebuild has nothing to keep.
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

/// A rebuild keeps the page the user drew for exactly as long as a template
/// would have been kept. Re-picking from the block count would replace the
/// arrangement they handed in with one of the ten, having been asked for nothing
/// of the kind.
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

  /// Nothing was handed in this time, so nothing was read: the geometry came off
  /// the row and the second board cost one call rather than two.
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

/// A board put back on one of the templates clears the geometry with it. Left
/// standing it is a page nobody is looking at, waiting for a later reader that
/// resolves the slots before the id.
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
  /// The Prisma sentinel for an emptied Json column, not the Json value `null`.
  assert.equal(data.layoutSlots, Prisma.DbNull);
});

/// What the reader could not read is the user's news, not a 500: they handed in
/// the wrong picture and the sentence says so. The tokens go on the failed row
/// for the reason the cropper's do — a ledger that counts only the successes
/// says a bad afternoon was cheap.
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
  /// Nothing downstream ran: no compositor, and no board written on a page
  /// nobody could read.
  assert.equal(composed.length, 0);
  assert.equal(of("moodboard", "create").length, 0);

  const [failed] = of("agentRun", "update");
  const data = (failed!.args as { data: Record<string, unknown> }).data;
  assert.equal(data.status, "FAILED");
  assert.match(String(data.error), /no placeholders were found/);
  assert.deepEqual(spentOf(failed!), { model: MODELS.FLASH, ...READ_USAGE });
});

/// A rebuild is a write to a document a tab may have open. The tab that loses
/// gets a conflict it can reload out of; the assistant gets a sentence.
test("a board changed while the compositor was composing is not overwritten", async () => {
  const boards = [board("board-7", ["a"], { revision: 9 })];
  const { db, of } = fakeDb([photo("a")], boards);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  /// The user's own save lands while the compositor is thinking — the one
  /// window a rebuild is exposed in, since the read and the write are either
  /// side of a model call.
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

  /// The call was made and answered, so the run row is failed with the spend on
  /// it — a refused write is not a free turn.
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

  /// The id came out of a model argument, so it is looked up inside the project
  /// the toolset is closed over rather than on its own.
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

/// There is no tool that lists boards — the ids come from the instruction — so
/// the brief is the only thing standing between the model and a rebuild.
test("the brief names the boards a rebuild can be asked for, without reading their scenes", async () => {
  const { db, of } = fakeDb([photo("a")], [board("board-7", ["a"], { title: "Act two" })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  assert.match(brief, /The project holds 1 board:\nboard-7 · Act two · 1920×1080/);

  /// Never `elements`: a board's scene is megabytes, and a turn that never
  /// mentions a board would be paying for every one of them.
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
  /// The two the compositor's answer lost still reach the board — there were
  /// slots free for them — and the answer says they were seated rather than
  /// composed, because reading order is not a judgement about the look.
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

  /// One caption plus eleven photographs is the cap; three references never
  /// reached the compositor at all, and `unplaced` cannot see them.
  assert.equal(asked[0]!.blocks.length, 12);
  assert.deepEqual(result.notOffered, ["r12", "r13", "r14"]);
  assert.deepEqual(result.notFound, ["ghost"]);
  assert.ok(!(result.unplaced as string[]).includes("r14"));
});

/// Where agent 4 hands over to agent 3: a picture is contained in its slot, so
/// the board is written with page showing around the ones that are the wrong
/// shape for it, and the answer is what lets the orchestrator make the cut.
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
  /// The 1:2 portrait first: it covers a quarter of a cinema frame where the
  /// 4:3 covers three quarters.
  assert.deepEqual(
    loose.map((fit) => [fit.referenceId, fit.slotId, fit.cropTo]),
    [
      ["b", "img-2", "16:9"],
      ["a", "img-1", "16:9"],
    ],
  );
  /// The shape is one `crop_reference` already takes, so the hand-off costs no
  /// new declaration — and the note routes straight to it rather than stopping
  /// to ask whether the cut it would file is wanted.
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

/// A board with real geometry on it, which is what a scene read has to have and
/// the rebuild path never needed: `board()`'s elements only carry the ids.
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

/// A board as a compose left it: every picture in the box `fitInSlot` drew for
/// its slot, and the template it was composed at on the row. Built through the
/// layout constants rather than by hand, so the geometry a scene read matches
/// against is the geometry a compose writes.
function composedBoard(
  id: string,
  layout: MoodboardLayout,
  placed: readonly [string, string, number, number][],
  /// The page it stands on, for a board composed since pages existed. Left out
  /// for one composed before they did — every board in the app today — which is
  /// the case a rebuild has to give a page to rather than keep one for.
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

/// The read that stops a rebuild being used as a question. Before this, the only
/// way for the model to find out what a board held was to compose it again —
/// paying a model call and replacing the arrangement to answer "what is on it?".
test("inspect_board says what is on a board, in reading order, without touching it", async () => {
  const { db, of } = fakeDb(
    [photo("a", { title: "Dune" }), photo("b", { title: "Ridge" })],
    [arranged("board-7", [["b", 900, 0], ["a", 0, 0]])],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "inspect_board", { boardId: "board-7" });

  assert.equal(result.boardId, "board-7");
  /// The size the board's next page is drawn at. A board holding no page frame
  /// — which is what a hand-arranged one is — has no page list to give back.
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

  /// Nothing was written and no agent ran: this is a query, and the point of it
  /// is that it is cheaper than the call it replaces.
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("moodboard", "create").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "board");
  assert.equal(attachment?.kind === "board" && attachment.boardId, "board-7");
  /// Captioned by the page, since a board read off its scene has no template —
  /// and drawn as the arrangement, off the elements themselves.
  assert.equal(attachment?.kind === "board" && attachment.caption, "2 photographs · 1920×1080");
  assert.equal(attachment?.kind === "board" && attachment.preview?.items.length, 2);
});

/// What it was composed at, not a claim about where things are now: the
/// positions above are read off the scene, and the user may have dragged
/// half of it since.
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

/// A board of more than one page, which is the board every fixture above is not:
/// they are one page's worth of pictures with no frame around them, and that is
/// what a board made before pages existed still is.
///
/// The pages are emitted last, after the pictures, the way a composed scene emits
/// them — a frame's children come immediately before it in the array.
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

/// The pages of a board, listed on a read that was not asked for one. This is
/// where a page id comes from: the model cannot invent one, so a board read that
/// did not name its pages would leave the scoped read unreachable.
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
          /// Over the right edge of page 2 — its centre is on the page, so it is
          /// on it, and excalidraw draws it cut off there.
          ["d", 3800, 100],
          ["e", 6000, 100],
        ],
      ),
    ],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "inspect_board", { boardId: "board-7" });

  /// Reading order, not the order the frames are in the scene: the page drawn
  /// second and filed first is still page 1.
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
      clipped: 1,
    },
  ]);
  assert.match(String(result.pagesNote), /pageId/);

  /// The picture beside the pages rather than on one, which is the difference
  /// between the pages listed and the board — and the one thing a user
  /// reading page by page would never be shown.
  assert.deepEqual(result.picturesOnNoPage, ["e"]);

  /// The whole board is still the answer to a call that named no page.
  assert.deepEqual(
    (result.pictures as { id: string }[]).map(({ id }) => id),
    ["a", "c", "d", "e", "b"],
  );
});

/// §V.3 says which page a picture is on, and on a board whose pages the user
/// has dragged together the honest answer is one page: the topmost, which is the
/// one they can see it on. Described on both, the picture is counted twice in the
/// list, read twice in the two scoped reads, and offered to a compose of the page
/// underneath that will then leave it standing as the other page's — a board that
/// comes back holding it twice.
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
          /// Centre at 1200, which is inside both rectangles.
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
  /// And it is on a page, so it is not reported as loose on the canvas either —
  /// the key is left off entirely when nothing is.
  assert.equal(result.picturesOnNoPage, undefined);

  const under = await run(toolset, "inspect_board", { boardId: "board-7", pageId: "under" });
  assert.deepEqual(
    (under.result.pictures as { id: string }[]).map(({ id }) => id),
    ["a"],
  );

  /// And the arrangement said beside them: the blocks are boxes on *this* page,
  /// so a page described with the other one's picture in it is an arrangement the
  /// model reads positions out of that nothing on the page stands in.
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

/// The compose reads the page it is about in the page's own coordinates, and that
/// read decides which branch the call takes: a page still standing in its template
/// keeps its seats, a page that is not gets the hand-arranged rule. Counting a
/// photograph the page lying across this one holds, the page underneath reads as
/// pulled apart when it is not — so a call about it stops reflowing into the
/// template the user composed it at.
test("a compose about the page underneath is read from that page's own pictures", async () => {
  const split = layoutById("SPLIT")!;
  const row = composedBoard("board-7", split, [["a", "img-1", 400, 300]], {
    id: "under",
    name: "Act one",
  });
  (row.elements as unknown[]).push(
    /// On the page lying across this one, and in no slot of the page underneath —
    /// its centre is past the right-hand panel's edge.
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

/// The scoped read: what the compositor will be pointed at and what "the second
/// page" resolves to. A picture on another page of the same board is not in it.
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
  /// What a clipped picture *means*, said rather than left for the model to
  /// infer: the render shows a cut-off picture and that is an overflow, not a
  /// crop somebody chose.
  assert.match(String(result.clippedNote), /overflow/);
  assert.match(String(result.status), /Cold open/);

  /// A scoped read is about the page, so the list of pages and the pictures on
  /// none of them are the other call's answer.
  assert.equal(result.pages, undefined);
  assert.equal(result.picturesOnNoPage, undefined);

  /// Still a read, and the tile beside the reply is still the whole board — a
  /// page has no picture of its own until a tab has drawn one.
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");
});

/// tech-spec §V.1: the label is derived from the rectangle every time it is
/// read, so a page the user dragged off every preset reads as `Custom` —
/// which is also what tells the model a compose about that page will fit the
/// template into their rectangle rather than resize it. Every other page read
/// in this suite is at a preset, so the derivation is only asserted here.
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

/// tech-spec §V.4: the page is the only thing in the prompt that carries
/// arrangement. A list of ids in reading order says which pictures are on the
/// page and never where — so "the one on the left" and "put it under the
/// headline" are unanswerable, and the call the model reaches for instead is a
/// rebuild of a board it was only asked about.
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

  /// Measured against page 2's own corner, not against the board: "c" sits a
  /// hundred units into a page standing two thousand units along.
  assert.deepEqual(result.arrangement, [
    { kind: "image", referenceId: "c", box: [93, 52, 370, 260], z: 0 },
    { kind: "image", referenceId: "d", box: [93, 875, 370, 1000], z: 1, clipped: true },
  ]);
  /// Four integers per picture are read as pixels, x-first, on a canvas of
  /// unknown size unless the answer says otherwise.
  assert.match(String(result.arrangementNote), /\[ymin, xmin, ymax, xmax\]/);
  assert.equal(result.arrangementOmitted, undefined);

  /// Only on a scoped read: a box is a share of a page rect, and a board is an
  /// unbounded canvas with no rect to take a share of.
  const whole = await run(toolset, "inspect_board", { boardId: "board-7" });
  assert.equal(whole.result.arrangement, undefined);
  assert.equal(whole.result.arrangementNote, undefined);
});

/// A page id the model guessed at costs a round; a refusal that does not say
/// which ids would have worked costs a second one.
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

  /// And on a board that has no pages at all, the honest answer is that there
  /// are none to name rather than a list of one that does not exist.
  const none = await run(toolset, "inspect_board", { boardId: "board-8", pageId: "p1" });
  assert.match(String(none.result.error), /no page called p1/);
  assert.equal(none.result.pages, undefined);
  assert.match(String(none.result.pagesNote), /no pages/);
});

/// A board composed at a template can be *measured* against it later without
/// rebuilding it: the slot rectangles are constants and the board remembers
/// which template it was composed at, so the gap between a picture and its slot
/// is arithmetic over the scene. Before this, the only call that reported a
/// loose fit was the compose that placed it.
test("inspect_board says which pictures sit loosely in their slot, without composing anything", async () => {
  const split = layoutById("SPLIT")!;
  /// One picture at its panel's own shape and one far off it, so the report has
  /// to be about the mismatch rather than about being on the board.
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

  /// The letterbox in a near-square panel is loose; the one cut to the panel
  /// fills it and is not mentioned.
  assert.deepEqual(
    (result.looseInSlot as { referenceId: string; slotId: string; cropTo: string }[]).map(
      ({ referenceId, slotId, cropTo }) => [referenceId, slotId, cropTo],
    ),
    [["a", "img-1", "1:1"]],
  );
  assert.match(String(result.looseInSlotNote), /crop_reference/);
  /// Still a read: no compositor, no write, no run row.
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

/// The same measurement on a board that is pages. A template's slots are cut
/// against the origin, so read in board coordinates a picture on page 2 sits in
/// no slot at all and the gap around it could not be reported — a page with page
/// showing around every picture on it answered "nothing loose".
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

/// A read already scoped to one page says which page it is about in its own
/// answer, so naming it again on every line is the same fact bought per picture.
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

/// A board row carries one template id and it describes the board's first page
/// (§V.1). A read scoped to a page is an answer about that page, and the tile
/// beside it is already named by the narrower question — so a page read that
/// repeated the row's word would say one thing in the JSON and another in the
/// picture under it.
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
        /// Added after the compose and never laid out: the board is a SPLIT and
        /// this page is a rectangle.
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

  /// The board's own read is unchanged: the row is a fact about the board, and
  /// the answer says it is what it was last composed at.
  const whole = await run(toolset, "inspect_board", { boardId: "board-7" });
  assert.equal(whole.result.composedAs, "SPLIT");
});

/// The picture beside the answer, scoped the way the answer is (§V). The reply
/// under this tile is about one page of a spread, and a miniature of the whole
/// board shows the user the pages that reply says nothing about — on a board
/// of four, the thing being talked about is a quarter of the picture.
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
  /// One picture and its heading, drawn against page 2's own rectangle: the two
  /// on page 1 are not on this tile at all.
  assert.equal(tile?.kind === "board" ? tile.preview?.items.length : 0, 2);

  /// The unscoped read is the board, exactly as it was.
  const whole = await run(toolset, "inspect_board", { boardId: "board-7" });
  const [board] = whole.attachments ?? [];
  assert.equal(board?.kind === "board" && board.images, 3);
  assert.equal(board?.kind === "board" && board.caption.includes("page"), false);
});

/// The tool that exists so a variation does not cost the board being varied.
/// Every other board door here rewrites the board the user is looking at, so
/// "keep that one and try it with the tall shot" had two answers and both were
/// wrong: a rebuild in place replaces the arrangement that works, and a new
/// board asks the compositor to re-decide every slot from a set the model had to
/// restate off a read.
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
  /// The template travels with the scene: without it the copy is a board nobody
  /// composed, so nothing can measure what sits loosely on it and a rebuild of it
  /// picks a shape by block count instead of keeping the one being varied.
  assert.equal(data.layout, "SPLIT");
  assert.deepEqual((data.elements as { fileId: string }[]).map((el) => el.fileId), ["ref:a"]);

  /// Nothing was asked and nothing was decided: no compositor, no run row, and —
  /// the whole point — not one write to the board being copied.
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);

  assert.equal(result.copyOf, "board-7");
  assert.equal(result.pictures, 1);
  assert.equal(result.composedAs, "SPLIT");
  assert.match(String(result.status), /nothing on the board it was copied from changed/);

  /// Drawn as the arrangement it copied and clickable into the new board, so the
  /// user sees the variation they are about to change rather than a name.
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
    /// The boards read is taken once a turn, so without the turn's own list the
    /// second copy would be a second tab called "Act two (copy)".
    ["Act two (copy)", "Act two (copy 2)", "Night version"],
  );
});

/// The count and the list are one read, and the instruction is resolved per
/// round beside the declarations: a board counted but not listed is a round
/// told how to read and swap on a board the catalog it was handed has never
/// heard of.
test("a board composed this turn stands in the same turn's brief, not only in its count", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b")]);
  const { compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  await run(toolset, "compose_moodboard", { intention: "the ridge", referenceIds: ["a", "b"] });

  const brief = await toolset.brief();
  assert.match(brief, /board-1 · the ridge · 1920×1080 · SPLIT/);
  assert.equal((await toolset.state()).boards, 1);
  /// Folded into the read rather than re-read: the row was already in hand.
  assert.equal(of("moodboard", "findMany").length, 1);
});

/// And the same for the other tool that files one, where the copy has to stand
/// beside the board it was taken from rather than in place of it.
test("a copy made this turn stands in the brief beside the board it was made from", async () => {
  const { db } = fakeDb([photo("a")], [{ ...arranged("board-7", [["a", 0, 0]]), title: "Act two" }]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  await run(toolset, "duplicate_board", { boardId: "board-7" });

  const brief = await toolset.brief();
  assert.match(brief, /board-1 · Act two \(copy\)/);
  assert.match(brief, /board-7 · Act two/);
  assert.equal((await toolset.state()).boards, 2);
});

/// The other side of the tool that multiplies boards. `duplicate_board` gave the
/// assistant a way to make a second board and none to clear one up, and the
/// nearest call it could reach for "bin the first one" was a rebuild of the board
/// the user wanted gone. What it gets instead is an offer: this is the one
/// act in the project nothing can undo, so the last hand on it is theirs.
test("discard_board shows the board with the question on it, and deletes nothing", async () => {
  const split = layoutById("SPLIT")!;
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const source = composedBoard("board-7", split, [["a", "img-1", panel.width, panel.height]]);
  const { db, of } = fakeDb([photo("a")], [{ ...source, title: "Act two" }]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_board", { boardId: "board-7" });

  /// Nothing happened to the project: no delete, no write, no model call and no
  /// run row. One query, exactly like the read.
  assert.equal(of("moodboard", "delete").length, 0);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("moodboard", "create").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  /// What the discard would cost, because the model cannot see what is on a
  /// board — "shall I delete board-7" with nothing after it is a question the
  /// user cannot answer without going and looking.
  assert.equal(result.boardId, "board-7");
  assert.equal(result.title, "Act two");
  assert.equal(result.pictures, 1);
  assert.equal(result.pageSize, `${split.page.width}×${split.page.height}`);
  assert.equal(result.composedAs, "SPLIT");
  assert.match(String(result.status), /offered, not done/);
  /// A board of one page: its page *is* the board, so listing it would repeat
  /// the three lines above it.
  assert.equal(result.pages, undefined);
  assert.match(String(result.status), /never say the board is gone, deleted or removed/);

  /// The board's own tile, with the button on it: same id, same arrangement,
  /// same click into the tab row — what is being decided is whether to keep
  /// exactly this.
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

/// tech-spec §V: a discard takes a board, and a board is pages now. The offer
/// said "3 photographs · 1920×1080" for a spread — the size of its *default*
/// page and a count with no shape to it — which is the loss named as neither the
/// user nor the model would name it.
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
  /// Still the board's default page size rather than a page of it: the columns
  /// §V.1 renamed, said under the name they now have.
  assert.equal(result.pageSize, `${split.page.width}×${split.page.height}`);
});

/// The copy carries the source's page ids verbatim — the scene is written across
/// by value — so a model handed only the copy's boardId has to read the copy to
/// learn the ids it already knows, and a model that assumes a page id names one
/// page in the project would change the board it was asked to keep.
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

/// tech-spec §V: the page entity could be made three ways and unmade none. A
/// user who wanted one page gone was answerable only with discard_board,
/// which takes the pages they asked to keep.
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

  /// Nothing happened to the project: the button under the tile is what settles
  /// it, exactly as a board's discard is.
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("moodboard", "delete").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  /// What that page costs, page-deep — the loss counted by the same function
  /// that would take it.
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

  /// The page's own tile, with the button on it saying which page it takes: the
  /// user deciding about page 2 is shown page 2 (§V, iteration 18) and the
  /// browser needs the id, since after the write there is no frame to read a name
  /// off.
  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "board" && attachment.discard, true);
  assert.deepEqual(attachment?.kind === "board" && attachment.discardPage, {
    pageId: "page-2",
    name: "Act two",
  });
  assert.equal(attachment?.kind === "board" && attachment.images, 2);
  assert.match(String(attachment?.kind === "board" && attachment.caption), /“Act two”, page 2 of 2/);
});

/// A page going is not a board going, and the difference is the whole of what the
/// user is deciding between: the board stands with nothing on it, which
/// add_page can give a page back to.
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

/// The copy reads the board it copies, so it is queued on that board like every
/// other door that touches it — "fix the typo and then give me a version with the
/// tall shot" is one round, and the copy has to be of the board as the turn
/// leaves it rather than as it found it.
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

/// The copy starts at revision 0 holding exactly the scene the source's picture
/// was of, so that picture is a true picture of it — and a bucket copy is the
/// only way it can have one, since a board is only ever drawn by a tab that has
/// it open.
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

  /// Best effort: a board with no preview is what every new board is anyway, and
  /// failing a copy that landed would be the answer claiming less than happened.
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

/// A board the turn made is a board the next round can read, copy or edit — the
/// declarations are resolved per round and the copy is a board like any other.
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

  /// It is still on the board and still named — it is just not being measured
  /// against a slot the user has moved it out of.
  assert.equal((result.pictures as unknown[]).length, 1);
  assert.equal(result.looseInSlot, undefined);
  assert.equal(result.looseInSlotNote, undefined);
});

/// One board, one name. A live conversation showed the same board arriving as
/// "1 photograph · Split" from the compose that made it and "1 photograph ·
/// 1920×1080" from the read two messages later — two tiles for one thing.
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

  /// Moved out of its slot: the template is the shape the board *started* at, so
  /// the page is the only true thing left to say about it.
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

/// The last step of the crop→board loop, and the one that used to go through a
/// rebuild: a cut taken at the shape the loose-fit note asked for goes onto the
/// board *in the place the frame had*. A rebuild would have paid the compositor
/// to reassign every slot and handed back an arrangement nobody asked for.
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
  /// No compositor, no run row: there is no judgement left to buy once the place
  /// is settled, so a swap is the only board write in this file that is free.
  assert.equal(of("agentRun", "create").length, 0);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-7", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  /// Guarded, bumped, and the stored render disowned — it is a picture of the
  /// board as it was. The page and the template are untouched: a swap is not a
  /// reshape.
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);
  assert.equal(data.widthPx, undefined);

  const written = data.elements as { fileId: string; x: number; width: number }[];
  assert.deepEqual(
    written.map((element) => element.fileId),
    ["ref:cut", "ref:b"],
  );
  /// The cut was measured against the slot rather than against the box the
  /// letterbox was drawn in, so it now fills the panel.
  assert.equal(written[0]!.width, panel.width);
  /// And it comes off the loose list, which is the loop being seen to end.
  assert.equal(result.looseInSlot, undefined);
  assert.equal((attachments ?? []).length, 1);
  /// The board is still standing in its template — the cut was refit to the slot
  /// — so the tile keeps the name the compose gave it rather than swapping to
  /// the page halfway through the exchange.
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption, "2 photographs · Split");
});

/// The other half of the same edit, and the one that used to be refused: two
/// pictures the board already holds changing places. A rebuild was the only
/// route, which pays the compositor to reassign every slot in order to make a
/// move the user had already decided both ends of.
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

  /// Nothing joined the board and nothing left it, so it is reported apart from
  /// a replacement rather than as one.
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
  /// Each element kept its index, so z-order holds; each now carries the other
  /// picture, drawn against the slot it has landed in rather than against the
  /// box the other one was in.
  assert.deepEqual(
    written.map((element) => element.fileId),
    ["ref:b", "ref:a"],
  );
  assert.ok(written[0]!.height === first.height && written[0]!.width < first.width);
  assert.ok(written[1]!.width === second.width && written[1]!.height < second.height);
  /// Still standing in its template, so the tile keeps the name the compose gave
  /// it — a trade is not a rearrangement by hand.
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption, "2 photographs · Split");
});

/// tech-spec §V: a template's slots are cut against the origin, so the exchange
/// read the board flat and found no picture on page 2 sitting in anything. Two
/// things went wrong at once — the cut was re-boxed to the room the letterbox had
/// rather than to the panel, and the tile stopped calling a spread by its
/// template because no page past the first ever stood as composed.
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
  /// It fills the panel, and it fills the panel *on page 2* — a box measured
  /// against the constant would have put the cut on top of page 1.
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

/// The same window every server-side board write has: the read and the edit
/// straddle nothing here, but the user's own autosave can still land between
/// them, and the losing side is told rather than overwritten.
test("a board saved by the user mid-swap is refused rather than overwritten", async () => {
  const split = layoutById("SPLIT")!;
  const row = composedBoard("board-7", split, [["a", "img-1", 1000, 300]]);
  const { db } = fakeDb([photo("a"), photo("cut")], [row]);
  /// The user's autosave is a request of its own, so it can land at any
  /// moment — here, the instant the board has been read.
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
  /// Both entries were unreadable, and a refusal that does not count them reads
  /// as "you sent me nothing" to a model that sent two things.
  assert.equal(result.unreadable, 2);
});

/// tech-spec §V: a board is pages, and the same photograph is on two of them as
/// soon as a spread repeats a picture. Matched flat, "take that one off" lands on
/// whichever copy the scene array carries first — so a model that has just read
/// page 2 and is answering about it edits page 1 instead, and says it did not.
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
  /// Page 1's copy is the element it was, box and all; page 2's is the cut,
  /// fitted to page 2's own panel rather than to the template's constant.
  assert.deepEqual(
    written.filter((element) => element.fileId).map((element) => [element.id, element.fileId]),
    [["page-1-el-0", "ref:a"], ["page-2-el-0", "ref:cut"]],
  );
  const onPageTwo = written.find((element) => element.id === "page-2-el-0")!;
  assert.equal(onPageTwo.width, panel.width);
  assert.equal(onPageTwo.x, panel.x + split.page.width + PAGE_GAP);
});

/// The gaps left on the board's other pages are not what this call was about, and
/// a picture the page has not got is said as that rather than as "not on the
/// board" — the board may well hold it a page away, and the next call is then a
/// pageId rather than another guessed reference.
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

  /// Page 1's own empty slot is a gap on a page nobody asked about.
  assert.deepEqual(
    ((result.looseInSlot as { pageId?: string }[]) ?? []).map((fit) => fit.pageId),
    ["page-2"],
  );
  /// And the tile is of the page the exchange happened on, not of the spread:
  /// the picture that changed is the whole of what is in it.
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

/// A legibility ceiling truncates rather than refusing, which is right — and used
/// to do it in silence. The answer listed the four exchanges it made under a
/// status reading "done as a scene edit", so two cuts the user had taken
/// never reached the board and the reply said they had.
test("swap_on_board names the exchanges its ceiling cut off", async () => {
  const onBoard = Array.from({ length: SWAP_LIMIT + 2 }, (_, index) => `on-${index}`);
  const joining = Array.from({ length: SWAP_LIMIT + 2 }, (_, index) => `new-${index}`);
  const { db, of } = fakeDb(
    [...onBoard, ...joining].map((id) => photo(id, { width: 400, height: 400 })),
    /// Hand-arranged, because the ceiling is about how many exchanges run and
    /// no template seats SWAP_LIMIT + 2 pictures.
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
  /// The write still happened for the pairs under the ceiling: it drops work,
  /// it does not undo it.
  const written = (of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown } }).data
    .elements as { fileId: string }[];
  assert.deepEqual(
    written.slice(0, SWAP_LIMIT).map((element) => element.fileId),
    joining.slice(0, SWAP_LIMIT).map((id) => `ref:${id}`),
  );
});

/// One good pair beside one half pair: the half used to vanish, and the answer
/// about the good one read as an answer about both.
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
      "compose_moodboard",
      "generate_image",
    ],
  );

  /// The two reads the brief makes, and no third one: asking which tools the
  /// project can use has to be free or it is not a saving.
  await toolset.brief();
  await toolset.declarations();
  assert.equal(of("reference", "findMany").length, 1);
  assert.equal(of("moodboard", "findMany").length, 1);
});

test("an empty project is handed the one tool that needs no picture", async () => {
  const { db } = fakeDb([]);
  assert.deepEqual(
    (await referenceToolset({ db, projectId: "p1" }).declarations()).map(
      (tool) => tool.name,
    ),
    ["generate_image"],
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

  /// Counted in the closure rather than re-read: the round that filed the board
  /// is the round after which it can be read or swapped on, and a declaration
  /// list settled before the turn could not say so.
  const after = (await toolset.declarations()).map((tool) => tool.name);
  assert.ok(after.includes("inspect_board") && after.includes("swap_on_board"));
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
      "inspect_board",
      "add_page",
      "duplicate_page",
      "resize_page",
      "duplicate_board",
      "swap_on_board",
      "reword_on_board",
      "move_to_page",
      "read_canvas",
      "put_on_canvas",
      "remove_from_canvas",
      "transform_on_canvas",
      "reorder_on_canvas",
      "discard_page",
      "discard_board",
      "compose_moodboard",
      "design_page",
      "generate_image",
    ],
  );
});

/// The text half of the same argument the swap makes about pictures: changing
/// what a line *says* used to go through `compose_moodboard`'s
/// addCaptions/removeCaptions, which pays the compositor and reflows the board.
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
  /// No compositor and no run row: the words are the user's, the block is the
  /// one already carrying them, so there is no assignment to buy.
  assert.equal(of("agentRun", "create").length, 0);

  const write = of("moodboard", "updateMany")[0]!;
  assert.deepEqual((write.args as { where: unknown }).where, { id: "board-9", revision: 3 });
  const data = (write.args as { data: Record<string, unknown> }).data;
  /// The scene changed, so it is guarded, bumped and the stored render disowned —
  /// the render still has the typo in it. The page and the template are untouched.
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.renderRevision, null);
  assert.equal(data.layout, undefined);
  assert.equal(data.widthPx, undefined);
  assert.equal(data.title, undefined);

  const written = data.elements as { id: string; text?: string; x: number; width: number }[];
  assert.equal(written.length, 2);
  /// The picture is the very box the compose drew, and the line kept its own.
  const panel = split.slots.find((slot) => slot.id === "img-1")!;
  const drawn = fitInSlot(panel, { id: "a", kind: "image", width: 1000, height: 300 });
  assert.equal(written[0]!.id, "el-0");
  assert.deepEqual(
    { x: written[0]!.x, width: written[0]!.width },
    { x: drawn.x, width: drawn.width },
  );
  assert.equal(written[1]!.text, "Act two exteriors");
  assert.equal(written[1]!.x, 100);

  /// Nothing moved, so the board is still standing in its template and the tile
  /// keeps the name every other door gives it.
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
  /// Refused before the write rather than written as an empty change.
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
  /// The id is a model argument, so the read is scoped to the project the toolset
  /// is closed over rather than trusted.
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
  /// The user saves between the read and the write, which is the one window a
  /// scene edit has: the revision the executor is guarding on is no longer the
  /// row's.
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

  /// A blank `to` is not a deletion — taking a line off reflows the board, which
  /// is `compose_moodboard`'s job.
  const { result } = await run(toolset, "reword_on_board", {
    boardId: "board-9",
    rewordings: [{ from: "Act two", to: "  " }],
  });

  assert.match(String(result.error), /removeCaptions/);
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(result.unreadable, 1);
});

/// The words on a board are what the user reads, so a rewording dropped in
/// silence is a typo they were told was fixed and will find themselves.
/// tech-spec §V, the text half of the same argument the swap makes: a template
/// puts a heading in the same place on every page it composes, so a spread says
/// the same words twice as a matter of course. Matched flat, fixing the heading
/// on page 2 rewrites page 1's and tells the user page 2 now says it.
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
  /// The tile under a reply about one page's words carries that page's words —
  /// drawn from the whole spread it would show the line twice, once of it the
  /// old wording on a page nobody asked about.
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

/// A wording the *page* has not got, said as that: the board carries it a page
/// away, so the model's next call is a pageId rather than another quoted line.
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
  /// The four that ran are on the board, so the ceiling drops work rather than
  /// undoing it.
  const written = (of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown } }).data
    .elements as { text?: string }[];
  assert.ok(written.some((element) => element.text === "Act 1 exteriors"));
  assert.ok(written.some((element) => element.text === `Act ${REWORD_LIMIT + 1}`));
});

/// The six named shapes are the vocabulary the *model* has, and the widest of
/// them is narrower than the widest opening any template makes. A cut asked for a
/// board is therefore held to the slot itself: which opening a picture is sitting
/// in is a fact about the scene, not a judgement, so it is read rather than asked
/// for — the same division that has the model say which rectangle and the code
/// say which pixels.
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
    /// What the loose-fit report told it to ask for — the nearest name to a
    /// 3.52:1 strip, and the widest shape the declaration offers.
    aspect: "2.39:1",
    boardId: "bd1",
  });

  /// The cropper is told the shape so it frames for it, and the box is held to
  /// it here, where the frame's pixels are.
  assert.equal((asked[0] as { aspect: string }).aspect, "3.52:1");
  assert.equal(filedCut(of("reference", "create")).editAspect, "3.52:1");
  assert.equal(result.aspect, "3.52:1");
  /// Said, because it is not the shape that was asked for: a reply quoting the
  /// argument back would name a shape the cut is not.
  assert.match(String(result.heldToSlot), /held to 3\.52:1/);
  assert.match(String(result.heldToSlot), /img-2 slot/);

  /// And the row records what the ask actually cost, at the shape it was made at.
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

/// The same opening, read on a board that is pages: the slot the picture is
/// sitting in is only recognisable once the page's own corner is taken off it, so
/// a cut for page 2 was held to the nearest of six names while the identical cut
/// for page 1 was held to the opening itself.
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

/// A spread holding one picture twice, in two differently shaped openings (§V.3).
///
/// Both halves of what the board resolution carries are facts about *one page*:
/// the shape the cut is held to is that slot's, and the copy the swap takes off is
/// that page's. Without a page both are answered by whichever page reads first —
/// so a cut asked for the strip on page 2 came back cut to the hero on page 1, and
/// landed there.
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

  /// The strip on page 2, not the hero on page 1 that reading order would have
  /// answered with.
  assert.equal((asked[0] as { aspect: string }).aspect, "3.52:1");
  assert.equal(result.aspect, "3.52:1");
  assert.match(String(result.heldToSlot), /img-2 slot/);
  assert.match(String(result.heldToSlot), /“Act two”/);
  /// And the swap is the page-scoped one, made in this call: the picture stands
  /// on both pages of the spread and only the copy on page 2 changed.
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
  /// Unscoped, so the swap is against the board at large and lands on the copy
  /// reading order answers with — the one on page 1.
  assert.deepEqual(
    unpaged.elements.flatMap((element) => (element.fileId ? [element.fileId] : [])),
    ["ref:made-1", "ref:a"],
  );
});

/// Refused in the answer with the ids that would have worked, so a guessed page
/// costs a sentence rather than a photograph — this is read before the vision
/// call, like the unknown board beside it.
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

/// On the board and a page away. The cut is still worth making — the user
/// asked for it — so it is filed without the swap, and the answer says the
/// read was against one page rather than claiming the board does not hold it.
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
  /// The same correction the boardless branch carries — a page-scoped read is
  /// still a read that filed a cut and left the board alone — and the same call
  /// out of it, which needs the new row's id to be nameable at all.
  assert.match(
    String(result.notOnThatBoard),
    /the cut was filed and nothing on that board changed/,
  );
  assert.ok(!String(result.notOnThatBoard).includes("will not be put on it"));
  assert.match(String(result.notOnThatBoard), /swap_on_board with made-1/);
  assert.equal(result.heldToSlot, undefined);
  /// The cut is filed all the same — the user asked for it — and nothing on the
  /// board moved.
  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.deepEqual(
    (attachments ?? []).map((attachment) => attachment.kind),
    ["reference"],
  );
});

/// Refined, not overridden. The slot only replaces a shape the model asked for
/// when that shape is the nearest name to it — which is exactly what the
/// loose-fit report told it to pass. A user who says "square" gets a square.
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

/// A ratio the list does not name is never the nearest name to anything, so
/// naming one is also how a user overrides the opening — which is the same
/// rule as the square above, reached without having to be one of six.
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

/// A board the user dragged together has no opening to fill: the picture is
/// where their hands put it, and cutting it to a shape nobody is holding it to
/// would be the pipeline arguing with them.
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

/// A ratio is a ratio of pixels. Refining a frame whose size was never recorded
/// would turn an ask that works into the refusal `unfittableAspect` makes — and
/// it would make it after the photograph had been read.
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

/// The orchestrator runs a round's tool calls with `Promise.all`, so "swap those
/// two around and fix the typo in the headline" arrives as two edits of one board
/// at once. Both used to read the same revision: one write landed, the other was
/// told the board "was changed while I was editing it — the user has it open",
/// and the edit the user asked for was gone.
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
  /// The second was guarded on the revision the first left behind, which is only
  /// possible because it read the board after that write rather than beside it.
  const guards = writes.map((write) => (write.args as { where: { revision: number } }).where.revision);
  assert.deepEqual(guards, [3, 4]);

  /// Both changes are on the board the user is left with.
  const elements = fixture.elements as { type: string; fileId?: string; text?: string }[];
  assert.deepEqual(
    elements.filter((element) => element.type === "image").map((element) => element.fileId),
    ["ref:c", "ref:b"],
  );
  assert.equal(elements.find((element) => element.type === "text")?.text, "Act two exteriors");
});

/// Only the same board. Two boards edited in one round have nothing to say to each
/// other, and making the second wait would be a turn that answers slower for
/// nothing.
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

/// The compose that puts a headline on a board has to hand the chat the words,
/// not a count: the miniature draws a text block as a bar a few pixels tall, so
/// the tile beside "I've put the ACT ONE headline on it" said "4 photographs"
/// and showed a grey smudge.
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

/// The other door: a line reworded in place is read back off the scene, so the
/// tile under "I've changed it to ACT TWO" says ACT TWO.
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

/// The other half of the spec's ratio argument — "a specific ratio, or loose
/// square/rectangle". A user who says "make it square" has named a shape and
/// not a format, and the declaration used to tell the model to pass "1:1", which
/// is a ratio they never asked for and a box opened out to reach it.
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

  /// The cropper is given the words and the frame's pixels — the words so it
  /// frames that way, the pixels so the loop can tell whether it did.
  const sent = asked[0] as { aspect?: string; loose?: { id: string }; frame?: { width: number } };
  assert.equal(sent.aspect, undefined);
  assert.equal(sent.loose?.id, "square");
  assert.equal(sent.frame?.width, 4000);

  /// And the box is filed exactly as framed: there is no ratio to open it out
  /// to, which is the whole difference between the two vocabularies. The word is
  /// what the row records, since the pixels answer "what shape is it" and can
  /// never answer "what was asked".
  const filed = filedCut(of("reference", "create"));
  assert.deepEqual(filed.cropBox, [100, 200, 900, 800]);
  assert.equal(filed.editAspect, "square");

  /// The answer says what was asked for and what came out, because a loose cut
  /// is held to no ratio and a reply naming one would name a promise nobody made.
  assert.equal(result.aspect, undefined);
  assert.match(String(result.framedAs), /roughly square/);
  assert.match(String(result.framedAs), /came out 1:1/);

  const [created] = of("agentRun", "create");
  assert.equal(
    (created!.args as { data: { input: { aspect: string } } }).data.input.aspect,
    "square",
  );
});

/// Refined on the same rule the exact vocabulary uses, read the same way: the
/// slot replaces the ask when the opening already *is* the shape they asked for.
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

  /// A 3.52:1 strip is a landscape rectangle, so the ask is satisfied exactly by
  /// filling the opening — and the cut stops being loose.
  const sent = asked[0] as { aspect?: string; loose?: unknown };
  assert.equal(sent.aspect, "3.52:1");
  assert.equal(sent.loose, undefined);
  assert.equal(result.aspect, "3.52:1");
  assert.equal(result.framedAs, undefined);
  assert.match(String(result.heldToSlot), /held to 3\.52:1/);
});

/// And the abstention that matters: a scope-shaped opening is not a square, so a
/// user who asked for one is not answered with a strip.
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

/// The properties agent 2 already wrote, for pictures the model has the ids of.
/// It used to be the door to a *reading* — jobs filed with the analyzer's queue,
/// nothing in the answer but a promise. These are about the answer being the
/// thing it was asked for, and about the half of an analysis no digest carries.
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
  /// The palette and the rationale are the reason this is worth a round beside
  /// list_references: digestTags drops both, so no primed line and no catalog
  /// answer anywhere in the layer carries them.
  assert.deepEqual(read!.palette, ["#1b2a41", "#c9a227"]);
  assert.equal(read!.rationale, "Warm light on cold rock, both read as one plane.");
  /// Under the dimension names agent 2 wrote them in, rather than flattened into
  /// the one list a catalog line carries: the question this is called for is
  /// "what is the light like", and a flat list makes the model guess which of
  /// the words are about light.
  assert.deepEqual(read!.lighting, ["Golden hour"]);
  assert.deepEqual(read!.contrastDepth, ["Layered depth"]);
  /// And not the flattened list beside them — the same words twice, under a name
  /// that means something else on a catalog line.
  assert.equal("tags" in read!, false);
  /// Agent 2's name and the shape, so the answer stands on its own.
  assert.equal(read!.title, "The ridge at dusk");
  assert.equal(read!.shape, "4:3");

  /// Nothing is asked of anybody: no job filed, no run row, no vision call.
  assert.equal(of("agentRun", "create").length, 0);
  /// And nothing is put in front of the user. What the chat shows is
  /// show_references' decision, and a lookup that dropped four tiles into the
  /// conversation unasked takes it away.
  assert.equal(attachments, undefined);
});

/// Every field would come back empty for a picture nobody has read, and an empty
/// palette beside an empty rationale reads as a picture with no colour in it —
/// the blank the unread marks exist to stop being read as a fact. So it is left
/// out of the answer and named beside it, which is the §I rule: an id the model
/// asked about and got nothing back for is a silence.
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
  /// The next step is the user's own — nothing in this list files a reading
  /// any more, and naming a call the model does not have is a round spent
  /// finding that out.
  assert.match(String(result.notReadNote), /properties panel/);
  assert.equal(String(result.notReadNote).includes("read_references"), false);
  /// An id that answers to no picture is a different fact from one that answers
  /// to a picture with nothing stored, and they stay two lists.
  assert.deepEqual(result.notFound, ["ghost"]);
});

/// A picture the queue has not got to yet is not a failure and not a plain
/// picture either — it carries its own mark, so the reply can say the properties
/// are on their way rather than that there are none.
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

/// The worst-lit picture in the project used to be the one the assistant drew
/// itself: filed a minute ago, minutes ahead of the analyzer, and the only
/// account of what it shows — the description it was drawn at — sitting on its
/// row unread by anything. The conversation carries no tool calls, so by the
/// next turn the model has forgotten what it asked for.
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
  /// The blank is still a blank for the photograph beside it, and the note has
  /// to carve out the one line that is not.
  assert.match(String(result.notReadNote), /unless one carries a “drawn from”/);
  assert.match(String(result.drawnFromNote), /what to vary/);
});

/// The mark the catalog puts on a drawing used to be dropped the moment the
/// picture was looked at closely — referenceProperties rebuilt its answer off
/// the digest and left `made` behind — so a backdrop the assistant invented read
/// back as a photograph the user shot.
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
  /// What was asked for and what a reader found are two different sentences,
  /// and the answer carries both.
  assert.equal(read!.rationale, "Warm light on cold rock, both read as one plane.");
  assert.equal(result.notRead, undefined);
  assert.match(String(result.drawnFromNote), /what was asked for/);
});

/// The turn-wide count this used to keep was protecting a vision call per
/// picture. There is none left to protect: a second ask re-reads rows that are
/// already written, off the read the turn has already taken.
test("the same picture asked about twice in one turn is answered twice", async () => {
  const { db, of } = fakeDb([photo("a", { analysis: READING })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const first = await run(toolset, "read_references", { referenceIds: ["a"] });
  const second = await run(toolset, "read_references", { referenceIds: ["a"] });

  assert.equal((first.result.read as unknown[]).length, 1);
  assert.deepEqual(second.result.read, first.result.read);
  /// And it costs no query of its own: the project's references are read once
  /// per turn and both calls answer off that.
  assert.equal(of("reference", "findMany").length, 1);
});

/// A full analysis is several times a catalog line, so the ceiling is about what
/// fits in an answer. Per call rather than across the turn — and what it cut off
/// is named, because a request that came back with nothing reads to the user
/// as a picture with nothing in it.
test("the ceiling names the pictures whose properties it did not look up", async () => {
  const ids = Array.from({ length: READ_LIMIT + 2 }, (_, index) => `u${index}`);
  const { db } = fakeDb(ids.map((id) => photo(id, { analysis: READING })));
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "read_references", { referenceIds: ids });
  assert.equal((result.read as unknown[]).length, READ_LIMIT);
  assert.deepEqual(result.notLookedUp, ids.slice(READ_LIMIT));
  assert.match(String(result.notLookedUpNote), /ask for these in another call/);

  /// And the next call answers them, rather than being told the turn is spent.
  const rest = await run(toolset, "read_references", {
    referenceIds: ids.slice(READ_LIMIT),
  });
  assert.deepEqual(
    (rest.result.read as { id: string }[]).map((read) => read.id),
    ids.slice(READ_LIMIT),
  );
});

test("the reader is declared for any project with a picture in it", async () => {
  /// The gate used to be the stalled pictures, which is now exactly backwards:
  /// stalled is the pictures with no properties, and properties are the whole of
  /// what this answers with. On a project agent 2 had finished with it was the
  /// one tool declared; it is now the one tool that project can always use.
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

/// The chat could name a cut and the tool cropped it — a box inside a box, which
/// can only ever take *less* of the photograph than the cut already holds, filed
/// as a version of a version that the properties panel has no way in at: the
/// gallery does not list such a row and the panel opens on frames, so the cut
/// would be filed where nobody could reach it. The panel's own answer is
/// `adjust` — the frame, asked again with the cut's box attached — and this is
/// that, reached from the chat.
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

  /// The frame's bytes, not the cut's, with the cut's own box as the thing being
  /// moved — and at the shape that cut was made at, which nobody restated.
  const ask = asked[0] as { gcsUri: string; previous?: unknown; aspect?: string };
  assert.equal(ask.gcsUri, "gs://director-bucket/uploads/a.jpg");
  assert.deepEqual(ask.previous, { cropBox: [100, 200, 700, 800], editIntent: "the doorway" });
  assert.equal(ask.aspect, "16:9");
  /// And the pixels cut are the frame's too, which is the same claim about a
  /// different call: the box that comes back is a fraction *of the frame*, so
  /// cutting the row the model named would take that fraction out of a picture
  /// that is already a piece of it — a crop of a crop, arrived at silently, and
  /// the one answer `cropNudge` exists to refuse.
  assert.deepEqual(
    seam.cuts.map((made) => made.gcsUri),
    ["gs://director-bucket/uploads/a.jpg"],
  );

  /// What is filed is a second cut of the frame, *beside* the one it improves
  /// on rather than in its place: two rows for "tighter" is the price of not
  /// deleting a picture that may already be on a board.
  assert.equal(result.referenceId, "made-1");
  assert.equal(result.cutOf, "a");
  assert.equal(filedCut(of("reference", "create")).sourceReferenceId, "a");
  assert.match(String(result.nudgeOf), /cut-1 is untouched/);
  assert.match(String(result.nudgeOf), /filed as a second cut of a/);
  assert.match(String(result.nudgeOf), /discard/);
  /// Not the two clauses this sentence replaced. Both rows exist before the
  /// model reads any of this, so a nudge described as offered — or an old cut
  /// that only goes when the new one is taken — is the last place in the answer
  /// that would send the model back to writing about a decision.
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

/// The row's shape is the default, not the answer: naming one is asking for a
/// different cut of the same subject.
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

/// The board is standing on the cut, so the cut is what the new one replaces —
/// swapping the frame out would take off a picture the board does not hold and
/// leave the old cut exactly where it was.
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

  /// The old cut came off, not the frame — which the board does not hold.
  assert.deepEqual(
    standing.elements.flatMap((element) =>
      element.fileId?.startsWith("ref:") ? [element.fileId] : [],
    ),
    ["ref:made-1"],
  );
  /// And it is held to the opening the *cut* is sitting in, read off the scene by
  /// the cut's own id.
  assert.equal((asked[0] as { aspect?: string }).aspect, "3.52:1");
  assert.match(String(result.status), /in place of cut-1/);
});

/// An ordinary cut replaces the frame it was drawn on, so the answer names no
/// picture to take off: saying it would be the same id twice on every crop.
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

/// A cut drawn before the box was recorded, or a row whose columns are empty:
/// there is nothing to move, and the nested crop is the one thing that must not
/// happen silently instead.
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

/// Found by the live run of iteration 52 and it cost the turn's whole point: the
/// model nudged a cut that was standing on a board, was told nothing about the
/// board, and closed the loop the only way it could see — `swap_on_board` with
/// the *old* cut. That lands, reads as correct, and leaves the new cut off the
/// board — so the user is told a board is sorted while it still stands on the
/// picture they asked to be different.
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
  /// The cut, not the frame it is a nudge of: that is the picture the board is
  /// standing on and the one a swap would have to take off.
  assert.match(note, /“Board bd1” \(bd1\), which is standing on cut-1/);
  assert.doesNotMatch(note, /bd2/);
  assert.match(note, /call swap_on_board with the cut's id/);
  /// One read of the column priming refuses, and only because the crop got as far
  /// as a filed row — the scenes are megabytes and every other turn pays nothing.
  assert.equal(of("moodboard", "findMany").filter((call) => "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {})).length, 1);
});

/// With a board there is nothing to add: the swap says the cut is on it and
/// `notOnThatBoard` says why it is not, and a third sentence about the same board
/// would be the model told twice and asked to choose.
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

/// A project with no boards, and a picture on none of the boards it has: the
/// commonest crop in the app, and it must not buy a read of every scene to find
/// that out.
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

/// A refusal reached before there is a box has no board news, because there is
/// no cut to put anywhere — and it must not pay for the scenes to say so.
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

/// The reference half of the same offer `discard_board` makes, and the reason is
/// the same one: nothing stops the server deleting the row, and what stops it is
/// that this cannot be walked back. What it has to say that a board's does not is
/// the *reach* — the cuts cascade, and every board showing the picture or one of
/// its cuts is left with a hole — none of which the model can see.
test("discard_reference offers the picture with what it would take with it, and deletes nothing", async () => {
  const { db, of } = fakeDb(
    [photo("a", { title: "Ridge study" }), cut("a1", "a"), cut("a2", "a1"), photo("b")],
    [arranged("board-7", [["a1", 0, 0]]), { ...arranged("board-8", [["b", 0, 0]]), title: "Act two" }],
  );
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "a" });

  /// Nothing happened: no delete, no write, no model call and no run row.
  assert.equal(of("reference", "delete").length, 0);
  assert.equal(of("reference", "update").length, 0);
  assert.equal(of("agentRun", "create").length, 0);

  assert.equal(result.referenceId, "a");
  assert.equal(result.title, "Ridge study");
  /// The cascade, said as the cuts it is — including the cut of the cut, which
  /// nothing in the gallery links back to the frame being removed.
  assert.deepEqual(
    (result.cutsThatWouldGoWithIt as { id: string }[]).map((made) => made.id),
    ["a1", "a2"],
  );
  /// The frame is on no board itself; its cut holds one up. That is exactly the
  /// case a plain "which boards show this" read answers "none" to.
  assert.equal(result.onBoards, undefined);
  assert.deepEqual(result.boardsShowingItsCuts, [{ id: "board-7", title: "Board board-7" }]);
  assert.match(String(result.gap), /swap_on_board/);
  assert.match(String(result.status), /offered, not done/);
  assert.match(String(result.status), /never say the picture is gone, deleted or removed/);

  /// The picture's own tile with the button on it — same id, same click into the
  /// gallery — carrying what the browser has to say after the row has gone.
  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "reference");
  assert.equal(attachment?.kind === "reference" && attachment.referenceId, "a");
  assert.equal(attachment?.kind === "reference" && attachment.discard?.cuts, 2);
  assert.deepEqual(attachment?.kind === "reference" && attachment.discard?.boards, [
    { id: "board-7", title: "Board board-7" },
  ]);
});

/// A cut and a photograph are different news, and the model has to say which:
/// removing a cut leaves the frame it came out of standing.
test("a cut offered for removal names the frame that stays", async () => {
  const { db } = fakeDb([photo("a"), cut("a1", "a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_reference", { referenceId: "a1" });

  assert.match(String(result.cutOf), /^a — this is a cut/);
  assert.equal(result.cutsThatWouldGoWithIt, undefined);
  assert.equal(result.gap, undefined);
});

/// And what stays is named by what it is. A cut inherits its frame's provenance
/// when it is written, so the cut's own column answers the question about the
/// picture behind it — a crop of a backdrop the assistant drew leaves a drawn
/// picture in the gallery, not a photograph the user shot.
test("a cut of a drawn picture reports a drawn picture standing behind it", async () => {
  const { db } = fakeDb([
    photo("a", { origin: "GENERATED" }),
    cut("a1", "a", { origin: "GENERATED" }),
  ]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "a1" });

  assert.match(String(result.cutOf), /^a — this is a cut, and the drawn picture it was cut from/);

  /// The tile the Remove button sits on carries the same column, because the
  /// sentence the browser writes afterwards is written when the row is gone.
  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "reference" && attachment.origin, "GENERATED");
});

/// A photograph is worded as it always was, and its tile claims nothing about a
/// column it has no interesting value for.
test("a photograph offered for removal says nothing about how it was made", async () => {
  const { db } = fakeDb([photo("a"), cut("a1", "a")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result, attachments } = await run(toolset, "discard_reference", { referenceId: "a1" });

  assert.match(String(result.cutOf), /and the photograph it was cut from stays in the gallery/);
  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind === "reference" && attachment.origin, undefined);
});

/// A board showing the photograph *and* a cut of it is named once, on the side
/// the user can check by looking at it.
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

/// tech-spec §V: "on “Cold open”" about a three-page spread is a question the
/// user cannot answer and a hole the model cannot fill in the right place —
/// `swap_on_board` takes a pageId, and without one it edits whichever copy the
/// scene array carries first.
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
  assert.match(String(result.pages), /pass that pageId to swap_on_board/);
});

/// The board of one page is the page: naming it twice says nothing, so the
/// answer it gave before pages existed is the answer it goes on giving.
test("a removal from a board of one page says nothing about pages", async () => {
  const { db } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "discard_reference", { referenceId: "a" });

  assert.deepEqual(result.onBoards, [{ id: "board-7", title: "Board board-7" }]);
  assert.equal(result.pages, undefined);
});

/// The scenes are the one column priming refuses, so a project with no board
/// must not pay for a read that can only answer "none".
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

/// tech-spec §V.4–5: the page the *user* attached, as the model reads it.
/// `inspect_board` is a board the model chose; this is one they chose, and the
/// only thing the browser is authoritative for in it is the picture.

/// Where the picture of an attached page would have been put. Injected the way
/// the board render's copy is, because the real one names a bucket out of the
/// environment and a test has none.
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
  /// The two ids every board tool takes, so "put the doorway on this page" is
  /// answerable without a round of inspect_board to find out which page "this" is.
  assert.match(said, /The tools reach it as boardId board-7, pageId page-2\./);
  /// The one picture on page 2, with the catalog's own words for it — and
  /// neither of the two on page 1.
  assert.match(said, /\nc · the doorway · 4:3 · \[\d+,\d+,\d+,\d+\] · Golden_hour, Landscape$/);
  assert.equal(said.includes("\na · "), false);
  /// The scene is read against the project, not just against the id the browser
  /// sent: an id is client input here exactly as it is in a tool argument.
  const read = of("moodboard", "findMany").find((call) =>
    "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {}),
  );
  assert.deepEqual((read!.args as { where: unknown }).where, {
    id: { in: ["board-7"] },
    projectId: "p1",
  });
});

/// The client is authoritative for the picture and for nothing else — least of
/// all for which object in the bucket the model is pointed at.
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

/// A picture of a page that no longer exists is worse than no picture. The page
/// still goes up — the arrangement is read fresh off the row either way — and the
/// text is what says the model is looking at nothing.
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

/// The user's own selection box rather than a model argument: there is
/// nobody in the loop to refuse to, so a page the server cannot stand behind is
/// dropped rather than described.
test("a pageId naming no page on the board it names is not attached at all", async () => {
  const { db } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts, pages } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-9", revision: 3 },
  ]);

  assert.deepEqual(parts, []);
  assert.deepEqual(pages, []);
});

/// Each page is an image part plus a text block riding on every tool round of
/// the turn, so the cap is on the thing whose size the turn's shape multiplies.
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

/// §V.4's `layout?` is "the template, if composed" — a claim about the page in
/// front of the model. The row carries one template id and it describes the
/// board's *first* page (§V.1), so on a spread it is as often as not the wrong
/// word for the page attached: one composed at something else, one `add_page`
/// drew, or one the user has pulled apart since.
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

/// The commonest case of the same thing: a board composed at a template, given
/// another page by `add_page`, and that page attached. Nothing is on it, and
/// the sentence above the boxes would otherwise have called it a SPLIT.
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

/// tech-spec §V.1/§V.4: `preset` is "Custom when resized", and it is the one
/// thing about a page's size the two numbers do not say. A user who dragged
/// a page bigger and attached it is the case where it decides an answer — the
/// compose fits the template into their rectangle rather than resizing the page
/// (iteration 20's rule), and the model had no way to know that from the brief.
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

/// Every board in the app until the user drags one, and the reason the line
/// above is spent only where it says something.
test("an attached page still at a preset says nothing about its size", async () => {
  const { db } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([
    { boardId: "board-7", pageId: "page-2", revision: 3 },
  ]);

  assert.equal((parts[0] as { text: string }).text.includes("the user's own"), false);
});

/// A message with nothing attached is the ordinary one, and it must not buy the
/// scene read — the elements are the column priming refuses on every other turn.
test("a message with no page attached reads no scenes", async () => {
  const { db, of } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([]);

  assert.deepEqual(parts, []);
  assert.equal(of("moodboard", "findMany").length, 0);
});

/// tech-spec §V: a board is pages, so "put that one on the other page" is an
/// ordinary sentence about it — and until `move_to_page` there was no call that
/// meant it. The one the model would reach for is a page-scoped swap, which puts
/// the picture in the place of one on the target page and leaves the copy on the
/// page it came from, so the board carries the photograph twice.
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
  /// Once on the board, not once per page: the whole reason this is not a swap.
  assert.equal(items.filter((item) => item.referenceId === "b").length, 1);
  /// And it is the page's child, so the user dragging that page takes it.
  const landed = (data.elements as { fileId?: string; frameId?: string }[]).find(
    (element) => element.fileId === "ref:b",
  );
  assert.equal(landed?.frameId, "page-2");

  /// The tile is the page the picture landed on — a reply saying "it is on act
  /// two now" beside a miniature of the whole spread shows the page it is not
  /// about.
  const [tile] = attachments ?? [];
  assert.equal(tile?.kind === "board" && tile.caption.startsWith("“Act two”, page 2 of 2"), true);
});

/// The target page was standing exactly as its template composed it, and the
/// newcomer is below the slots rather than in one. Offered rather than done: a
/// rebuild is an arrangement the user did not ask for.
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

/// A picture the source page has not got is a pageId to correct rather than a
/// reference id — the board may well hold it a page away.
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

/// Refused with the ids that would have worked, as every page refusal here is:
/// a guessed page id costs one round and two if the refusal sends it guessing.
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

/// One page named twice is a call that would take a picture off a page and put
/// it back on it, which is a rearrangement nobody asked for.
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

/// The geometric read behind the four canvas edits: handles, boxes, z — and
/// the titles only the executor can join on. It writes nothing, runs nothing
/// and attaches nothing: the declaration says it shows nothing, so a tile
/// beside it would be a picture the answer never mentioned.
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
  /// The handle is the element id, never the reference id — the same photo
  /// placed twice is two objects, and this is the field that tells them apart.
  assert.deepEqual(
    objects.map(({ objectId, kind, referenceId, title }) => [objectId, kind, referenceId, title]),
    [
      ["el-0", "image", "a", "Dune"],
      ["el-1", "image", "b", "Ridge"],
    ],
  );
  /// Loose on a pageless canvas, so the box is scene pixels, y-first.
  assert.equal(objects[0]!.boxUnit, "px");
  assert.deepEqual(objects[0]!.box, [0, 0, 300, 400]);
  assert.deepEqual([objects[0]!.z, objects[1]!.z], [0, 1]);

  assert.equal(of("moodboard", "updateMany").length, 0);
  assert.equal(of("agentRun", "create").length, 0);
  assert.equal(attachments, undefined);
});

test("read_canvas of a page the board has not got refuses with what would have worked", async () => {
  const { db, of } = fakeDb([photo("a")], [arranged("board-7", [["a", 0, 0]])]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const { result } = await run(toolset, "read_canvas", { boardId: "board-7", pageId: "ghost" });

  assert.match(String(result.error), /no page called ghost/);
  assert.match(String(result.pagesNote), /no pages/);
  assert.equal(of("moodboard", "updateMany").length, 0);
});

/// The put is a guarded scene edit like every other server-side board write:
/// revision-matched, bumped, the stored render disowned — and the answer
/// carries the new element's id, which is the handle every later edit takes.
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
  /// The box was [100, 500, 400, 900] y-first in scene pixels, and the 4:3
  /// photo fills the 4:3 box exactly — contained, not stretched.
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

/// One selector can sweep several elements — a referenceId takes every copy —
/// and what matched nothing is named back rather than dropped.
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

/// The write is guarded and the remainders are named: an id that matched
/// nothing is not a handle, and the note says where handles come from.
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

/// The no-op skip: a change asking for what is already true writes nothing —
/// no spurious revision conflict for an open tab, no render disowned.
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

/// The cap lives in the executor — the pure module transforms whatever it is
/// handed — so this is where the surplus has to be named rather than dropped.
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

/// The bug most likely to look done and not be: a moved element keeping its
/// fractional index silently restores the old order on the next editor mount.
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
  /// The moved element's index is deleted so excalidraw's restore re-derives
  /// it from array order; the untouched one keeps its own.
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

/// The declaration flattens the union destination into three sibling fields,
/// so the executor is what answers a move naming none of them or two at once.
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

/// The canvas edits queue behind whatever else the turn is doing to the same
/// board: a copy asked for beside a transform is of the board as the turn
/// leaves it, not as it found it.
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


/// The one tool that makes a picture. Everything it does after the model
/// answers is the import path's ending — bucket, row, analyzer job — so what
/// these assert is that the ending is reached, that the picture is placeable in
/// the same turn it was drawn in, and that a refusal is still a run the ledger
/// sees.

/// What one generation comes to. Different from the other three fixtures for
/// the reason they differ from each other: a row carrying another agent's
/// tokens is the mistake worth failing on.
const GENERATE_USAGE = { promptTokens: 40, outputTokens: 1490, totalTokens: 1530 };

/// A PNG as far as the header read is concerned: the signature, IHDR, and the
/// two dimensions the row is filed with.
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

/// The bucket and the analyzer's wake-up, as a test holds them: one records the
/// bytes it was handed, the other records that it was rung.
function filing(gcsUri = "gs://director-bucket/projects/p1/references/made.png") {
  const stored: { contentType: string; bytes: Uint8Array }[] = [];
  const kicks: number[] = [];
  return {
    stored,
    kicks,
    storeImage: async (contentType: string, bytes: Uint8Array) => {
      stored.push({ contentType, bytes });
      return gcsUri;
    },
    kickAnalyzer: () => kicks.push(1),
  };
}

test("a generated picture is stored, filed as a reference and queued for reading", async () => {
  const { db, of } = fakeDb([]);
  const { asked, generate } = drawing();
  const { stored, kicks, storeImage, kickAnalyzer } = filing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, storeImage, kickAnalyzer });

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

  /// The bytes went to the bucket before the row was written, under the type
  /// the model said they were.
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.contentType, "image/png");
  assert.equal(kicks.length, 1);

  const written = (of("reference", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(written.projectId, "p1");
  assert.equal(written.origin, "GENERATED");
  assert.equal(written.generationPrompt, "A warm grey paper texture, lit flat, no grain");
  assert.equal(written.title, "A warm grey paper texture");
  /// Off the PNG's own header, with no image library anywhere near it.
  assert.equal(written.width, 1376);
  assert.equal(written.height, 768);

  /// The row and the analyzer's job in one transaction, exactly as an upload.
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

/// The run row the panel reads, on the most expensive call in the product.
test("a generation writes its own run row and what it spent", async () => {
  const { db, of } = fakeDb([]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  await run(toolset, "generate_image", { description: "a dusk gradient", aspect: "landscape" });

  const opened = (of("agentRun", "create")[0]!.args as { data: Record<string, unknown> }).data;
  assert.equal(opened.agent, "IMAGE_GENERATOR");
  assert.equal(opened.status, "RUNNING");
  /// The label the shape is known by, not the word the model typed.
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

/// A picture the model would not draw is a run that happened: the tokens it
/// took to reach the refusal are on the row, and the sentence is the model's.
test("a refused generation fails its run row and carries the tokens", async () => {
  const { db, of } = fakeDb([]);
  const refusal = Object.assign(new ImageGeneratorError("the image model would not draw that: no"), {
    usage: GENERATE_USAGE,
  });
  const generate = (async () => {
    throw refusal;
  }) as never;
  const { stored, kicks, storeImage, kickAnalyzer } = filing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, storeImage, kickAnalyzer });

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
  /// Nothing was filed and nothing was woken: there is no picture.
  assert.equal(of("reference", "create").length, 0);
  assert.equal(stored.length, 0);
  assert.equal(kicks.length, 0);
});

/// The call never landing is not the model refusing, and Vertex answers a busy
/// image model with an HTML page. The orchestrator is about to write a sentence
/// to the user out of whatever it is handed, so it is handed a sentence — and
/// the page stays on the run row, where it is a diagnostic rather than a reply.
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
  const { stored, kicks, storeImage, kickAnalyzer } = filing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, storeImage, kickAnalyzer });

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


/// The ceiling is per turn rather than per round, so a model given three rounds
/// cannot draw a picture in each of them.
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

/// The refusals cost the same money and spend the same places, so the ceiling
/// still closes the turn — but the sentence that closes it cannot tell a model
/// with nothing in hand to show the user what it drew.
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
  /// The third ask is refused before the money, exactly as the capped turn's is.
  assert.equal(of("agentRun", "create").length, GENERATE_CALL_LIMIT);
  assert.equal(of("reference", "create").length, 0);
});

/// The turn that drew one picture and lost the other: the ceiling holds, and the
/// count in the sentence is the one the user can actually see.
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

/// A shape that cannot be read is refused before the money: the user asked for
/// it, so drawing at some other shape would be a background of the wrong shape
/// under a reply saying it is the right one.
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

/// The whole reason the tool is worth a round: the id it answers with resolves
/// against the turn's own read, so the picture can be placed on the round after
/// it was drawn rather than after the user sends another message.
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
  /// Still one read of the project: the row was folded into it rather than
  /// bought a second time.
  assert.equal(of("reference", "findMany").length, 1);
});

/// The name is derived rather than typed, so two of them landing identical is
/// the product's doing and not the user's — and "the same thing but bluer" opens
/// on the clause the title is cut from, which is how two different asks arrive
/// at one name.
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
  /// Off the read the turn already had, with the first row folded into it.
  assert.equal(of("reference", "findMany").length, 1);
});

/// A photograph they uploaded is a name in the same gallery, so the drawing is
/// kept clear of it too — the collision the user sees is between two tiles.
test("a picture is named clear of the photographs already in the project", async () => {
  const { db } = fakeDb([photo("p-1", { title: "A warm grey paper texture" })]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  const { result } = await run(toolset, "generate_image", {
    description: "A warm grey paper texture, lit flat",
  });

  assert.equal(result.title, "A warm grey paper texture (2)");
});

/// The picture also changes what the project *is*, and the declarations are
/// resolved per round — so the round after the first picture is the round the
/// tools that list and arrange pictures arrive on, which is what the
/// declaration's own sentence promises an empty project.
test("the picture an empty project was given brings the rest of the tools with it", async () => {
  const { db } = fakeDb([]);
  const { generate } = drawing();
  const toolset = referenceToolset({ db, projectId: "p1", generate, ...filing() });

  assert.deepEqual((await toolset.declarations()).map((tool) => tool.name), ["generate_image"]);

  await run(toolset, "generate_image", { description: "a paper texture" });

  const after = (await toolset.declarations()).map((tool) => tool.name);
  assert.ok(after.includes("list_references") && after.includes("show_references"), after.join());
  /// And it is counted as one this assistant drew, not as one they brought:
  /// the prose steering the next round reads this number, and a project whose
  /// every picture came out of this tool has nothing of theirs to prefer.
  assert.deepEqual(await toolset.state(), {
    photographs: 1,
    crops: 0,
    boards: 0,
    generated: 1,
  });
});

/// An exact ratio the drawing API has no canvas for rides the prompt, and a
/// prompt is a request — so what came back is measured and said when it is not
/// what was asked for.
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

/// Bytes that never reached the bucket are not a reference, and the reply must
/// not describe a picture that is not in the project.
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
  /// The call was still paid for, so the row still carries what it cost.
  assert.equal(spentOf(failed).totalTokens, 1530);
});

/// The other half of that: bytes that reached the bucket but no row. The tool
/// layer's house rule is that nothing throws at the model, and this is the one
/// path where a throw would also strand the most expensive run row in the file
/// at RUNNING with its tokens unrecorded.
test("a picture whose row could not be written is refused with its cost recorded", async () => {
  const { db, of } = fakeDb([]);
  const { generate } = drawing();
  const { stored, kicks, storeImage, kickAnalyzer } = filing();
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
  });

  const { result, attachments } = await run(toolset, "generate_image", { description: "a wash" });

  assert.match(String(result.error), /could not be filed/);
  assert.equal(result.imageId, undefined);
  assert.equal(attachments, undefined);
  /// Drawn and stored, so the bucket was written to and the analyzer was not
  /// rung for a row that does not exist.
  assert.equal(stored.length, 1);
  assert.equal(kicks.length, 0);

  const failed = of("agentRun", "update")[0]!;
  assert.equal((failed.args as { data: Record<string, unknown> }).data.status, "FAILED");
  assert.equal(spentOf(failed).totalTokens, 1530);
});

/// Agent 8's door (compositor-v2.md §VI). The tool is a call to another agent
/// and nothing else — every refusal it can make it makes for itself — so what
/// is asserted here is the three things only the turn knows: what was handed
/// over, what the user is shown afterwards, and the turn's one design.

/// A design, faked at the seam agent 8 is injected through. Records what the
/// door was handed and answers with whatever the test wants back.
function designing(answer: Partial<DesignPageAnswer & { error: string; runId: string }> = {}) {
  const asked: Record<string, unknown>[] = [];
  const design = (async (args: Record<string, unknown>) => {
    asked.push(args);
    if (typeof answer.error === "string") {
      return { error: answer.error, ...(answer.runId && { runId: answer.runId }) };
    }
    return {
      line: "The sign reads across the top third, with the two portraits under it.",
      boardId: String(args.boardId ?? ""),
      calls: ["read_canvas", "put_on_canvas"],
      runId: "run-8",
      ...answer,
    };
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
    /// Untrimmed on purpose: the door holds it to a trim of its own, and the
    /// intention is the user's words rather than this turn's reading of them.
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
  /// The turn's own two tallies rather than a fresh pair (§VII), asserted here
  /// as shape and below as spending.
  assert.deepEqual(budget, { generations: { asked: 0, filed: 0 }, crops: { asked: 0, filed: 0 } });
  /// Agent 8's own closing line, the way agent 4's note rides out of a compose.
  assert.match(String(result.line), /reads across the top third/);
  assert.deepEqual(result.designed, ["read_canvas", "put_on_canvas"]);
});

/// The three optional arguments are left off rather than passed empty: a
/// `pageId: ""` reaching the door is a page named badly rather than a page not
/// named, and the two are different asks (§VI).
test("design_page passes only the arguments it was given", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { asked, design } = designing();
  const toolset = referenceToolset({ db, projectId: "p1", design });

  await run(toolset, "design_page", { boardId: "board-7", intention: "a poster", imageIds: [] });

  assert.deepEqual(Object.keys(asked[0]!).sort(), [
    "boardId",
    /// Always handed over, unlike the three optional arguments: a design with
    /// no budget is a design with a ceiling of its own (§VII).
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

  /// Read once before the design, so the turn is holding a scene that is by
  /// now several revisions old.
  await run(toolset, "inspect_board", { boardId: "board-7" });
  const { result, attachments } = await run(toolset, "design_page", {
    boardId: "board-7",
    intention: "a welcome sign",
  });

  assert.equal(result.boardId, "board-7");
  assert.equal(attachments?.[0]?.kind === "board" && attachments[0].boardId, "board-7");
  /// The board was read again for it rather than remembered: agent 8 wrote that
  /// scene through the canvas tools for as many rounds as the design took, and
  /// a tile drawn from the turn's copy shows the page as it was before the ask.
  assert.equal(of("moodboard", "findFirst").length, 2);
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
  /// The one thing the user must not be told is that a half-finished page is
  /// finished, and the sentence that prevents it names the tool that can check.
  assert.match(String(result.stoppedNote), /inspect_board/);
});

test("one design a turn, and the second is stopped before agent 8 is reached", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { asked, design } = designing();
  const toolset = referenceToolset({ db, projectId: "p1", design });

  for (let call = 0; call < DESIGN_CALL_LIMIT; call += 1) {
    const { result } = await run(toolset, "design_page", {
      boardId: "board-7",
      intention: "a welcome sign",
    });
    assert.equal(result.error, undefined);
  }

  const { result, attachments } = await run(toolset, "design_page", {
    boardId: "board-7",
    intention: "another version",
  });
  assert.equal(result.error, DESIGN_CEILING_SAID);
  assert.equal(attachments, undefined);
  assert.equal(asked.length, DESIGN_CALL_LIMIT);
});

/// The ceiling is spent by what reached a model, not by what was called. Agent
/// 8's door refuses a board of another project before any AgentRun exists, and
/// a model that named the wrong board should be able to name the right one with
/// the turn it has left.
test("a design refused above the run row does not spend the turn's design", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const asked: Record<string, unknown>[] = [];
  /// Refuses the board it does not hold and designs the one it does, so the
  /// second call in this turn is the model correcting itself rather than a
  /// second design.
  const design = (async (args: Record<string, unknown>) => {
    asked.push(args);
    return args.boardId === "board-7"
      ? { line: "done", boardId: "board-7", calls: [], runId: "run-8" }
      : { error: `no board called ${args.boardId} in this project` };
  }) as unknown as typeof designPage;
  const toolset = referenceToolset({ db, projectId: "p1", design });

  const refused = await run(toolset, "design_page", { boardId: "board-9", intention: "a sign" });
  assert.match(String(refused.result.error), /no board called board-9/);

  const again = await run(toolset, "design_page", { boardId: "board-7", intention: "a sign" });
  assert.equal(again.result.error, undefined);
  assert.equal(asked.length, 2);
});

/// And the other side of that rule: a design that reached the loop and threw
/// inside it did spend one — the rounds before the throw are on a run row, and
/// it says so by answering with the run it opened.
test("a design that threw inside the loop spends the turn's design", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const { asked, design } = designing({ error: "vertex is down", runId: "run-8" });
  const toolset = referenceToolset({ db, projectId: "p1", design });

  await run(toolset, "design_page", { boardId: "board-7", intention: "a sign" });
  const again = await run(toolset, "design_page", { boardId: "board-7", intention: "a sign" });

  assert.equal(again.result.error, DESIGN_CEILING_SAID);
  assert.equal(asked.length, 1);
});

/// Queued on the board it designs, like every other write to one — and it holds
/// that queue for the length of a loop rather than of a call. A page added in
/// the middle of a design is a rectangle arriving on a scene being arranged
/// around it, and the revision guard would throw one of the two writes away.
test("a design holds the board's queue until it is finished", async () => {
  const { db } = fakeDb([photo("a")], [board("board-7", ["a"])]);
  const order: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const design = (async (args: Record<string, unknown>) => {
    order.push("design started");
    await held;
    order.push("design finished");
    return { line: "done", boardId: String(args.boardId), calls: [], runId: "run-8" };
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

/// §VII's sharing, in both directions. `GENERATE_CALL_LIMIT` and
/// `CROP_CALL_LIMIT` are per turn and one budget between the two agents, and a
/// design is not a turn — it runs inside one. Two tallies would let a turn draw
/// two pictures here and two more inside the design, and neither agent could
/// see it: each one's count would be right about itself.
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
  /// A design that spends the turn's generations rather than one of its own —
  /// what `imageToolset` does with the same object, without a loop in the way.
  const design = (async ({ budget }: { budget: { generations: { asked: number; filed: number } } }) => {
    budget.generations.asked = GENERATE_CALL_LIMIT;
    budget.generations.filed = GENERATE_CALL_LIMIT;
    return { line: "done", boardId: "board-7", calls: ["generate_image"], runId: "run-8" };
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
    return { line: "done", boardId: "board-7", calls: ["crop_image"], runId: "run-8" };
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
