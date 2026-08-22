import { test } from "node:test";
import assert from "node:assert/strict";

import { designerPageToolset } from "./page";
import {
  DESIGNER_DISCARD_PAGE,
  DESIGNER_DUPLICATE_PAGE,
  DESIGNER_MOVE_TO_PAGE,
  DESIGNER_RESIZE_PAGE,
  GET_PAGE,
} from "@/lib/agent/designer-tools";
import { PAGE_GAP, fitInSlot, layoutById } from "@/lib/layout/moodboard-layouts";
import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ModelRender, ModelRenderRequest } from "@/server/render/for-model";

/// The executor half of agent 8's page toolset (compositor-v2.md §IV.2). The
/// text it answers with is `pageBriefText`'s and tested next door; what this file
/// asserts is what only the executor knows — that the words and the picture come
/// off one read of one board row, what of the row reaches the model, and what is
/// said when the renderer cannot draw.

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
  analysis: { title?: string; lighting?: string[]; subject?: string[] } | null;
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
    analysis: { title: `The ${id}`, lighting: ["golden-hour"], subject: ["landscape"] },
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

function image(id: string, referenceId: string, over: Record<string, unknown> = {}) {
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

type Board = {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  elements: unknown;
  appState: unknown;
  layout: string | null;
  layoutSlots: unknown;
};

function board(elements: unknown[], over: Partial<Board> = {}): Board {
  return {
    id: "b1",
    projectId: "p1",
    title: "Wedding",
    revision: 7,
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    layout: null,
    layoutSlots: null,
    ...over,
  };
}

type Call = { table: string; op: string; args: Record<string, unknown> };

/// A page standing the way every fixture run stood (§VIII): a middle band with
/// the work in it and two bands with next to nothing. The numbers are the ones
/// `design:fixtures` measured, so the sentence this test pins is the sentence a
/// real design gets.
const standing = {
  axis: "y" as const,
  bands: [
    { from: 0, to: 1 / 3, covered: 0.02 },
    { from: 1 / 3, to: 2 / 3, covered: 0.34 },
    { from: 2 / 3, to: 1, covered: 0 },
  ],
  covered: 0.12,
  backdrops: 1,
};

const drawn: ModelRender = {
  uri: "gs://director-bucket/renders/pages/pg1@7.png",
  revision: 7,
  drawn: "made",
  undrawn: [],
  occupancy: standing,
};

function toolset(
  boards: readonly Board[],
  rows: readonly Row[] = [],
  answer: ModelRender = drawn,
  /// How the guarded write lands. Zero is the board having moved under the read,
  /// which is the one answer a reshape has that is not about the page.
  written = 1,
  boardEdits?: Parameters<typeof designerPageToolset>[0]["boardEdits"],
) {
  const calls: Call[] = [];
  const asked: ModelRenderRequest[] = [];
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
        return (
          boards.find((one) => one.id === where.id && one.projectId === where.projectId) ?? null
        );
      }),
      updateMany: record("moodboard", "updateMany", () => ({ count: written })),
    },
  } as unknown as PrismaClient;

  return {
    ...designerPageToolset({
      db,
      projectId: "p1",
      render: async (request) => {
        asked.push(request);
        return answer;
      },
      ...(boardEdits && { boardEdits }),
    }),
    calls,
    asked,
  };
}

const textOf = (result: unknown) => (result as { page: string }).page;

test("the toolset declares §IV.2's five page tools and other names are not its own", async () => {
  const { declarations, execute } = toolset([]);
  assert.deepEqual(
    declarations.map(({ name }) => name),
    [
      GET_PAGE.name,
      DESIGNER_DUPLICATE_PAGE.name,
      DESIGNER_RESIZE_PAGE.name,
      DESIGNER_MOVE_TO_PAGE.name,
      DESIGNER_DISCARD_PAGE.name,
    ],
  );
  assert.equal(await execute({ name: "get_image", args: {} }), null);
});

