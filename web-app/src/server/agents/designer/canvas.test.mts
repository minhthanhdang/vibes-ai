import { test } from "node:test";
import assert from "node:assert/strict";

import { designerCanvasToolset } from "./canvas";
import {
  PUT_ON_CANVAS,
  READ_CANVAS,
  REMOVE_FROM_CANVAS,
  REORDER_ON_CANVAS,
  RESTYLE_ON_CANVAS,
  TRANSFORM_ON_CANVAS,
} from "@/lib/agent/agent-tools";
import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ModelRender, ModelRenderRequest } from "@/server/render/for-model";

/// Agent 8's door onto the canvas five (compositor-v2.md §IV.1).
///
/// What the five *do* is agent 6's and is tested next door against agent 6 —
/// this file asserts only the two things the door settles: that §IV.1's one
/// addition rides on `read_canvas` and is drawn from the very scene the boxes
/// were read off, and that nothing agent 8 writes ends in a tile for a user.

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
  analysis: { title?: string } | null;
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
    analysis: { title: `The ${id}` },
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

function image(id: string, referenceId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: "image",
    fileId: `ref:${referenceId}`,
    x: 100,
    y: 100,
    width: 480,
    height: 360,
    ...over,
  };
}

type Board = {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  elements: unknown;
  appState: unknown;
  layout: string | null;
  layoutSlots: unknown;
  widthPx: number;
  heightPx: number;
};

function board(elements: unknown[], over: Partial<Board> = {}): Board {
  return {
    id: "b1",
    projectId: "p1",
    title: "Wedding",
    revision: 7,
    elements,
    appState: { viewBackgroundColor: "#f5f5f5" },
    layout: null,
    layoutSlots: null,
    widthPx: 1920,
    heightPx: 1080,
    ...over,
  };
}

type Call = { table: string; op: string; args: Record<string, unknown> };

const drawn: ModelRender = {
  uri: "gs://director-bucket/renders/boards/b1@7.png",
  revision: 7,
  drawn: "made",
  undrawn: [],
  occupancy: { axis: "y", bands: [], covered: 0, backdrops: 0 },
  contrast: { pairs: 0, overImage: 0, failing: [], worst: null },
};

function toolset(
  boards: readonly Board[],
  rows: readonly Row[] = [],
  answer: ModelRender | ((request: ModelRenderRequest) => ModelRender) = drawn,
) {
  const calls: Call[] = [];
  const asked: ModelRenderRequest[] = [];
  const live = boards.map((one) => ({ ...one }));
  const record =
    <T,>(table: string, op: string, give: (args: Record<string, unknown>) => T) =>
    async (args: Record<string, unknown>) => {
      calls.push({ table, op, args });
      return give(args);
    };

  const db = {
    reference: { findMany: record("reference", "findMany", () => rows) },
    agentRun: { findMany: record("agentRun", "findMany", () => []) },
    moodboard: {
      findFirst: record("moodboard", "findFirst", (args) => {
        const where = args.where as { id: string; projectId: string };
        return live.find((one) => one.id === where.id && one.projectId === where.projectId) ?? null;
      }),
      /// The revision guard, kept honest: a write against a revision the row has
      /// moved past lands nothing, which is what the queue exists to prevent.
      updateMany: record("moodboard", "updateMany", (args) => {
        const where = args.where as { id: string; revision: number };
        const row = live.find((one) => one.id === where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        const data = args.data as { elements?: unknown };
        if (data.elements !== undefined) row.elements = data.elements;
        row.revision += 1;
        return { count: 1 };
      }),
    },
  } as unknown as PrismaClient;

  return {
    ...designerCanvasToolset({
      db,
      projectId: "p1",
      render: async (request) => {
        asked.push(request);
        return typeof answer === "function" ? answer(request) : answer;
      },
    }),
    calls,
    asked,
    live,
  };
}

const resultOf = (outcome: { result: Record<string, unknown> } | null) => {
  assert.ok(outcome);
  return outcome.result;
};

test("the six are agent 6's own, and a name from another toolset is not this one's", async () => {
  const { declarations, execute } = toolset([]);
  assert.deepEqual(
    declarations.map(({ name }) => name),
    [
      READ_CANVAS.name,
      PUT_ON_CANVAS.name,
      REMOVE_FROM_CANVAS.name,
      TRANSFORM_ON_CANVAS.name,
      REORDER_ON_CANVAS.name,
      RESTYLE_ON_CANVAS.name,
    ],
  );
  assert.equal(await execute({ name: "get_page", args: {} }), null);
});

test("read_canvas draws the board off the scene it read the boxes from", async () => {
  const { execute, calls, asked } = toolset([board([image("el1", "a")])], [photo("a")]);
  const outcome = await execute({ name: "read_canvas", args: { boardId: "b1" } });

  assert.ok(outcome);
  /// One board read, and the render was handed it rather than sent to make its
  /// own: §III.3's invariant is that the picture and the numbers cannot be of
  /// two revisions.
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 1);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.boardId, "b1");
  assert.equal(asked[0]!.pageId, undefined);
  assert.equal(asked[0]!.scene.revision, 7);
  assert.deepEqual(asked[0]!.scene.appState, { viewBackgroundColor: "#f5f5f5" });
  assert.equal(resultOf(outcome).revision, 7);
  assert.deepEqual(outcome.pictures, [
    { fileData: { fileUri: drawn.uri, mimeType: BOARD_RENDER_CONTENT_TYPE } },
  ]);
});

