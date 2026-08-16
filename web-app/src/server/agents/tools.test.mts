import { test } from "node:test";
import assert from "node:assert/strict";

import { referenceToolset } from "./tools";
import { CROP_CALL_LIMIT, REWORD_LIMIT, SHOWN_LIMIT, SWAP_LIMIT } from "@/lib/agent-tools";
/// Through the alias, not through `./cropper`: the executor imports it that
/// way, and under the test runner the two specifiers resolve to two copies of
/// the module — so an error built from the relative one is not `instanceof` the
/// class the executor is checking against.
import { CropperError } from "@/server/agents/cropper";
import { MODELS } from "@/server/google/vertex";
import { fitInSlot, layoutById } from "@/lib/moodboard-layouts";
import type { MoodboardLayout } from "@/lib/moodboard-layouts";
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
    gcsUri: `gs://director-bucket/uploads/${id}.jpg`,
    thumbGcsUri: `gs://director-bucket/thumbs/${id}.jpg`,
    source: null,
    analysis: { lighting: ["golden_hour"], subject: ["landscape"] },
    ...over,
  };
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
function fakeDb(rows: readonly Row[], boardRows: readonly BoardRow[] = []) {
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
    agentRun: {
      create: record("agentRun", "create", () => ({ id: `run-${++runs}` })),
      update: record("agentRun", "update", () => ({})),
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
    blocks: { id: string; kind: string; text?: string }[];
    intention: string;
    layout: { id: string; slots: { id: string; kind: string }[] };
    /// Present only on an edit to a board that is keeping its arrangement: what
    /// is already seated, and therefore not open to assignment.
    inPlace?: { slotId: string; id: string }[];
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

/// Priming the turn is the read the tools were going to make anyway. If it were
/// a second query the round it saves would be paid for in latency, and worse,
/// the model could be handed one list and have its ids resolved against another.
test("the brief comes off the same read the tools use", async () => {
  const { db, of } = fakeDb([photo("a"), photo("cut", { source: { id: "a", title: "a" } })]);
  const toolset = referenceToolset({ db, projectId: "p1" });

  const brief = await toolset.brief();
  await run(toolset, "show_references", { referenceIds: ["a"] });

  assert.equal(of("reference", "findMany").length, 1);
  /// The photographs by line, the cuts by count — the count being the only
  /// reason left to spend a round on list_references.
  assert.match(brief, /^The project holds 1 photograph: 1 cut has been made of them\.\na · a · 4:3/);
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
  assert.equal(data.elements.length, 2);

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
  assert.equal((data.elements as unknown[]).length, 2);
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
  assert.equal(data.elements.length, 3);
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
    data: { elements: { fileId: string; x: number }[]; revision: unknown; renderRevision: unknown };
  };
  assert.deepEqual(
    data.elements.map((element) => element.fileId),
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
  assert.equal(data.elements.length, placed.length + 1);
  assert.equal(data.elements.at(-1)!.text, "Act two");
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
) {
  return board(id, [], {
    layout: layout.id,
    widthPx: layout.page.width,
    heightPx: layout.page.height,
    elements: placed.map(([referenceId, slotId, width, height], index) => ({
      id: `el-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
      ...fitInSlot(layout.slots.find((slot) => slot.id === slotId)!, {
        id: referenceId,
        kind: "image",
        width,
        height,
      }),
    })) as never,
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
  assert.equal(result.page, "1920×1080");
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
  });
  assert.deepEqual(
    (await toolset.declarations()).map((tool) => tool.name),
    [
      "list_references",
      "show_references",
      "crop_reference",
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
      "inspect_board",
      "swap_on_board",
      "reword_on_board",
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