test("a board of another project is no board at all", async () => {
  const { execute, calls } = toolset([
    board([pageFrame("pg1")], { id: "other", projectId: "p2" }),
  ]);
  const outcome = await execute({ name: "get_page", args: { boardId: "other", pageId: "pg1" } });

  assert.ok(outcome);
  assert.match(String((outcome.result as { error: string }).error), /no board called other/);
  assert.deepEqual((calls[0]!.args.where as { projectId: string }).projectId, "p1");
});

test("a page id the board does not carry is named back with where to look", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg9" } });

  assert.ok(outcome);
  const error = String((outcome.result as { error: string }).error);
  assert.match(error, /no page called pg9 on the board b1/);
  assert.match(error, /read_canvas/);
  assert.equal(outcome.pictures, undefined);
});

test("the words and the picture come off one read of one board row", async () => {
  const { execute, calls, asked } = toolset(
    [board([pageFrame("pg1"), image("el1", "a")])],
    [photo("a")],
  );
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  /// One board read, and the render was handed that read rather than sent to
  /// make its own — §III.3's invariant is that the picture cannot be of another
  /// revision than the blocks.
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 1);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.scene.revision, 7);
  assert.equal(asked[0]!.pageId, "pg1");
  assert.equal(asked[0]!.boardId, "b1");
  assert.equal((outcome.result as { revision: number }).revision, 7);
});

test("the page reads as one the model asked for rather than one the user attached", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  const text = textOf(outcome.result);
  assert.match(text, /This is “Welcome sign” — page 1 of 1 of the board “Wedding”, 1920×1080\./);
  assert.doesNotMatch(text, /attached/);
  assert.match(text, /boardId b1, pageId pg1/);
});

test("the blocks are the catalogue's own lines, in the page's reading order", async () => {
  const { execute } = toolset(
    [
      board([
        pageFrame("pg1"),
        image("el1", "a", { x: 900, y: 100 }),
        image("el2", "b", { x: 100, y: 100 }),
      ]),
    ],
    [photo("a"), photo("b")],
  );
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  const lines = textOf(outcome.result).split("\n");
  assert.match(lines[0]!, /2 blocks on it, in reading order:/);
  /// Left before right, whatever order the scene array holds them in.
  assert.match(lines[1]!, /^b · The b · /);
  assert.match(lines[2]!, /^a · The a · /);
  assert.match(lines[1]!, /\[93,52,370,260\]/);
});

/// The read agent 8 takes between its own writes (§XI.5). It draws scrims and
/// rules now, and a page it just painted described back to it as empty room is
/// the round it spends putting a second headline where the first one is.
test("a scrim agent 8 drew is one of the blocks it reads back", async () => {
  const { execute } = toolset(
    [
      board([
        pageFrame("pg1"),
        image("el1", "a", { x: 100, y: 100 }),
        {
          id: "el2",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          backgroundColor: "#0c111c",
          strokeColor: "transparent",
          opacity: 45,
        },
      ]),
    ],
    [photo("a")],
  );
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  const lines = textOf(outcome.result).split("\n");
  assert.match(lines[0]!, /2 blocks on it, in reading order:/);
  assert.match(lines[1]!, /^rectangle · #0c111c · 45% opaque · \[0,0,1000,1000\]/);
});

test("a picture on another page of the same board is not on this one", async () => {
  const { execute } = toolset(
    [
      board([
        pageFrame("pg1"),
        pageFrame("pg2", { x: 2040, name: "Menu" }),
        image("el1", "a", { x: 2140, y: 100 }),
      ]),
    ],
    [photo("a")],
  );
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  const text = textOf(outcome.result);
  assert.match(text, /page 1 of 2 of the board “Wedding”/);
  assert.match(text, /There is nothing on it\./);
});

test("the render rides as a part and its bucket path never reaches the model", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  assert.deepEqual(outcome.pictures, [
    { fileData: { fileUri: drawn.uri, mimeType: BOARD_RENDER_CONTENT_TYPE } },
  ]);
  assert.doesNotMatch(JSON.stringify(outcome.result), /gs:\/\//);
  assert.match(textOf(outcome.result), /The picture that came back with this answer is that page/);
});

test("what the renderer could not draw is said beside the picture", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])], [], {
    ...drawn,
    undrawn: [{ type: "freedraw", id: "fd1" }],
  });
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  assert.match(textOf(outcome.result), /Drawn as empty outlines .*: 1 freedraw\./);
});

