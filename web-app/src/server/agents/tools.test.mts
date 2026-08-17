import { test } from "node:test";
import assert from "node:assert/strict";

import { referenceToolset } from "./tools";
import { CROP_CALL_LIMIT, READ_LIMIT, REWORD_LIMIT, SHOWN_LIMIT, SWAP_LIMIT } from "@/lib/agent/agent-tools";
/// Through the alias, not through `./cropper`: the executor imports it that
/// way, and under the test runner the two specifiers resolve to two copies of
/// the module — so an error built from the relative one is not `instanceof` the
/// class the executor is checking against.
import { CropperError } from "@/server/agents/cropper";
import { MODELS } from "@/server/google/vertex";
import { PAGE_GAP, fitInSlot, layoutById } from "@/lib/layout/moodboard-layouts";
import { boardPages, pageFrame, pageItems } from "@/lib/pages/board-pages";
import { boardItems } from "@/lib/boards/board-contents";
import type { MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import type { CropperResult } from "./cropper";
import type { CompositorResult } from "./compositor";
import type { PrismaClient } from "@/generated/prisma/client";

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
  /// The director's star, as the column holds it. On the fixture rather than left
  /// undefined because it is the one field here they wrote themselves, and a
  /// falsy-by-omission column tests nothing about the one that is set.
  isFavorite: boolean;
  gcsUri: string;
  thumbGcsUri: string | null;
  source: { id: string; title: string } | null;
  analysis: Record<string, string[]> | null;
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
  elements: { id: string; type: string; fileId?: string }[];
};

