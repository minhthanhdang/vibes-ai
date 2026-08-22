import { test } from "node:test";
import assert from "node:assert/strict";

import { pageToolset } from "./page";
import { GET_PAGE } from "@/lib/agent/designer-tools";
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

const drawn: ModelRender = {
  uri: "gs://director-bucket/renders/pages/pg1@7.png",
  revision: 7,
  drawn: "made",
  undrawn: [],
};

function toolset(
  boards: readonly Board[],
  rows: readonly Row[] = [],
  answer: ModelRender = drawn,
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
    },
  } as unknown as PrismaClient;

  return {
    ...pageToolset({
      db,
      projectId: "p1",
      render: async (request) => {
        asked.push(request);
        return answer;
      },
    }),
    calls,
    asked,
  };
}

const textOf = (result: unknown) => (result as { page: string }).page;

test("get_page is the toolset's one declaration and other names are not its own", async () => {
  const { declarations, execute } = toolset([]);
  assert.deepEqual(
    declarations.map(({ name }) => name),
    [GET_PAGE.name],
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