test("a render that failed is an error said in the text, and no picture goes with it", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])], [], {
    failed: true,
    reason: "the renderer did not finish drawing that page within 8 seconds",
  });
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  const text = textOf(outcome.result);
  assert.match(text, /There is no picture of it — the renderer did not finish drawing that page/);
  assert.doesNotMatch(text, /The picture that came back/);
  /// The stamp stands whether or not there is a picture: the blocks below are
  /// still of that revision.
  assert.equal((outcome.result as { revision: number }).revision, 7);
});

/// §VIII's taste risk, answered with a number the model cannot read past. The
/// second look is happening — the design reads its own page after writing it —
/// and it came back calling a page that is 88% white "generous margins", so what
/// this line adds is the only part of the arrangement the blocks cannot be read
/// off: what the whole frame came to.
test("how the page is standing is said in the text, band by band", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  assert.match(
    textOf(outcome.result),
    /Something stands on 12% of this page, not counting a draw covering the whole rectangle: 2% of the top third, 34% of the middle third, 0% of the bottom third\. Next to nothing stands in the top third or the bottom third\./,
  );
});

/// It rides on the render's answer and not on the picture, so the round with no
/// picture on it is the round it is worth the most.
test("a page the renderer could not draw still says how it is standing", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])], [], {
    failed: true,
    reason: "the renderer did not finish drawing that page within 8 seconds",
    occupancy: standing,
  });
  const outcome = await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.ok(outcome);
  const text = textOf(outcome.result);
  assert.match(text, /There is no picture of it —/);
  assert.match(text, /0% of the bottom third/);
});

test("two page reads in one call share the one reference read", async () => {
  const { execute, calls } = toolset(
    [board([pageFrame("pg1"), image("el1", "a")])],
    [photo("a")],
  );
  await Promise.all([
    execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } }),
    execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } }),
  ]);

  assert.equal(calls.filter((call) => call.table === "reference").length, 1);
  assert.equal(calls.filter((call) => call.table === "moodboard").length, 2);
});

/// `resize_page` is agent 6's tool, called through this door (§IV.2). What the
/// tests below assert is the door rather than the reshape — the write agent 6's
/// own tests already pin, without the tile, and with the three sentences that
/// name a tool said in agent 8's tools rather than in agent 6's.
const resized = (result: unknown) => result as Record<string, unknown>;

test("a reshape writes the new rectangle guarded on the revision it read", async () => {
  const { execute, calls } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "b1", pageId: "pg1", preset: "PORTRAIT_HD" },
  });

  assert.ok(outcome);
  const write = calls.find((call) => call.op === "updateMany")!;
  assert.deepEqual(write.args.where, { id: "b1", revision: 7 });
  const data = write.args.data as Record<string, unknown>;
  assert.deepEqual(data.revision, { increment: 1 });
  /// The tab's stored picture is of a board with a page on it that is no longer
  /// that shape.
  assert.equal(data.renderRevision, null);
  assert.match(String(resized(outcome.result).status), /1080×1920/);
});

/// §III: nothing agent 8 draws is ever shown to a user, and the tile the shared
/// tool hands back is the facts a picture for a user is made of. Dropped here
/// rather than never built, which is what keeps the two agents on one
/// implementation.
test("the reshape answers in words alone — no tile, no picture", async () => {
  const { execute, asked } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "b1", pageId: "pg1", preset: "SQUARE" },
  });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  assert.deepEqual(Object.keys(outcome), ["result"]);
  /// A reshape draws nothing on its own: `get_page` is how the model looks at
  /// what the new rectangle did, and it pays for that picture when it asks.
  assert.deepEqual(asked, []);
});