function board(id: string, referenceIds: readonly string[], over: Partial<BoardRow> = {}): BoardRow {
  return {
    id,
    title: `Board ${id}`,
    revision: 3,
    widthPx: 1920,
    heightPx: 1080,
    layout: null,
    elements: referenceIds.map((referenceId, index) => ({
      id: `el-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
    })),
    ...over,
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
  /// The project row itself — what the director called the work and what they
  /// wrote it was for. Two columns nothing but the priming reads.
  named: { title: string; brief: string } = { title: "p1", brief: "" },
) {
  const calls: Call[] = [];
  let runs = 0;
  let boards = 0;

  const record = <T,>(table: string, op: string, answer: (args: Record<string, unknown>) => T) =>
    async (args: Record<string, unknown>) => {
      calls.push({ table, op, args });
      return answer(args);
    };

  const db = {
    reference: { findMany: record("reference", "findMany", () => rows) },
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
      /// Unguarded, the way the director's own rename is: the title is not part
      /// of the document an open tab is autosaving.
      update: record("moodboard", "update", (args) => {
        const where = args.where as { id: string };
        const data = args.data as { title: string };
        const row = boardRows.find((entry) => entry.id === where.id);
        return { id: where.id, title: data.title ?? row?.title };
      }),
      create: record("moodboard", "create", (args) => {
        const data = args.data as { title: string };
        return { id: `board-${++boards}`, title: data.title };
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
        if (typeof data.title === "string") hit.title = data.title;
        if (data.layout !== undefined) hit.layout = data.layout;
        if (typeof data.widthPx === "number") hit.widthPx = data.widthPx;
        if (typeof data.heightPx === "number") hit.heightPx = data.heightPx;
        hit.revision += 1;
        return { count: 1 };
      }),
    },
  };

  const of = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op);
  return { db: db as unknown as PrismaClient, calls, of };
}

/// The catalog half of a primed turn, by line. A brief now opens with a block
/// of the director's own — what they called the project and what they wrote it
/// was for — so a test about a photograph's line reads the block that holds it
/// rather than counting from the top of the instruction.
const catalogOf = (brief: string) => (brief.split("\n\n")[1] ?? "").split("\n");

const BOX = { ymin: 200, xmin: 200, ymax: 800, xmax: 800 };

/// What one photograph read comes to, and what one text call comes to. The
/// numbers are arbitrary; that they are *different* is the point, since the
/// thing worth asserting is that a crop's row and a board's row do not end up
/// carrying each other's.
const CROP_USAGE = { promptTokens: 1800, outputTokens: 120, totalTokens: 1920 };
const COMPOSE_USAGE = { promptTokens: 900, outputTokens: 60, totalTokens: 960 };

/// The four columns a run row records a spend in, off whatever write put them
/// there.
const spentOf = (write: { args: unknown }) => {
  const { model, promptTokens, outputTokens, totalTokens } = (
    write.args as { data: Record<string, unknown> }
  ).data;
  return { model, promptTokens, outputTokens, totalTokens };
};

function cropping(answer: Partial<CropperResult> = {}) {
  const asked: unknown[] = [];
  const crop = async (input: unknown) => {
    asked.push(input);
    return {
      model: "gemini-pro",
      box: BOX,
      intent: "the middle sunflower",
      rationale: "the subject fills the centre third",
      attempts: 1,
      usage: CROP_USAGE,
      ...answer,
    } as CropperResult;
  };
  return { asked, crop: crop as never };
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

/// The director's own statement of what the work is, which sat in a column
/// nothing read while the header rendered it above the chat. It opens the
/// priming because every line under it is read against it.
test("the director's brief reaches the model, off two small columns", async () => {
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
  /// The project's own name first — the director's word for the work — then the
  /// photographs by line and the cuts by count, the count being the only reason
  /// left to spend a round on list_references.
  assert.match(brief, /^This project is called “p1”\./);
  assert.match(brief, /The project holds 1 photograph: 1 cut has been made of them\.\na · a · 4:3/);
  assert.ok(!brief.includes("gs://"), brief);
});

test("the catalog is the photographs, and the crops only when asked for", async () => {
  const rows = [photo("a"), photo("cut", { source: { id: "a", title: "a" }, editIntent: "hands" })];
  const { db } = fakeDb(rows);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const plain = (await run(toolset, "list_references")).result as { total: number; references: { id: string }[] };
  assert.deepEqual(plain.references.map((r) => r.id), ["a"]);
  assert.equal(plain.total, 1);

  const withCrops = (await run(toolset, "list_references", { includeCrops: true })).result as {
    references: { id: string; croppedFrom?: string }[];
  };
  assert.deepEqual(withCrops.references.map((r) => r.id), ["a", "cut"]);
  assert.equal(withCrops.references[1]!.croppedFrom, "a");
});

/// The star already decided the order the model is shown the gallery in. Read
/// off the same row it sorts by, it becomes a fact the model can act on rather
/// than an ordering it cannot see the reason for.
test("a picture the director starred reaches the model marked, off the same read", async () => {
  const { db, of } = fakeDb([photo("a", { isFavorite: true }), photo("b")]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  const lines = catalogOf(brief);
  assert.equal(lines[1], "a · a · starred · 4:3 · Golden_hour, Landscape");
  assert.equal(lines[2], "b · b · 4:3 · Golden_hour, Landscape");
  assert.match(lines[3]!, /the director starred in the gallery/);
  assert.equal(of("reference", "findMany").length, 1);
});

/// Agent 4 decides which picture the board is *about* — the largest slot — and
/// the director has already answered that question with a star. Without it on
/// the block, that judgement is made from tags a machine read while the
/// director's own answer sits one column away.
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

  const withCrops = (await run(toolset, "list_references", { includeCrops: true })).result as {
    references: { id: string; unread?: string }[];
    unreadNote?: string;
  };
  assert.equal(withCrops.references[1]!.unread, "pending");
  assert.match(String(withCrops.unreadNote), /has not been read by the property analyzer/);

  /// The photographs alone are all read, so that answer says nothing about it.
  const photosOnly = (await run(toolset, "list_references")).result as { unreadNote?: string };
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
  assert.match(String(result.notShownNote), /not put in front of the director/);
  assert.equal(result.notFound, undefined);
});

test("an unknown tool is answered rather than thrown", async () => {
  const { db } = fakeDb([]);
  const toolset = referenceToolset({ db, projectId: "p1" });
  assert.match(String((await run(toolset, "build_deck")).result.error), /no tool called build_deck/);
});

test("crop_reference offers a cut, files a run row and never says it saved one", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping({ attempts: 2 });
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the middle sunflower",
    aspect: "16:9",
  });

  /// The uri reaches agent 3 from the row, not from anything the model wrote.
  assert.equal((asked[0] as { gcsUri: string }).gcsUri, "gs://director-bucket/uploads/a.jpg");
  assert.match(String(result.status), /offered, not filed/);
  assert.equal(result.referenceId, "a");
  assert.ok(!JSON.stringify(result).includes("gs://"));

  const [attachment] = attachments ?? [];
  assert.equal(attachment?.kind, "crop");
  assert.equal(attachment?.kind === "crop" && attachment.offer.referenceId, "a");
  assert.equal(attachment?.kind === "crop" && attachment.offer.aspect, "16:9");

  const [created] = of("agentRun", "create");
  assert.deepEqual((created!.args as { data: { input: unknown } }).data.input, {
    referenceId: "a",
    prompt: "the middle sunflower",
    aspect: "16:9",
    via: "orchestrator",
  });
  const [finished] = of("agentRun", "update");
  const data = (finished!.args as { data: { status: string; output: { attempts: number } } }).data;
  assert.equal(data.status, "SUCCEEDED");
  /// What the ask cost, on the row: a box got right first time and one reached
  /// on the third read are the same crop and not the same bill.
  assert.equal(data.output.attempts, 2);
  /// And what the reads came to, in columns rather than in `output`: this is the
  /// one thing about a run that is summed across every row of a project, and a
  /// sum over JSON is a sum the database cannot do.
  assert.deepEqual(spentOf(finished!), { model: "gemini-pro", ...CROP_USAGE });
});

/// The expensive case is the one that answers with nothing. A ledger that only
/// counted the successes would say a bad afternoon was cheap.
test("a crop the cropper gave up on records what giving up cost", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const crop = (async () => {
    throw Object.assign(new CropperError("no usable box"), { usage: CROP_USAGE });
  }) as never;
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  await run(toolset, "crop_reference", { referenceId: "a", intention: "the hands" });
  const [failed] = of("agentRun", "update");
  assert.equal((failed!.args as { data: { status: string } }).data.status, "FAILED");
  /// The error names no model — the cropper only ever calls one — so the column
  /// is filled from the same constant the agent reads.
  assert.deepEqual(spentOf(failed!), { model: MODELS.PRO, ...CROP_USAGE });
});

test("a crop of a frame this project does not hold costs nothing", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result } = await run(toolset, "crop_reference", { referenceId: "b", intention: "the hands" });
  assert.match(String(result.error), /no reference called b/);
  assert.equal(asked.length, 0);
  assert.equal(of("agentRun", "create").length, 0);
});

test("a format asked of a frame with no recorded size is refused before the read", async () => {
  const { db, of } = fakeDb([photo("a", { width: null, height: null })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result } = await run(toolset, "crop_reference", { referenceId: "a", intention: "  " });
  assert.match(String(result.error), /say what to crop/);
  assert.equal(asked.length, 0);
});

/// The spec asks for "a specific ratio, or loose square/rectangle" and the
/// declaration used to offer six names. A director asking for a print format got
/// the nearest of the six and was told nothing about the substitution.
test("a shape the list does not name is cut at exactly that shape", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the doorway",
    aspect: "5:4",
  });

  /// Cut at 1.25:1, not at the 4:3 that is nearest to it — and the cropper is
  /// told the shape it is framing for, in the one spelling everything downstream
  /// reads back.
  assert.equal((asked[0] as { aspect: string }).aspect, "1.25:1");
  assert.equal(result.aspect, "1.25:1");
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.aspect, "1.25:1");
  const [created] = of("agentRun", "create");
  assert.equal(
    (created!.args as { data: { input: { aspect: string } } }).data.input.aspect,
    "1.25:1",
  );
});

/// The other half of widening the vocabulary: a string that is not a shape at
/// all used to be dropped, and the cut was then framed around the subject under
/// a reply saying it was held to the format the director asked for.
test("a shape that cannot be read is refused before the read, not dropped", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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

/// The crop→board loop's last turn, removed. A cut asked for a board carries
/// that board on the offer, and the browser that files the cut makes the swap —
/// so the model is told not to make it, rather than being sent back for a third
/// turn to make a call that is free but not roundless.
test("a crop asked for a board carries it on the offer and says the swap is not needed", async () => {
  const { db } = fakeDb([photo("a"), photo("b")], [board("bd1", ["a", "b"], { title: "Ridge" })]);
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "1:1",
    boardId: "bd1",
  });
  const attachment = attachments?.[0];
  assert.deepEqual(attachment?.kind === "crop" && attachment.offer.forBoard, {
    boardId: "bd1",
    title: "Ridge",
  });
  assert.match(String(result.status), /put on “Ridge” in place of this frame/);
  assert.match(String(result.status), /Do not call swap_on_board/);
  assert.equal(result.notOnThatBoard, undefined);
});

/// The cut is still worth having — the director asked for it — so the board is
/// dropped rather than the crop refused. What must not happen silently is the
/// swap never coming.
test("a crop asked for a board the frame is not on is offered without it, and says so", async () => {
  const { db } = fakeDb([photo("a"), photo("b")], [board("bd1", ["b"], { title: "Ridge" })]);
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.forBoard, undefined);
  assert.match(String(result.notOnThatBoard), /a is not on “Ridge”/);
  assert.match(String(result.status), /offered, not filed/);
  assert.ok(!String(result.status).includes("Ridge"));
});

/// Read before the vision call, like every other refusal this tool can make: a
/// board id the model invented costs a sentence rather than a photograph.
test("a crop for a board of another project is refused before the read", async () => {
  const { db, of } = fakeDb([photo("a")], [board("bd1", ["a"])]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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

test("the turn's crop budget is spent once, not once per round", async () => {
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  for (const id of ["a", "b"]) {
    const { result } = await run(toolset, "crop_reference", { referenceId: id, intention: "the subject" });
    assert.equal(result.error, undefined);
  }
  const { result } = await run(toolset, "crop_reference", { referenceId: "c", intention: "the subject" });
  assert.match(String(result.error), /already offered/);
  assert.equal(asked.length, CROP_CALL_LIMIT);
});

test("a box that is the whole frame ends the run as a failure with the reason on it", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { crop } = cropping({ box: { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 } });
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "all of it",
  });
  assert.match(String(result.error), /the whole frame is the shot/);
  assert.equal(attachments, undefined);
  const data = (of("agentRun", "update")[0]!.args as { data: { status: string; error: string } }).data;
  assert.equal(data.status, "FAILED");
  assert.match(data.error, /the whole frame is the shot/);
});

test("a cropper that throws is recorded as a failed run rather than a 500", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const crop = (async () => {
    throw new Error("cropper returned no content");
  }) as never;
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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
/// a canvas. It is what makes the arrangement one thing the director can name and
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
  /// director's board carried before the call.
  const rebuilt = await run(toolset, "compose_moodboard", {
    intention: "add the third one",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });
  assert.deepEqual(rebuilt.result.page, { pageId: "page-7", name: "Cold open" });
});

/// The arrangement is what a rebuild replaces; the page is the board's. A page
/// renamed by the director and then rebuilt used to come back as "Page 1" with a
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
  /// not a child of it is a page the director drags away from a third of a board.
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

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "the second page needs the doorway",
    boardId: "board-7",
    pageId: "page-2",
    addReferenceIds: ["d"],
  });

  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
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
/// copies the director is looking at stayed where they were.
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
/// out to the director — "I put the doorway beside the rooftop, so the board
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
/// the director will see there.
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

  /// Named as the director is about to see it named, and numbered past the pages
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

/// A picture the director dragged off the page onto the canvas beside it is
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
/// over the arrangement the director is looking at.
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
  /// The two pictures are on it, where the director left them, and owned by it —
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
/// the director means the pictures already on it — which the executor reads off
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
/// "nothing changed" would leave the director believing their words went on it.
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

/// The board the rebuild path could not be allowed near. A board the director
/// dragged together has no template to reflow into, so `layoutForBoard` picks one
/// from the block count and the rebuild writes it over their arrangement — which
/// makes "put the sunset on that too" a deletion of the board rather than an
/// addition to it.
///
/// Everything below is about the same call taking the other branch: no model
/// call, no run row, and every element that was already there returned as the
/// object it was.
test("a picture put on a board the director arranged by hand joins it without a compose", async () => {
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
/// picture dragged out of its slot is an arrangement the director made, and a
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
/// page the director had dragged about landed under the *board* — beneath the
/// widest page, on no page at all, where nothing can read it and no compose will
/// ever pick it up again.
function draggedSpread() {
  const split = layoutById("SPLIT")!;
  const spread = spreadBoard("board-7", split, [
    { id: "page-1", name: "Cold open", placed: [["a", "img-1", 400, 300], ["b", "img-2", 400, 300]] },
    { id: "page-2", name: "Act two", placed: [["c", "img-1", 400, 300]] },
  ]);
  /// Page two's picture dragged out of its slot: an arrangement the director made
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

test("a picture put on a page of a hand-arranged spread lands on that page", async () => {
  const { spread, page } = draggedSpread();
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c"), photo("d")], [spread]);
  const { asked, compose } = composing([]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "put the doorway on the second page too",
    boardId: "board-7",
    pageId: "page-2",
    addReferenceIds: ["d"],
  });

  assert.equal(asked.length, 0);
  assert.deepEqual(result.added, ["d"]);
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
  /// owned by its frame, so the director dragging the page takes it with them.
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
test("a line put on a board the director arranged by hand is set above it without a compose", async () => {
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

  /// The director's tab saves between the read and the write, which is the one
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
/// the headline the director set on it.
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
  /// A wording the board does not carry is the model quoting the director rather
  /// than the board, and only they can say which line was meant.
  assert.deepEqual(result.linesNotOnBoard, ["a line nobody set"]);
  assert.match(String(result.linesNotOnBoardNote), /inspect_board/);
});

/// The board is a thing the director already owns and has already named. A
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
  /// director may have open is autosaving against that revision — and the stored
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

/// The board is the thing the director has been looking at, and its shape is
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
  assert.match(String(result.layoutChanged), /was a SPLIT/);
  assert.equal(
    (of("moodboard", "updateMany")[0]!.args as { data: { layout: string } }).data.layout,
    "FILMSTRIP",
  );
});

/// A board with no template on it is one the director dragged together, and that
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

/// A rebuild is a write to a document a tab may have open. The tab that loses
/// gets a conflict it can reload out of; the assistant gets a sentence.
test("a board changed while the compositor was composing is not overwritten", async () => {
  const boards = [board("board-7", ["a"], { revision: 9 })];
  const { db, of } = fakeDb([photo("a")], boards);
  const { compose } = composing([{ blockId: "a", slotId: "img-1" }]);
  /// The director's own save lands while the compositor is thinking — the one
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
  assert.deepEqual(Object.keys(select).sort(), ["heightPx", "id", "layout", "title", "widthPx"]);
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
/// shape for it, and the answer is what lets the orchestrator offer the cut.
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
  /// new declaration — and the note says to ask before spending a crop on it.
  assert.match(String(result.looseInSlotNote), /crop_reference/);
  assert.match(String(result.looseInSlotNote), /Ask first/);
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
/// positions above are read off the scene, and the director may have dragged
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
  /// between the pages listed and the board — and the one thing a director
  /// reading page by page would never be shown.
  assert.deepEqual(result.picturesOnNoPage, ["e"]);

  /// The whole board is still the answer to a call that named no page.
  assert.deepEqual(
    (result.pictures as { id: string }[]).map(({ id }) => id),
    ["a", "c", "d", "e", "b"],
  );
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

/// The tool that exists so a variation does not cost the board being varied.
/// Every other board door here rewrites the board the director is looking at, so
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
  /// director sees the variation they are about to change rather than a name.
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

/// The other side of the tool that multiplies boards. `duplicate_board` gave the
/// assistant a way to make a second board and none to clear one up, and the
/// nearest call it could reach for "bin the first one" was a rebuild of the board
/// the director wanted gone. What it gets instead is an offer: this is the one
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
  /// director cannot answer without going and looking.
  assert.equal(result.boardId, "board-7");
  assert.equal(result.title, "Act two");
  assert.equal(result.pictures, 1);
  assert.equal(result.page, `${split.page.width}×${split.page.height}`);
  assert.equal(result.composedAs, "SPLIT");
  assert.match(String(result.status), /offered, not done/);
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
  /// against a slot the director has moved it out of.
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
/// move the director had already decided both ends of.
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
/// straddle nothing here, but the director's own autosave can still land between
/// them, and the losing side is told rather than overwritten.
test("a board saved by the director mid-swap is refused rather than overwritten", async () => {
  const split = layoutById("SPLIT")!;
  const row = composedBoard("board-7", split, [["a", "img-1", 1000, 300]]);
  const { db } = fakeDb([photo("a"), photo("cut")], [row]);
  /// The director's autosave is a request of its own, so it can land at any
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

  const { result } = await run(toolset, "swap_on_board", {
    boardId: "board-7",
    pageId: "page-2",
    swaps: [{ takeOff: "b", putOn: "cut" }],
  });

  /// Page 1's own empty slot is a gap on a page nobody asked about.
  assert.deepEqual(
    ((result.looseInSlot as { pageId?: string }[]) ?? []).map((fit) => fit.pageId),
    ["page-2"],
  );

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
/// status reading "done as a scene edit", so two cuts the director had taken
/// never reached the board and the reply said they had.
test("swap_on_board names the exchanges its ceiling cut off", async () => {
  const grid = layoutById("GRID_3X3")!;
  const onBoard = Array.from({ length: SWAP_LIMIT + 2 }, (_, index) => `on-${index}`);
  const joining = Array.from({ length: SWAP_LIMIT + 2 }, (_, index) => `new-${index}`);
  const { db, of } = fakeDb(
    [...onBoard, ...joining].map((id) => photo(id, { width: 400, height: 400 })),
    [
      composedBoard(
        "board-7",
        grid,
        onBoard.map((id, index) => [id, `img-${index + 1}`, 400, 400] as const),
      ),
    ],
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
  /// The write still happened for the four that ran: the ceiling drops work, it
  /// does not undo it.
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
    stalled: 0,
  });
  assert.deepEqual(
    (await toolset.declarations()).map((tool) => tool.name),
    [
      "list_references",
      "show_references",
      "crop_reference",
      "discard_reference",
      "compose_moodboard",
    ],
  );

  /// The two reads the brief makes, and no third one: asking which tools the
  /// project can use has to be free or it is not a saving.
  await toolset.brief();
  await toolset.declarations();
  assert.equal(of("reference", "findMany").length, 1);
  assert.equal(of("moodboard", "findMany").length, 1);
});

test("an empty project is handed no tools at all", async () => {
  const { db } = fakeDb([]);
  assert.deepEqual(
    await referenceToolset({ db, projectId: "p1" }).declarations(),
    [],
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
      "show_references",
      "crop_reference",
      "discard_reference",
      "inspect_board",
      "add_page",
      "duplicate_board",
      "swap_on_board",
      "reword_on_board",
      "discard_board",
      "compose_moodboard",
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
  /// No compositor and no run row: the words are the director's, the block is the
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

test("a reword loses to the director's own autosave rather than overwriting it", async () => {
  const split = layoutById("SPLIT")!;
  const row = titled("board-9", split, "Act two");
  const { db } = fakeDb([photo("a", { width: 1000, height: 300 })], [row]);
  /// The director saves between the read and the write, which is the one window a
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

/// The words on a board are what the director reads, so a rewording dropped in
/// silence is a typo they were told was fixed and will find themselves.
/// tech-spec §V, the text half of the same argument the swap makes: a template
/// puts a heading in the same place on every page it composes, so a spread says
/// the same words twice as a matter of course. Matched flat, fixing the heading
/// on page 2 rewrites page 1's and tells the director page 2 now says it.
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

  const { result } = await run(toolset, "reword_on_board", {
    boardId: "board-7",
    pageId: "page-2",
    rewordings: [{ from: "the heading", to: "ACT TWO" }],
  });

  assert.deepEqual(result.reworded, [{ from: "THE HEADING", to: "ACT TWO" }]);
  assert.deepEqual(result.page, { pageId: "page-2", name: "Act two" });
  assert.match(String(result.status), /“Act two”/);

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
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
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
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.aspect, "3.52:1");
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
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect?: string }).aspect, "3.52:1");
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.aspect, "3.52:1");
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
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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

/// Refined, not overridden. The slot only replaces a shape the model asked for
/// when that shape is the nearest name to it — which is exactly what the
/// loose-fit report told it to pass. A director who says "square" gets a square.
test("a shape the director asked for that is not the slot's is left alone", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "1:1",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "1:1");
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.aspect, "1:1");
  assert.equal(result.heldToSlot, undefined);
});

/// A ratio the list does not name is never the nearest name to anything, so
/// naming one is also how a director overrides the opening — which is the same
/// rule as the square above, reached without having to be one of six.
test("a ratio the director named themselves is not replaced by the slot's", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    aspect: "5:4",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect: string }).aspect, "1.25:1");
  assert.equal(result.heldToSlot, undefined);
});

/// A board the director dragged together has no opening to fill: the picture is
/// where their hands put it, and cutting it to a shape nobody is holding it to
/// would be the pipeline arguing with them.
test("a picture on a hand-arranged board is cut at the shape that was asked for", async () => {
  const { db } = fakeDb([photo("a")], [board("bd1", ["a"], { title: "Ridge" })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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
  const { db } = fakeDb(
    [photo("a", { width: null, height: null })],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  assert.equal((asked[0] as { aspect?: string }).aspect, undefined);
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.aspect, null);
  assert.equal(result.heldToSlot, undefined);
});

/// The orchestrator runs a round's tool calls with `Promise.all`, so "swap those
/// two around and fix the typo in the headline" arrives as two edits of one board
/// at once. Both used to read the same revision: one write landed, the other was
/// told the board "was changed while I was editing it — the director has it open",
/// and the edit the director asked for was gone.
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

  /// Both changes are on the board the director is left with.
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
/// square/rectangle". A director who says "make it square" has named a shape and
/// not a format, and the declaration used to tell the model to pass "1:1", which
/// is a ratio they never asked for and a box opened out to reach it.
test("a loose shape is framed by the cropper rather than cut to a ratio", async () => {
  const { db, of } = fakeDb([photo("a")]);
  const { asked, crop } = cropping({ box: { ymin: 100, xmin: 200, ymax: 900, xmax: 800 } });
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
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

  /// And the box comes through exactly as framed: there is no ratio to open it
  /// out to, which is the whole difference between the two vocabularies.
  const attachment = attachments?.[0];
  assert.ok(attachment?.kind === "crop");
  assert.deepEqual(attachment.offer.cropBox, [100, 200, 900, 800]);
  assert.equal(attachment.offer.aspect, null);
  assert.equal(attachment.offer.loose, "square");

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
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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
/// director who asked for one is not answered with a strip.
test("a loose ask the slot does not satisfy stays loose", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb(
    [photo("a")],
    [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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

/// Agent 2 as an agent-tool. The unread marks told the model a picture would not
/// be read on its own and pointed it at the properties panel — a capability it
/// could see, name and not reach. These are about the door, and about the one
/// thing that makes this tool unlike every other: it does not wait for its agent.
function queueing({
  woken = true,
  refuse,
}: { woken?: boolean; refuse?: (referenceId: string) => boolean } = {}) {
  const enqueued: { projectId: string; referenceId: string }[] = [];
  let kicks = 0;
  return {
    enqueued,
    kicks: () => kicks,
    queue: {
      enqueue: async (job: { projectId: string; referenceId: string }) => {
        if (refuse?.(job.referenceId)) throw new Error("the queue is down");
        enqueued.push(job);
        return { id: `job-${enqueued.length}` };
      },
      kick: async () => {
        kicks += 1;
        return woken;
      },
    },
  };
}

test("a picture nobody has read is sent to the analyzer, and shown so it can be watched", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b", { analysis: null })]);
  const { queue, enqueued, kicks } = queueing();
  const toolset = referenceToolset({ db, projectId: "p1", queue });

  const { result, attachments } = await run(toolset, "read_references", {
    referenceIds: ["b"],
  });

  assert.deepEqual(enqueued, [{ projectId: "p1", referenceId: "b" }]);
  assert.equal(kicks(), 1);
  assert.deepEqual(result.queued, ["b"]);
  /// No tags in the answer and the status says so, because the reply is written
  /// before the reading has happened.
  assert.match(String(result.status), /reading them now, in the background/);
  assert.match(String(result.status), /do not describe what these pictures are of/);
  /// The tool writes no run row of its own — the job it files *is* the row, and
  /// the analyzer closes it.
  assert.equal(of("agentRun", "create").length, 0);
  /// Clickable, and it opens the gallery at that picture, which is where the
  /// analysis shows up.
  assert.deepEqual(
    attachments?.map((attachment) => [attachment.kind, "referenceId" in attachment && attachment.referenceId]),
    [["reference", "b"]],
  );
});

test("a picture that already has tags is not read again", async () => {
  const { db } = fakeDb([photo("a")]);
  const { queue, enqueued, kicks } = queueing();

  const { result, attachments } = await run(
    referenceToolset({ db, projectId: "p1", queue }),
    "read_references",
    { referenceIds: ["a", "ghost"] },
  );

  assert.deepEqual(enqueued, []);
  /// Nothing is on its way, so no worker is woken and nothing is put in front of
  /// the director.
  assert.equal(kicks(), 0);
  assert.deepEqual(result.queued, []);
  assert.deepEqual(result.alreadyRead, ["a"]);
  assert.deepEqual(result.notFound, ["ghost"]);
  assert.equal(result.status, "nothing was sent to be read");
  assert.deepEqual(attachments, []);
});

/// "pending" is the queue saying a job already exists, so a second one would be
/// a second vision call on the same photograph. The worker is still woken, for
/// the reason the panel's own ask gives: a run left RUNNING by a worker that
/// died needs a worker rather than another job.
test("a reading already on its way is not bought twice, but a worker is still woken", async () => {
  const { db } = fakeDb(
    [photo("b", { analysis: null })],
    [],
    [{ input: { referenceId: "b" }, status: "RUNNING" }],
  );
  const { queue, enqueued, kicks } = queueing();

  const { result, attachments } = await run(
    referenceToolset({ db, projectId: "p1", queue }),
    "read_references",
    { referenceIds: ["b"] },
  );

  assert.deepEqual(enqueued, []);
  assert.equal(kicks(), 1);
  assert.deepEqual(result.queued, []);
  assert.deepEqual(result.alreadyBeingRead, ["b"]);
  assert.equal(attachments?.length, 1);
});

/// The turn's reference read is taken once, so its marks never learn about a job
/// this turn filed — without the set, a model naming one picture in two rounds
/// buys two readings of it.
test("a picture named in two rounds of one turn is read once", async () => {
  const { db } = fakeDb([photo("b", { analysis: null })]);
  const { queue, enqueued } = queueing();
  const toolset = referenceToolset({ db, projectId: "p1", queue });

  const first = await run(toolset, "read_references", { referenceIds: ["b"] });
  const second = await run(toolset, "read_references", { referenceIds: ["b"] });

  assert.deepEqual(enqueued, [{ projectId: "p1", referenceId: "b" }]);
  assert.deepEqual(first.result.queued, ["b"]);
  assert.deepEqual(second.result.queued, []);
  assert.deepEqual(second.result.alreadyBeingRead, ["b"]);
});

/// Both halves of a ceiling that bit — the ids past what one call carries and
/// the ids past what the turn will spend — said as one list, because a request
/// no job was filed for reads to the director as one that was attempted.
test("the ceiling names the pictures it did not send, per call and per turn", async () => {
  const ids = Array.from({ length: READ_LIMIT + 2 }, (_, index) => `u${index}`);
  const { db } = fakeDb(ids.map((id) => photo(id, { analysis: null })));
  const { queue, enqueued } = queueing();
  const toolset = referenceToolset({ db, projectId: "p1", queue });

  const first = await run(toolset, "read_references", { referenceIds: ids });
  assert.equal((first.result.queued as string[]).length, READ_LIMIT);
  assert.deepEqual(first.result.notQueued, ids.slice(READ_LIMIT));
  assert.match(String(first.result.notQueuedNote), /ask for these in the next message/);

  /// The turn's budget is spent, so a later round is answered rather than served.
  const second = await run(toolset, "read_references", {
    referenceIds: [ids[READ_LIMIT]!],
  });
  assert.deepEqual(second.result.queued, []);
  assert.deepEqual(second.result.notQueued, [ids[READ_LIMIT]]);
  assert.equal(enqueued.length, READ_LIMIT);
});

/// Waking a worker is an optimisation over a job that is already filed — the
/// scheduled worker empties the queue either way — so a wake-up that could not
/// be scheduled must not come back as a failed tool call. `after()` throws
/// outright outside a request, which is every caller that is not a round trip.
test("a worker that could not be woken still leaves the pictures queued, and says so", async () => {
  const { db } = fakeDb([photo("b", { analysis: null })]);
  const { queue, enqueued, kicks } = queueing({ woken: false });

  const { result, attachments } = await run(
    referenceToolset({ db, projectId: "p1", queue }),
    "read_references",
    { referenceIds: ["b"] },
  );

  assert.deepEqual(enqueued, [{ projectId: "p1", referenceId: "b" }]);
  assert.equal(kicks(), 1);
  assert.deepEqual(result.queued, ["b"]);
  /// Queued, not being read — so the reply does not promise tags in a moment.
  assert.match(String(result.status), /queued with the property analyzer/);
  assert.match(String(result.status), /do not promise the tags in a moment/);
  assert.doesNotMatch(String(result.status), /reading them now/);
  assert.equal(attachments?.length, 1);
});

/// Filing five jobs and failing on the sixth is five pictures on their way. A
/// throw would report all six as untouched, and the model's next move is to ask
/// again — buying the first five a second vision call each.
test("a job that could not be filed is named beside the ones that were", async () => {
  const { db } = fakeDb([photo("a", { analysis: null }), photo("b", { analysis: null })]);
  const { queue, enqueued } = queueing({ refuse: (id) => id === "b" });

  const { result, attachments } = await run(
    referenceToolset({ db, projectId: "p1", queue }),
    "read_references",
    { referenceIds: ["a", "b"] },
  );

  assert.deepEqual(enqueued, [{ projectId: "p1", referenceId: "a" }]);
  assert.deepEqual(result.queued, ["a"]);
  assert.deepEqual(result.couldNotQueue, ["b"]);
  assert.match(String(result.couldNotQueueNote), /rather than reporting them as sent/);
  /// Only the one on its way is put in front of the director.
  assert.deepEqual(
    attachments?.map((attachment) => "referenceId" in attachment && attachment.referenceId),
    ["a"],
  );
});

test("the reader is declared only for pictures that will not be read on their own", async () => {
  const stalled = fakeDb(
    [photo("a"), photo("b", { analysis: null })],
    [],
    [{ input: { referenceId: "b" }, status: "FAILED" }],
  );
  const stalledState = await referenceToolset({ db: stalled.db, projectId: "p1" }).state();
  assert.equal(stalledState.stalled, 1);

  /// Still running: it arrives without anybody asking, so the schema would be
  /// paid on every round of the one window in which nothing needs doing.
  const waiting = fakeDb(
    [photo("a"), photo("b", { analysis: null })],
    [],
    [{ input: { referenceId: "b" }, status: "QUEUED" }],
  );
  const toolset = referenceToolset({ db: waiting.db, projectId: "p1" });
  assert.equal((await toolset.state()).stalled, 0);
  assert.ok(!(await toolset.declarations()).some((tool) => tool.name === "read_references"));
});

/// The chat could name a cut and the tool cropped it — a box inside a box, which
/// can only ever take *less* of the photograph than the cut already holds, filed
/// as a version of a version that the properties panel has no way in at. So the
/// offer was unreachable: the click opened a panel for an id the gallery does not
/// list, and nothing happened. The panel's own answer to "make that cut wider" is
/// `adjust` — the frame, asked again with the cut's box attached — and this is
/// that, reached from the chat.
test("a cut named for cropping is a nudge of it, asked of the frame it came out of", async () => {
  const { db, of } = fakeDb([photo("a"), cut("cut-1", "a", { editAspect: "16:9" })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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

  /// What comes back is a second cut of the frame, so it opens where every other
  /// offer opens and the review has the row it is meant to improve on.
  assert.equal(result.referenceId, "a");
  assert.match(String(result.nudgeOf), /cut-1 is untouched/);
  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.referenceId, "a");
  assert.equal(attachment?.kind === "crop" && attachment.offer.origin?.id, "cut-1");

  const [created] = of("agentRun", "create");
  const input = (created!.args as { data: { input: Record<string, unknown> } }).data.input;
  assert.equal(input.referenceId, "a");
  assert.equal(input.nudgeOf, "cut-1");
  assert.deepEqual(input.previous, { cropBox: [100, 200, 700, 800], editIntent: "the doorway" });
});

/// The row's shape is the default, not the answer: naming one is asking for a
/// different cut of the same subject.
test("a shape the director names wins over the shape the cut was filed at", async () => {
  const { db } = fakeDb([photo("a"), cut("cut-1", "a", { editAspect: "16:9" })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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
  const { db } = fakeDb(
    [photo("a"), cut("cut-1", "a", { editAspect: "2.39:1" })],
    [composedBoard("bd1", hero, [["cut-1", "img-2", 1000, 1500]])],
  );
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result, attachments } = await run(toolset, "crop_reference", {
    referenceId: "cut-1",
    intention: "a little more sky",
    boardId: "bd1",
  });

  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.forBoard?.takeOff, "cut-1");
  assert.equal(attachment?.kind === "crop" && attachment.offer.forBoard?.boardId, "bd1");
  /// And it is held to the opening the *cut* is sitting in, read off the scene by
  /// the cut's own id.
  assert.equal((asked[0] as { aspect?: string }).aspect, "3.52:1");
  assert.match(String(result.status), /in place of cut-1, the cut standing there now/);
});

/// An ordinary offer says nothing about which picture it replaces: the browser
/// that takes it swaps out the frame it is drawn on, and saying that again would
/// be the same id twice on every crop.
test("an offer on a frame that is on the board names no picture to take off", async () => {
  const hero = layoutById("HERO_LEFT")!;
  const { db } = fakeDb([photo("a")], [composedBoard("bd1", hero, [["a", "img-2", 1000, 1500]])]);
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { attachments } = await run(toolset, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
    boardId: "bd1",
  });

  const attachment = attachments?.[0];
  assert.equal(attachment?.kind === "crop" && attachment.offer.forBoard?.takeOff, undefined);
});

/// A cut drawn before the box was recorded, or a row whose columns are empty:
/// there is nothing to move, and the nested crop is the one thing that must not
/// happen silently instead.
test("a cut with no recorded box is refused before the read, naming the frame", async () => {
  const { db, of } = fakeDb([photo("a"), cut("cut-1", "a", { cropBox: [] })]);
  const { asked, crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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
/// the *old* cut. That lands, reads as correct, and leaves the offer with
/// nowhere to go, so the director accepts a tighter cut that never reaches the
/// board they were just told was sorted.
test("a nudge of a cut on a board names the board when none was passed", async () => {
  const { db, of } = fakeDb(
    [photo("a"), cut("cut-1", "a")],
    [board("bd1", ["cut-1", "other"]), board("bd2", ["unrelated"])],
  );
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

  const { result } = await run(toolset, "crop_reference", {
    referenceId: "cut-1",
    intention: "tighter on the head",
  });

  const note = String(result.alsoOnBoards);
  assert.match(note, /changes no board/);
  /// The cut, not the frame it is a nudge of: that is the picture the board is
  /// standing on and the one a swap would have to take off.
  assert.match(note, /“Board bd1” \(bd1\), which is standing on cut-1/);
  assert.doesNotMatch(note, /bd2/);
  assert.match(note, /do not call swap_on_board/);
  assert.match(note, /crop_reference again with that boardId/);
  /// One read of the column priming refuses, and only because the crop got as far
  /// as an offer — the scenes are megabytes and every other turn pays nothing.
  assert.equal(of("moodboard", "findMany").filter((call) => "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {})).length, 1);
});

/// With a board there is nothing to add: `forBoard` says the swap is coming and
/// `notOnThatBoard` says it is not, and a third sentence about the same board
/// would be the model told twice and asked to choose.
test("a crop that was given a board says nothing about standing on one", async () => {
  const { db } = fakeDb([photo("a")], [board("bd1", ["a"])]);
  const { crop } = cropping();
  const toolset = referenceToolset({ db, projectId: "p1", crop });

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
  const toolset = referenceToolset({ db: empty.db, projectId: "p1", crop: cropping().crop });
  const { result } = await run(toolset, "crop_reference", { referenceId: "a", intention: "the ridge" });
  assert.equal(result.alsoOnBoards, undefined);
  assert.equal(
    empty
      .of("moodboard", "findMany")
      .filter((call) => "elements" in ((call.args as { select: Record<string, unknown> }).select ?? {})).length,
    0,
  );

  const elsewhere = fakeDb([photo("a"), photo("b")], [board("bd1", ["b"])]);
  const other = referenceToolset({ db: elsewhere.db, projectId: "p1", crop: cropping().crop });
  const { result: none } = await run(other, "crop_reference", {
    referenceId: "a",
    intention: "the ridge",
  });
  assert.equal(none.alsoOnBoards, undefined);
});

/// A refusal reached before the offer exists has no board news, because there is
/// no cut to put anywhere — and it must not pay for the scenes to say so.
test("a crop that refuses before an offer reads no scenes", async () => {
  const { db, of } = fakeDb([photo("a", { width: null })], [board("bd1", ["a"])]);
  const toolset = referenceToolset({ db, projectId: "p1", crop: cropping().crop });

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

/// A board showing the photograph *and* a cut of it is named once, on the side
/// the director can check by looking at it.
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

/// tech-spec §V.4–5: the page the *director* attached, as the model reads it.
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
  assert.match(said, /^The director attached “Act two” — page 2 of 2 of the board “Board board-7”/);
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
  assert.equal("fileData" in elsewhere.parts[0]!, false);
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

/// The director's own selection box rather than a model argument: there is
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

/// A message with nothing attached is the ordinary one, and it must not buy the
/// scene read — the elements are the column priming refuses on every other turn.
test("a message with no page attached reads no scenes", async () => {
  const { db, of } = attachable();
  const toolset = referenceToolset({ db, projectId: "p1", pageRender });

  const { parts } = await toolset.attachedPages([]);

  assert.deepEqual(parts, []);
  assert.equal(of("moodboard", "findMany").length, 0);
});