test("the picture is said in the words, and says it is of a board", async () => {
  const { execute } = toolset([board([image("el1", "a")])], [photo("a")]);
  const outcome = await execute({ name: "read_canvas", args: { boardId: "b1" } });

  const picture = String(resultOf(outcome).picture);
  assert.match(picture, /came back with this answer/);
  assert.match(picture, /that board/);
  /// Never *above*: a tool's picture rides after the answer it belongs to.
  assert.doesNotMatch(picture, /above/);
});

test("a page-scoped read is drawn as that page, not as the whole board", async () => {
  const { execute, asked } = toolset([board([pageFrame("pg1"), image("el1", "a")])], [photo("a")]);
  const outcome = await execute({
    name: "read_canvas",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.equal(asked[0]!.pageId, "pg1");
  assert.match(String(resultOf(outcome).picture), /that page/);
});

test("what the picture left out is said beside the line that says there is one", async () => {
  const { execute } = toolset([board([image("el1", "a")])], [photo("a")], {
    ...drawn,
    undrawn: [
      { id: "el2", type: "freedraw" },
      { id: "el3", type: "diamond" },
    ],
  });
  const outcome = await execute({ name: "read_canvas", args: { boardId: "b1" } });

  const picture = String(resultOf(outcome).picture);
  assert.match(picture, /came back with this answer/);
  assert.match(picture, /Drawn as empty outlines/);
  assert.match(picture, /1 freedraw, 1 diamond/);
});

test("a renderer that failed is said as the error it is, with no picture beside it", async () => {
  const { execute } = toolset([board([image("el1", "a")])], [photo("a")], {
    failed: true,
    reason: "the renderer ran out of time",
  });
  const outcome = await execute({ name: "read_canvas", args: { boardId: "b1" } });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  const picture = String(resultOf(outcome).picture);
  assert.match(picture, /There is no picture of it/);
  assert.match(picture, /ran out of time/);
  assert.match(picture, /say you could not see it/);
  /// The boxes are still there, and still stamped: a model that cannot see the
  /// board still has to be able to tell it from the one it read two rounds ago.
  assert.ok(Array.isArray(resultOf(outcome).objects));
  assert.equal(resultOf(outcome).revision, 7);
});

test("a board this project does not carry is refused with nothing drawn beside it", async () => {
  const { execute, asked } = toolset([board([], { id: "other", projectId: "p2" })]);
  const outcome = await execute({ name: "read_canvas", args: { boardId: "other" } });

  assert.match(String(resultOf(outcome).error), /no board called other/);
  assert.equal(asked.length, 0);
});

test("a page the board does not carry is refused before anything is drawn", async () => {
  const { execute, asked } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({ name: "read_canvas", args: { boardId: "b1", pageId: "pg9" } });

  assert.match(String(resultOf(outcome).error), /no page called pg9/);
  assert.equal(asked.length, 0);
  assert.ok(!("picture" in resultOf(outcome)));
});

test("a write answers in words alone — no tile, and nothing agent 8 does reaches a user", async () => {
  const { execute, live } = toolset([board([])], [photo("a")]);
  const outcome = await execute({
    name: "put_on_canvas",
    args: { boardId: "b1", objects: [{ kind: "image", referenceId: "a" }] },
  });

  assert.ok(outcome);
  assert.ok(!("attachments" in outcome));
  assert.equal(outcome.pictures, undefined);
  assert.equal((resultOf(outcome).put as unknown[]).length, 1);
  /// The board really moved: the answer is words only, not a write that was
  /// skipped.
  assert.equal(live[0]!.revision, 8);
});

test("the refusals are agent 6's, said in agent 6's words", async () => {
  const { execute } = toolset([board([])]);
  const outcome = await execute({
    name: "transform_on_canvas",
    args: { boardId: "b1", changes: [{ objectId: "el9", angle: 10 }] },
  });

  const note = String(resultOf(outcome).notOnBoardNote ?? "");
  assert.match(note, /every handle comes from read_canvas/);
});

/// Requirement 3, at the door that would show it failing: there is no field,
/// refusal or default in the sixth tool that behaves differently depending on
/// which agent knocked, because there is one implementation and this is a
/// caller of it.
test("agent 8 restyles through agent 6's own tool, in words alone", async () => {
  const { execute, live } = toolset([board([])], [photo("a")]);
  const put = await execute({
    name: "put_on_canvas",
    args: {
      boardId: "b1",
      objects: [{ kind: "shape", shape: "rectangle", box: [0, 0, 400, 400] }],
    },
  });
  const objectId = (resultOf(put).put as { objectId: string }[])[0]!.objectId;

  const outcome = await execute({
    name: "restyle_on_canvas",
    args: { boardId: "b1", changes: [{ objectId, fill: "#0c111c", opacity: 45 }] },
  });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  assert.deepEqual(resultOf(outcome).restyled, [
    { objectId, set: ["fill", "opacity"] },
  ]);
  assert.equal(live[0]!.revision, 9);
});

test("two edits to one board in a round queue rather than collide", async () => {
  const { execute, live } = toolset([board([])], [photo("a"), photo("b")]);
  const [first, second] = await Promise.all([
    execute({
      name: "put_on_canvas",
      args: { boardId: "b1", objects: [{ kind: "image", referenceId: "a" }] },
    }),
    execute({
      name: "put_on_canvas",
      args: { boardId: "b1", objects: [{ kind: "image", referenceId: "b" }] },
    }),
  ]);

  /// Both landed, and the second read the board as the first left it — without
  /// the queue one of them answers "that board was changed while I was putting
  /// objects on it" about a change this very call made.
  assert.equal((resultOf(first).put as unknown[]).length, 1);
  assert.equal((resultOf(second).put as unknown[]).length, 1);
  assert.equal(live[0]!.revision, 9);
});

test("one reference read serves a read and a write in the same round", async () => {
  const { execute, calls } = toolset([board([])], [photo("a")]);
  await Promise.all([
    execute({ name: "read_canvas", args: { boardId: "b1" } }),
    execute({
      name: "put_on_canvas",
      args: { boardId: "b1", objects: [{ kind: "image", referenceId: "a" }] },
    }),
  ]);

  assert.equal(calls.filter((call) => call.table === "reference").length, 1);
});

/// The put's type ceiling (`TYPE_CLAMP_NOTE`). It is not one of §VII's per-turn
/// budgets, but it is the same rule: a bound applied without a sentence is a
/// design the model reads back as its own bad taste.

test("a headline cut to the put's type ceiling is said, with the field that clears it", async () => {
  const { execute } = toolset([board([pageFrame("pg1", { width: 1080, height: 1920 })])]);
  const outcome = await execute({
    name: "put_on_canvas",
    args: {
      boardId: "b1",
      objects: [
        { kind: "text", text: "AMARA & INES", pageId: "pg1", box: [385, 80, 452, 920] },
      ],
    },
  });

  const result = resultOf(outcome);
  const [clamp] = result.typeSet as { objectId: string; asked: number; set: number }[];
  /// The real design that caught this: 67 thousandths of a 1920-tall page is
  /// 128.6 units, and 103px of type came back as 96.
  assert.equal(clamp?.asked, 103);
  assert.equal(clamp?.set, 96);
  assert.equal(clamp?.objectId, (result.put as { objectId: string }[])[0]!.objectId);
  /// The way out is the field on this door, not a second call: the note stood
  /// for four stages naming `transform_on_canvas`, which was the only ceilingless
  /// door the day it was written and stopped being so when `canvas.md` §XI.2 put
  /// `fontSize` on the put and on the restyle.
  assert.match(String(result.typeSetNote), /fontSize is a field on this tool/);
  assert.match(String(result.typeSetNote), /restyle_on_canvas/);
  assert.ok(
    !/transform_on_canvas/.test(String(result.typeSetNote)),
    "the two-call route is not the one offered",
  );
  /// No size in the sentence: the numbers are per line in `typeSet`, and a
  /// concrete one in the prose is a size to settle on (iteration 36's finding).
  assert.ok(!/\d/.test(String(result.typeSetNote)));
});

/// And the route it names lands: the same headline, the same box, with the size
/// said — no clamp, the type at what was asked, and the block measured to it
/// rather than to the box. The note and the door are asserted together because
/// a sentence naming a field is worth nothing if the field is not the way out.
test("the size the clamp note names is honoured on the same put, with no clamp reported", async () => {
  const { execute } = toolset([board([pageFrame("pg1", { width: 1080, height: 1920 })])]);
  const outcome = await execute({
    name: "put_on_canvas",
    args: {
      boardId: "b1",
      objects: [
        {
          kind: "text",
          text: "AMARA & INES",
          pageId: "pg1",
          box: [385, 80, 452, 920],
          fontSize: 200,
        },
      ],
    },
  });

  const result = resultOf(outcome);
  assert.ok(!("typeSet" in result), "a size that was said is never reported as clamped");
  assert.ok(!("typeSetNote" in result));
  assert.equal((result.put as { objectId: string }[]).length, 1);
});

/// The put's line breaks (`TEXT_WRAP_NOTE`), on the same rule: the words are
/// now inside the box, and the block that came back three lines deep stands
/// over whatever was placed under it, which only the design can settle.
test("copy broken to its box is said, with how far the block now reaches", async () => {
  const { execute } = toolset([board([pageFrame("pg1", { width: 1080, height: 1920 })])]);
  const outcome = await execute({
    name: "put_on_canvas",
    args: {
      boardId: "b1",
      objects: [
        {
          kind: "text",
          text: "Each lot is test-profiled in three-kilo micro-batches to isolate origin character before it is released to the counter.",
          pageId: "pg1",
          box: [500, 100, 509, 540],
        },
      ],
    },
  });

  const result = resultOf(outcome);
  const [wrap] = result.textSet as { objectId: string; lines: number; asked: number; set: number }[];
  assert.ok((wrap?.lines ?? 0) > 1, "the sentence took more than one line");
  assert.ok(wrap!.set > wrap!.asked, "and the block stands below the box it was given");
  assert.equal(wrap?.objectId, (result.put as { objectId: string }[])[0]!.objectId);
  assert.match(String(result.textSetNote), /transform_on_canvas/);
  /// No number in the sentence, on `typeSetNote`'s own finding: the counts are
  /// per block in `textSet`.
  assert.ok(!/\d/.test(String(result.textSetNote)));
});

/// The resize's floor (`TYPE_FLOOR_NOTE`), the third bound said on this rule
/// and the one that arrives through the geometry door: the line stopped
/// shrinking, so the block re-broke and grew, and the design is the only thing
/// that can move what is now underneath it.
test("a line that stopped at the resize floor is said, with what it did to the block", async () => {
  const copy =
    "Each lot is test-profiled in three-kilo micro-batches to isolate origin character before it is released to the counter.";
  const { execute } = toolset([
    board([
      pageFrame("pg1", { width: 1080, height: 1920 }),
      {
        id: "t1",
        type: "text",
        text: copy,
        originalText: copy,
        autoResize: false,
        fontSize: 20,
        x: 100,
        y: 100,
        width: 600,
        height: 60,
        frameId: "pg1",
      },
    ]),
  ]);

  const outcome = await execute({
    name: "transform_on_canvas",
    args: { boardId: "b1", changes: [{ objectId: "t1", size: [15, 277] }] },
  });

  const result = resultOf(outcome);
  const [floor] = result.typeSet as { objectId: string; asked: number; set: number }[];
  assert.equal(floor?.objectId, "t1");
  assert.ok(floor!.asked < floor!.set, "the scale asked for type under the floor");
  assert.equal(floor?.set, 12);
  /// The number is in the sentence here and deliberately not in the put's: a
  /// ceiling printed in prose is a size the model aims at, a floor is one it
  /// has to clear, and `object-style.ts` already names both ends of the range.
  assert.match(String(result.typeSetNote), /12/);
});

/// A resize that leaves the type over the floor is the door it has always been
/// — no sentence, and one number takes the width, the size and the height.
test("a resize that clears the floor gets no floor sentence", async () => {
  const { execute } = toolset([
    board([
      pageFrame("pg1", { width: 1080, height: 1920 }),
      {
        id: "t1",
        type: "text",
        text: "AMARA",
        originalText: "AMARA",
        autoResize: false,
        fontSize: 60,
        x: 100,
        y: 100,
        width: 600,
        height: 75,
        frameId: "pg1",
      },
    ]),
  ]);

  const outcome = await execute({
    name: "transform_on_canvas",
    args: { boardId: "b1", changes: [{ objectId: "t1", size: [20, 156] }] },
  });

  const result = resultOf(outcome);
  assert.equal(result.typeSet, undefined);
  assert.equal(result.typeSetNote, undefined);
});

test("a line that fits its box gets no wrap sentence", async () => {
  const { execute } = toolset([board([pageFrame("pg1", { width: 1080, height: 1920 })])]);
  const outcome = await execute({
    name: "put_on_canvas",
    args: {
      boardId: "b1",
      objects: [
        { kind: "text", text: "Saturday the ninth", pageId: "pg1", box: [600, 200, 630, 800] },
      ],
    },
  });

  const result = resultOf(outcome);
  assert.ok(!("textSet" in result));
  assert.ok(!("textSetNote" in result));
});

test("type the box's own size gets no clamp sentence", async () => {
  const { execute } = toolset([board([pageFrame("pg1", { width: 1080, height: 1920 })])]);
  const outcome = await execute({
    name: "put_on_canvas",
    args: {
      boardId: "b1",
      objects: [
        { kind: "text", text: "Saturday the ninth", pageId: "pg1", box: [600, 200, 630, 800] },
      ],
    },
  });

  const result = resultOf(outcome);
  assert.ok(!("typeSet" in result));
  assert.ok(!("typeSetNote" in result));
});