test("a board with no pages is told how agent 8 makes one, not how agent 6 does", async () => {
  const { execute } = toolset([board([image("el1", "a")])]);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "b1", pageId: "pg1", preset: "SQUARE" },
  });

  assert.ok(outcome);
  const note = String(resized(outcome.result).pagesNote);
  assert.match(note, /put_on_canvas/);
  assert.doesNotMatch(note, /add_page/);
});

/// The clause agent 6 ends with is "offer to lay the page out again", which is
/// `compose_moodboard`'s. Agent 8 has no compositor and arranging is the work it
/// was opened to do, so the same fact ends in the tool it holds.
test("what a smaller page leaves standing beside it is agent 8's own to put back", async () => {
  const { execute } = toolset([
    board([pageFrame("pg1"), image("el1", "a", { x: 1500, y: 100, width: 300, height: 200 })]),
  ]);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "b1", pageId: "pg1", preset: "PORTRAIT_HD" },
  });

  assert.ok(outcome);
  const note = String(resized(outcome.result).fellOffPageNote);
  assert.match(note, /transform_on_canvas/);
  assert.doesNotMatch(note, /lay the page out again/);
  assert.doesNotMatch(note, /compose_moodboard/);
});

/// The shape refusal was the last sentence in the shared executor written for
/// one agent only: it told whoever asked that any other rectangle is the user's
/// own to drag on the canvas. True of agent 6, whose page shapes come from
/// templates; false of agent 8, which draws every rectangle it uses.
test("a shape this call cannot give is sent to the box put_on_canvas takes", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "b1", pageId: "pg1", preset: "A4" },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.match(String(result.error), /A4 is not a page shape/);
  const note = String(result.presetsNote);
  assert.match(note, /put_on_canvas/);
  assert.doesNotMatch(note, /the user's own to drag/);
  assert.doesNotMatch(note, /layout templates/);
});

test("a page already at the shape asked for is left alone and nothing is written", async () => {
  const { execute, calls } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "b1", pageId: "pg1", preset: "LANDSCAPE_HD" },
  });

  assert.ok(outcome);
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
  assert.match(String(resized(outcome.result).status), /already 1920×1080/);
});

test("a board of another project is no board to reshape a page of", async () => {
  const { execute, calls } = toolset([board([pageFrame("pg1")], { id: "other", projectId: "p2" })]);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "other", pageId: "pg1", preset: "SQUARE" },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /no board called other/);
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

/// The guard is for the *user's* tab, which this cannot see: inside one design
/// call the queue below is what keeps the loop from doing it to itself.
test("a board that moved under the read is said as the user having it open", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])], [], drawn, 0);
  const outcome = await execute({
    name: "resize_page",
    args: { boardId: "b1", pageId: "pg1", preset: "SQUARE" },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /changed while I was reshaping/);
});

