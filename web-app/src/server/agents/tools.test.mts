import { test } from "node:test";
import assert from "node:assert/strict";

import { referenceToolset } from "./tools";
import { CROP_CALL_LIMIT } from "@/lib/agent-tools";
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
      create: record("moodboard", "create", (args) => {
        const data = args.data as { title: string };
        return { id: `board-${++boards}`, title: data.title };
      }),
      /// Counts the way a guarded update does: a row whose revision has moved is
      /// no row at all, which is how the losing writer finds out.
      updateMany: record("moodboard", "updateMany", (args) => {
        const where = args.where as { id: string; revision: number };
        const hit = boardRows.find(
          (row) => row.id === where.id && row.revision === where.revision,
        );
        return { count: hit ? 1 : 0 };
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
    layout: { id: string };
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
test("a picture added to a board joins the ones already on it", async () => {
  const { db, of } = fakeDb([photo("a"), photo("b"), photo("c")], [board("board-7", ["a", "b"])]);
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "b", slotId: "img-2" },
    { blockId: "c", slotId: "img-3" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "add the third one",
    boardId: "board-7",
    addReferenceIds: ["c"],
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["a", "b", "c"]);
  assert.deepEqual(result.added, ["c"]);
  assert.equal(result.removed, undefined);
  assert.equal((of("moodboard", "updateMany")[0]!.args as { data: { elements: unknown[] } }).data.elements.length, 3);
});

test("a picture taken off a board leaves the rest, and a removal of one that was never on says so", async () => {
  const { db } = fakeDb([photo("a"), photo("b"), photo("c")], [board("board-7", ["a", "b", "c"])]);
  const { asked, compose } = composing([
    { blockId: "a", slotId: "img-1" },
    { blockId: "c", slotId: "img-2" },
  ]);
  const toolset = referenceToolset({ db, projectId: "p1", compose });

  const { result } = await run(toolset, "compose_moodboard", {
    intention: "drop the middle one",
    boardId: "board-7",
    removeReferenceIds: ["b", "z"],
  });

  assert.deepEqual(asked[0]!.blocks.map((block) => block.id), ["a", "c"]);
  assert.deepEqual(result.removed, ["b"]);
  assert.deepEqual(result.notOnBoard, ["z"]);
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

  await run(toolset, "compose_moodboard", {
    intention: "tighter",
    boardId: "board-7",
    title: "Act two, exteriors",
  });
  const renamed = (of("moodboard", "updateMany")[1]!.args as { data: { title: string } }).data;
  assert.equal(renamed.title, "Act two, exteriors");
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
  const boards = [board("board-7", ["a", "b"], { layout: "SPLIT" })];
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
});