/// A page's rectangle and the objects standing on it are one scene and one
/// revision, so the reshape has to queue where the canvas writes queue — the
/// queue is made by the design call and handed to both toolsets.
test("the reshape runs in the board queue it was handed, under that board's key", async () => {
  const ran: string[] = [];
  const { execute } = toolset([board([pageFrame("pg1")])], [], drawn, 1, {
    run: async (key, task) => {
      ran.push(key);
      return task();
    },
    size: () => ran.length,
  });

  await execute({ name: "resize_page", args: { boardId: "b1", pageId: "pg1", preset: "SQUARE" } });
  /// A read is not queued: it writes nothing, and waiting on a write answers
  /// slower for no gain.
  await execute({ name: "get_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.deepEqual(ran, ["b1"]);
});

/// `duplicate_page` is agent 6's tool through this door too (§IV.2), and the
/// tests below are the door rather than the copy — the write agent 6's own tests
/// pin, without the tile, and with the one clause that names a tool said in
/// agent 8's vocabulary.
test("a copy is written back to the board it read, guarded on that revision", async () => {
  const { execute, calls } = toolset([board([pageFrame("pg1"), image("el1", "a")])]);
  const outcome = await execute({
    name: "duplicate_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  const write = calls.find((call) => call.op === "updateMany")!;
  assert.deepEqual(write.args.where, { id: "b1", revision: 7 });
  const data = write.args.data as Record<string, unknown>;
  assert.deepEqual(data.revision, { increment: 1 });
  /// The tab's stored picture is of a board that is one page shorter than the
  /// board now is.
  assert.equal(data.renderRevision, null);

  const result = resized(outcome.result);
  assert.deepEqual(result.copyOfPage, { pageId: "pg1", name: "Welcome sign" });
  assert.deepEqual(result.pictures, ["a"]);
  assert.notEqual((result.page as { pageId: string }).pageId, "pg1");
});

test("the copy answers in words alone — no tile, no picture", async () => {
  const { execute, asked } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({
    name: "duplicate_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  assert.deepEqual(Object.keys(outcome), ["result"]);
  /// A copy draws nothing on its own — and there is nothing new to look at
  /// either: the copy holds exactly what the page it came from holds.
  assert.deepEqual(asked, []);
});

test("a board with no pages is told how agent 8 starts one, not how agent 6 copies a board", async () => {
  const { execute } = toolset([board([image("el1", "a")])]);
  const outcome = await execute({
    name: "duplicate_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  const note = String(resized(outcome.result).pagesNote);
  assert.match(note, /put_on_canvas/);
  assert.doesNotMatch(note, /add_page/);
  assert.doesNotMatch(note, /duplicate_board/);
});

test("a page id the board does not carry is refused with the ids that would have worked", async () => {
  const { execute, calls } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({
    name: "duplicate_page",
    args: { boardId: "b1", pageId: "pg9" },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /no page called pg9/);
  assert.deepEqual(
    (resized(outcome.result).pages as { pageId: string }[]).map((page) => page.pageId),
    ["pg1"],
  );
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

test("no page named at all is refused rather than copying the first one", async () => {
  const { execute, calls } = toolset([board([pageFrame("pg1")])]);
  const outcome = await execute({ name: "duplicate_page", args: { boardId: "b1" } });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /there is no default page/);
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

test("a board of another project is no board to copy a page of", async () => {
  const { execute, calls } = toolset([board([pageFrame("pg1")], { id: "other", projectId: "p2" })]);
  const outcome = await execute({
    name: "duplicate_page",
    args: { boardId: "other", pageId: "pg1" },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /no board called other/);
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

test("a board that moved under the copy is said as the user having it open", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])], [], drawn, 0);
  const outcome = await execute({
    name: "duplicate_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /changed while I was copying/);
});

/// Unlike a board's copy, which writes a row nobody else can be holding, this
/// one writes back to the scene it read — so it queues where the canvas writes
/// queue or the revision guard throws one of the two away.
test("the copy runs in the board queue it was handed, under that board's key", async () => {
  const ran: string[] = [];
  const { execute } = toolset([board([pageFrame("pg1")])], [], drawn, 1, {
    run: async (key, task) => {
      ran.push(key);
      return task();
    },
    size: () => ran.length,
  });

  await execute({ name: "duplicate_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.deepEqual(ran, ["b1"]);
});

test("the name the user said is the copy's, and no name is Page N rather than a bracket", async () => {
  const { execute } = toolset([board([pageFrame("pg1")])]);
  const named = await execute({
    name: "duplicate_page",
    args: { boardId: "b1", pageId: "pg1", name: "Second try" },
  });
  const unnamed = await execute({
    name: "duplicate_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(named);
  assert.ok(unnamed);
  assert.equal((resized(named.result).page as { name: string }).name, "Second try");
  assert.equal((resized(unnamed.result).page as { name: string }).name, "Page 2");
});

/// A board of two pages laid out by a template, the second a `PAGE_GAP` to the
/// right of the first — what a compose leaves behind, and the only shape in
/// which "that page was standing exactly as its template composed it" is true.
function spread(
  pages: readonly { id: string; name: string; placed: readonly [string, string][] }[],
) {
  const layout = layoutById("SPLIT")!;
  return board(
    pages.flatMap(({ id, name, placed }, index) => {
      const left = index * (layout.page.width + PAGE_GAP);
      return [
        ...placed.map(([referenceId, slotId], slot) => {
          const box = fitInSlot(layout.slots.find((entry) => entry.id === slotId)!, {
            id: referenceId,
            kind: "image",
            width: 4000,
            height: 3000,
          });
          return {
            id: `${id}-el-${slot}`,
            type: "image",
            fileId: `ref:${referenceId}`,
            frameId: id,
            ...box,
            x: box.x + left,
          };
        }),
        pageFrame(id, {
          name,
          x: left,
          width: layout.page.width,
          height: layout.page.height,
        }),
      ];
    }),
    { layout: layout.id },
  );
}

/// The two pages every move below is between, as agent 8 makes them: rectangles
/// on a canvas with pictures standing where they were put rather than in slots.
const twoPages = () =>
  board([
    pageFrame("pg1"),
    image("el1", "a"),
    image("el2", "b", { x: 700 }),
    pageFrame("pg2", { x: 2100, name: "Act two" }),
  ]);

const elementsWritten = (calls: readonly Call[]) =>
  ((calls.find((call) => call.op === "updateMany")!.args.data as { elements: unknown[] })
    .elements ?? []) as { fileId?: string; frameId?: string }[];

/// `move_to_page` is agent 6's tool through this door as well (§IV.2). What the
/// tests below assert is the door — the write agent 6's own tests pin, without
/// the tile, and with the three sentences that name a tool said in the tools
/// agent 8 actually holds.
test("a picture carried across comes off the page it was on and the board holds it once", async () => {
  const { execute, calls } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg2", referenceIds: ["b"] },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.deepEqual(result.moved, ["b"]);
  assert.deepEqual(result.from, { pageId: "pg1", name: "Welcome sign" });
  assert.deepEqual(result.to, { pageId: "pg2", name: "Act two" });

  const write = calls.find((call) => call.op === "updateMany")!;
  assert.deepEqual(write.args.where, { id: "b1", revision: 7 });
  /// The tab's stored picture is of two pages that no longer hold what it shows.
  assert.equal((write.args.data as { renderRevision: unknown }).renderRevision, null);

  const written = elementsWritten(calls);
  const copies = written.filter((element) => element.fileId === "ref:b");
  assert.equal(copies.length, 1);
  assert.equal(copies[0]!.frameId, "pg2");
  /// And nothing else moved: the picture that was not named is where it was.
  assert.equal(written.find((element) => element.fileId === "ref:a")?.frameId, undefined);
});

/// §III: nothing agent 8 does is ever shown to a user, so the tile the shared
/// tool hands back is dropped rather than never built — which is what keeps the
/// two agents on one implementation.
test("the move answers in words alone — no tile, no picture", async () => {
  const { execute, asked } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg2", referenceIds: ["b"] },
  });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  assert.deepEqual(Object.keys(outcome), ["result"]);
  /// A move draws nothing: what it changed is looked at with `get_page`, which
  /// is a call the model makes rather than a picture this one hands over.
  assert.deepEqual(asked, []);
});

/// Agent 6 is told to read the board with `inspect_board`, which agent 8 has
/// not got — it reads a board with `read_canvas` and a page with `get_page`.
test("a picture the page named has not got sends agent 8 to its own read", async () => {
  const { execute, calls } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg2", toPageId: "pg1", referenceIds: ["b"] },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.deepEqual(result.notOnThatPage, ["b"]);
  const note = String(result.notOnThatPageNote);
  assert.match(note, /read_canvas/);
  assert.doesNotMatch(note, /inspect_board/);
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

/// One page named twice would take a picture off a page and put it back on it.
/// Agent 6's refusal offers `add_page` for the page that does not exist yet;
/// agent 8 draws one with the canvas tool it already has.
test("the same page at both ends is refused, and the page it lacks is put_on_canvas's", async () => {
  const { execute, calls } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg1", referenceIds: ["b"] },
  });

  assert.ok(outcome);
  const error = String(resized(outcome.result).error);
  assert.match(error, /both ends of that move/);
  assert.match(error, /put_on_canvas/);
  assert.doesNotMatch(error, /add_page/);
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

test("a page id the board does not carry is refused with the ids that would have worked", async () => {
  const { execute, calls } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg9", referenceIds: ["b"] },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.match(String(result.error), /no page called pg9/);
  assert.deepEqual(
    (result.pages as { pageId: string }[]).map((page) => page.pageId),
    ["pg1", "pg2"],
  );
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

test("a board with no pages is told how agent 8 draws one, not how agent 6 does", async () => {
  const { execute } = toolset([board([image("el1", "a")])], [photo("a")]);
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg2", referenceIds: ["a"] },
  });

  assert.ok(outcome);
  const note = String(resized(outcome.result).pagesNote);
  assert.match(note, /put_on_canvas/);
  assert.doesNotMatch(note, /add_page/);
});

test("a board of another project is no board to move a picture on", async () => {
  const { execute, calls } = toolset(
    [board([pageFrame("pg1")], { id: "other", projectId: "p2" })],
    [photo("a")],
  );
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "other", fromPageId: "pg1", toPageId: "pg2", referenceIds: ["a"] },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /no board called other/);
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

test("a board that moved under the move is said as the user having it open", async () => {
  const { execute } = toolset([twoPages()], [photo("a"), photo("b")], drawn, 0);
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg2", referenceIds: ["b"] },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /changed while I was moving pictures/);
});

/// Both pages are on one scene and one revision, so the move has to queue where
/// the canvas writes queue — the queue is the design call's, handed to both
/// toolsets that write.
test("the move runs in the board queue it was handed, under that board's key", async () => {
  const ran: string[] = [];
  const { execute } = toolset([twoPages()], [photo("a"), photo("b")], drawn, 1, {
    run: async (key, task) => {
      ran.push(key);
      return task();
    },
    size: () => ran.length,
  });

  await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg2", referenceIds: ["b"] },
  });

  assert.deepEqual(ran, ["b1"]);
});

/// The page the picture joined was standing exactly as its template composed it
/// and now carries one below the slots. Agent 6 offers a rebuild; agent 8 is the
/// thing that arranges, so the same fact ends in the tool it holds.
test("a page that was standing in its template is agent 8's own to arrange again", async () => {
  const { execute } = toolset(
    [
      spread([
        { id: "pg1", name: "Cold open", placed: [["a", "img-1"], ["b", "img-2"]] },
        { id: "pg2", name: "Act two", placed: [["c", "img-1"], ["d", "img-2"]] },
      ]),
    ],
    [photo("a"), photo("b"), photo("c"), photo("d")],
  );
  const outcome = await execute({
    name: "move_to_page",
    args: { boardId: "b1", fromPageId: "pg1", toPageId: "pg2", referenceIds: ["b"] },
  });

  assert.ok(outcome);
  const note = String(resized(outcome.result).layoutNote);
  assert.match(note, /standing exactly as SPLIT composed it/);
  assert.match(note, /transform_on_canvas/);
  assert.doesNotMatch(note, /compose_moodboard/);
});

/// `discard_page` is agent 6's tool through this door too (§IV.2), and the one
/// where the two agents differ in what an offer *is*: agent 6's ends in a tile
/// with a Discard button under it, and agent 8 has no user to press one (§III),
/// so the whole of its offer is the words it is told to write.
test("the offer says what the page holds and takes nothing", async () => {
  const { execute, calls } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.equal(result.boardId, "b1");
  assert.equal(result.pageId, "pg1");
  assert.equal(result.name, "Welcome sign");
  assert.equal(result.position, 1);
  assert.equal(result.of, 2);
  assert.deepEqual(result.pictures, ["a", "b"]);
  assert.equal(result.pageSize, "1920×1080");
  /// Nothing was written and nothing was asked of a model: the offer is a read.
  assert.equal(calls.filter((call) => call.op === "updateMany").length, 0);
});

test("the offer is the answer's own words — no tile, no picture", async () => {
  const { execute, asked } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  assert.equal(outcome.pictures, undefined);
  assert.deepEqual(Object.keys(outcome), ["result"]);
  assert.deepEqual(asked, []);
});

/// The one fork that is not about tool names. `instruction.ts` — which the spec
/// mandates verbatim — tells agent 8 the user presses the button, and there is
/// none; the answer is where that is put right, on `discard_image`'s terms.
test("the status tells agent 8 it is holding the whole of the offer, not half of it", async () => {
  const { execute } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  const status = String(resized(outcome.result).status);
  assert.match(status, /offered, not done/);
  assert.match(status, /this answer is the whole of the offer/);
  assert.match(status, /closing line/);
  assert.doesNotMatch(status, /button beside your reply/);
  assert.match(status, /never say the page is gone, removed or deleted/);
});

/// Agent 6 answers the board's last page with `discard_board`. Agent 8 cannot
/// offer a board at all, so the same fact ends in what it can honestly say.
test("the board's only page is said as a board left standing, not as discard_board's", async () => {
  const { execute } = toolset([board([pageFrame("pg1"), image("el1", "a")])], [photo("a")]);
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.equal(result.emptiesBoard, true);
  const note = String(result.emptiesBoardNote);
  assert.match(note, /leaves the board standing with nothing on it/);
  assert.match(note, /not something you can offer/);
  assert.doesNotMatch(note, /discard_board/);
});

test("a board with no pages is told what agent 8 can take off it instead", async () => {
  const { execute } = toolset([board([image("el1", "a")])], [photo("a")]);
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  const note = String(resized(outcome.result).pagesNote);
  assert.match(note, /remove_from_canvas/);
  assert.doesNotMatch(note, /discard_board/);
});

test("a page id the board does not carry is refused with the ids that would have worked", async () => {
  const { execute } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "b1", pageId: "pg9" },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.match(String(result.error), /no page called pg9/);
  assert.deepEqual(
    (result.pages as { pageId: string }[]).map((page) => page.pageId),
    ["pg1", "pg2"],
  );
});

test("no page named at all is refused rather than offering the first one", async () => {
  const { execute } = toolset([twoPages()], [photo("a"), photo("b")]);
  const outcome = await execute({ name: "discard_page", args: { boardId: "b1" } });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.match(String(result.error), /no page called /);
  assert.equal(result.pageId, undefined);
});

test("a board of another project is no board to offer a page off", async () => {
  const { execute } = toolset(
    [board([pageFrame("pg1")], { id: "other", projectId: "p2" })],
    [photo("a")],
  );
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "other", pageId: "pg1" },
  });

  assert.ok(outcome);
  assert.match(String(resized(outcome.result).error), /no board called other/);
});

/// §V.1's peer entity: a frame the user drew inside the page is not the page's,
/// and the photographs it keeps are not part of the loss.
test("a section the page was drawn over stays, and its pictures are not counted as lost", async () => {
  const { execute } = toolset(
    [
      board([
        pageFrame("pg1"),
        image("el1", "a"),
        { id: "sec1", type: "frame", name: "Textures", x: 900, y: 100, width: 500, height: 500 },
        image("el2", "b", { x: 1000, y: 200, width: 200, height: 200, frameId: "sec1" }),
      ]),
    ],
    [photo("a"), photo("b")],
  );
  const outcome = await execute({
    name: "discard_page",
    args: { boardId: "b1", pageId: "pg1" },
  });

  assert.ok(outcome);
  const result = resized(outcome.result);
  assert.deepEqual(result.pictures, ["a"]);
  assert.equal(result.sectionsOnIt, 1);
  assert.equal(result.keptInSections, 1);
  assert.match(String(result.sectionsNote), /stays on the board with its own pictures/);
});

/// Unqueued, unlike the three page writes: it changes nothing, and an offer made
/// to wait on a `put_on_canvas` answers slower for no gain.
test("the offer does not queue behind the board's writes", async () => {
  const ran: string[] = [];
  const { execute } = toolset([twoPages()], [photo("a"), photo("b")], drawn, 1, {
    run: async (key, task) => {
      ran.push(key);
      return task();
    },
    size: () => ran.length,
  });

  await execute({ name: "discard_page", args: { boardId: "b1", pageId: "pg1" } });

  assert.deepEqual(ran, []);
});
