import { test } from "node:test";
import assert from "node:assert/strict";

import { NO_INTENTION, designAsk, designPage, designerToolsets } from "./design";
import { designerInstruction } from "./instruction";
import { GET_SKILLS } from "./skills";
import { DESIGNER_ROUND_LIMIT } from "./loop";
import { LIST_GALLERY } from "@/lib/agent/designer/gallery-tools";
import { GET_PAGE } from "@/lib/agent/designer/page-tools";
import { READ_CANVAS } from "@/lib/agent/shared/canvas-tools";
import type { PrismaClient } from "@/generated/prisma/client";
import { MODELS, type Content, type GenerateConfig } from "@/server/google/vertex";
import type { ModelRender } from "@/server/render/for-model";

type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } };

const PER_ROUND = { promptTokenCount: 3000, candidatesTokenCount: 120, totalTokenCount: 3120 };

function saying(...rounds: Part[][]) {
  const sent: Content[][] = [];
  const generate = (async (_model: string, contents: Content[]) => {
    sent.push(JSON.parse(JSON.stringify(contents)) as Content[]);
    const round = rounds[sent.length - 1] ?? rounds[rounds.length - 1];
    assert.ok(round, "the designer asked with no answer scripted");
    return {
      candidates: [{ content: { parts: round } }],
      usageMetadata: PER_ROUND,
    };
  }) as never;
  return { sent, generate };
}

const call = (name: string, args: Record<string, unknown> = {}): Part => ({
  functionCall: { name, args },
});

const pageFrame = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "frame",
  name: "Welcome sign",
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  customData: { page: { preset: "LANDSCAPE_HD" } },
  ...over,
});

type Board = {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  elements: unknown[];
  appState: unknown;
  layout: string | null;
  layoutSlots: unknown;
  widthPx: number;
  heightPx: number;
};

const board = (over: Partial<Board> = {}): Board => ({
  id: "b1",
  projectId: "p1",
  title: "Wedding",
  revision: 7,
  elements: [pageFrame("pg1")],
  appState: { viewBackgroundColor: "#ffffff" },
  layout: null,
  layoutSlots: null,
  widthPx: 1920,
  heightPx: 1080,
  ...over,
});

const photo = (id: string, title: string) => ({
  id,
  title,
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
  analysis: null,
});

type Call = { table: string; op: string; args: Record<string, unknown> };

const drawn: ModelRender = {
  uri: "gs://director-bucket/renders/pages/pg1@7.png",
  revision: 7,
  drawn: "made",
  undrawn: [],
  occupancy: { axis: "y", bands: [], covered: 0, backdrops: 0 },
  contrast: { pairs: 0, overImage: 0, failing: [], worst: null },
};

function project({
  boards = [board()],
  rows = [] as ReturnType<typeof photo>[],
}: { boards?: Board[]; rows?: ReturnType<typeof photo>[] } = {}) {
  const calls: Call[] = [];
  let runs = 0;
  const record =
    <T,>(table: string, op: string, give: (args: Record<string, unknown>) => T) =>
    async (args: Record<string, unknown>) => {
      calls.push({ table, op, args });
      return give(args);
    };

  const db = {
    reference: { findMany: record("reference", "findMany", () => rows) },
    agentRun: {
      findMany: record("agentRun", "findMany", () => []),
      create: record("agentRun", "create", () => ({ id: `run${(runs += 1)}` })),
      update: record("agentRun", "update", () => ({})),
    },
    moodboard: {
      findFirst: record("moodboard", "findFirst", (args) => {
        const where = args.where as { id: string; projectId: string };
        return (
          boards.find((one) => one.id === where.id && one.projectId === where.projectId) ?? null
        );
      }),
      findMany: record("moodboard", "findMany", () => boards),
    },
  } as unknown as PrismaClient;

  const of = (table: string, op: string) =>
    calls.filter((one) => one.table === table && one.op === op);

  return { db, calls, of, render: async () => drawn };
}

const askIn = (sent: Content[][]) => String(sent[0]?.[0]?.parts?.[0]?.text ?? "");

const answered = (result: unknown) => result as { line: string; runId: string; calls: string[] };

test("the ask names the board, the page and the intention in the user's own words", () => {
  const ask = designAsk({
    board: { id: "b1", title: "Wedding" },
    page: { id: "pg1", name: "Ceremony", position: 2 },
    pages: 3,
    newPage: false,
    intention: "make the headline sit over the top third",
    pictures: [{ id: "r1", title: "bride.jpg" }],
  });

  assert.match(ask, /boardId b1/);
  assert.match(ask, /"Wedding"/);
  assert.match(ask, /"Ceremony" \(pageId pg1\)/);
  assert.match(ask, /make the headline sit over the top third/);
  assert.match(ask, /- bride\.jpg \(imageId r1\)/);
});

test("newPage says the page is to be made and the board left alone", () => {
  const beside = designAsk({
    board: { id: "b1", title: "" },
    page: { id: "pg1", name: "Ceremony", position: 1 },
    pages: 1,
    newPage: true,
    intention: "another version",
    pictures: [],
  });

  assert.match(beside, /fresh page beside "Ceremony" \(pageId pg1\)/);
  assert.match(beside, /put_on_canvas/);
  assert.match(beside, /leave everything already on the board where it is/);
  assert.doesNotMatch(beside, /Work on/);

  const alone = designAsk({
    board: { id: "b1", title: "Wedding" },
    page: null,
    pages: 0,
    newPage: true,
    intention: "a welcome sign",
    pictures: [],
  });
  assert.match(alone, /fresh page of its own/);
});

test("a board with pages and no page named is a board to read first", () => {
  const many = designAsk({
    board: { id: "b1", title: "Wedding" },
    page: null,
    pages: 3,
    newPage: false,
    intention: "a welcome sign",
    pictures: [],
  });
  assert.match(many, /3 pages/);
  assert.match(many, /read it before you place anything/);

  const none = designAsk({
    board: { id: "b1", title: "Wedding" },
    page: null,
    pages: 0,
    newPage: false,
    intention: "a welcome sign",
    pictures: [],
  });
  assert.match(none, /no pages yet/);
  assert.match(none, /put_on_canvas/);
});

test("an ask with no intention is refused before anything is read", async () => {
  const { db, calls } = project();
  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    intention: "   ",
  });

  assert.deepEqual(outcome, { error: NO_INTENTION });
  assert.deepEqual(calls, []);
});

test("a board of another project is no board at all, and costs no run row", async () => {
  const { db, of } = project({ boards: [board({ projectId: "p2" })] });
  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    intention: "a welcome sign",
  });

  assert.match(String((outcome as { error: string }).error), /no board called b1/);
  assert.deepEqual(of("agentRun", "create"), []);
});

test("a page the board does not carry is refused above the run row", async () => {
  const { db, of } = project();
  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg9",
    intention: "a welcome sign",
  });

  const error = String((outcome as { error: string }).error);
  assert.match(error, /no page called pg9 on the board b1/);
  assert.match(error, /inspect_board/);
  assert.deepEqual(of("agentRun", "create"), []);
});

test("the five toolsets are one set of names, and a name none of them owns is said", async () => {
  const { db, render } = project();
  const { sent, generate } = saying(
    [call("paint_it_red")],
    [{ text: "I could not do that." }],
  );
  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  const answers = sent[1]!.flatMap((content) =>
    content.parts.flatMap((part) => (part.functionResponse ? [part.functionResponse] : [])),
  );
  assert.equal(answers.length, 1);
  assert.match(
    String((answers[0]!.response as { error: string }).error),
    /no tool called paint_it_red/,
  );
});

test("the declarations handed to the model are every toolset's, once each", async () => {
  const { db, render } = project();
  let given: string[] = [];
  const generate = (async (_model: string, _contents: Content[], config: GenerateConfig = {}) => {
    const tools = (config as { tools?: { functionDeclarations: { name: string }[] }[] }).tools;
    given = (tools ?? []).flatMap(({ functionDeclarations }) =>
      functionDeclarations.map(({ name }) => name),
    );
    return { candidates: [{ content: { parts: [{ text: "done" }] } }], usageMetadata: PER_ROUND };
  }) as never;

  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    intention: "a welcome sign",
    generate,
    render,
  });

  assert.deepEqual([...new Set(given)], given);
  for (const name of [READ_CANVAS.name, GET_PAGE.name, LIST_GALLERY.name, GET_SKILLS.name]) {
    assert.ok(given.includes(name), `${name} was not declared`);
  }
});

const TWENTY_ONE = [
  "read_canvas",
  "put_on_canvas",
  "remove_from_canvas",
  "transform_on_canvas",
  "reorder_on_canvas",
  "restyle_on_canvas",
  "get_page",
  "duplicate_page",
  "resize_page",
  "move_to_page",
  "set_page_background",
  "discard_page",
  "swap_on_board",
  "reword_on_board",
  "list_gallery",
  "get_image",
  "get_modification",
  "discard_image",
  "generate_image",
  "crop_image",
  "get_skills",
];

const toolsetNames = () =>
  designerToolsets({ db: project().db, projectId: "p1", boardId: "b1" }).flatMap(
    ({ declarations }) => declarations.map(({ name }) => name),
  );

test("the assembled toolsets are §IV's twenty-one, in §IV's order", () => {
  assert.deepEqual(toolsetNames(), TWENTY_ONE);
});

test("no declaration agent 8 reads gives a page size in pixels", () => {
  const written = designerToolsets({ db: project().db, projectId: "p1", boardId: "b1" }).flatMap(
    ({ declarations }) => declarations.map((declaration) => JSON.stringify(declaration)),
  );
  assert.deepEqual(
    written.flatMap((text) => text.match(/\b\d{3,4} ?[x\u00d7] ?\d{3,4}\b/g) ?? []),
    [],
  );
});

const BYTE_MAKERS = ["generate_image", "crop_image"];

test("every tool the instruction names is one agent 8 holds, and the reverse", () => {
  const named = new Set(designerInstruction().match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
  assert.deepEqual(
    [...named].sort(),
    TWENTY_ONE.filter((name) => !BYTE_MAKERS.includes(name)).sort(),
  );
});

test("one read of the project's pictures serves every toolset in the call", async () => {
  const { db, of, render } = project({ rows: [photo("r1", "bride.jpg")] });
  const { generate } = saying(
    [call(LIST_GALLERY.name, {}), call(GET_PAGE.name, { boardId: "b1", pageId: "pg1" })],
    [{ text: "I put the portrait at the top." }],
  );

  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    imageIds: ["r1"],
    intention: "a welcome sign",
    generate,
    render,
  });

  assert.equal(of("reference", "findMany").length, 1);
});

test("a picture agent 6 named that the project does not have rides out rather than refusing", async () => {
  const { db, of, render } = project({ rows: [photo("r1", "bride.jpg")] });
  const { sent, generate } = saying([{ text: "done" }]);

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    imageIds: ["r1", "gone"],
    intention: "a welcome sign",
    generate,
    render,
  });

  assert.deepEqual((outcome as { notFound: string[] }).notFound, ["gone"]);
  assert.match(askIn(sent), /bride\.jpg \(imageId r1\)/);
  assert.doesNotMatch(askIn(sent), /gone/);

  const closed = of("agentRun", "update")[0]!.args.data as { output: { notFound: string[] } };
  assert.deepEqual(closed.output.notFound, ["gone"]);
});

test("one DESIGNER row per call, opened running and closed on what the loop spent", async () => {
  const { db, of, render } = project();
  const { generate } = saying(
    [call(GET_PAGE.name, { boardId: "b1", pageId: "pg1" })],
    [{ text: "I put the portrait at the top." }],
  );

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  const opened = of("agentRun", "create");
  assert.equal(opened.length, 1);
  const open = opened[0]!.args.data as {
    agent: string;
    status: string;
    input: { boardId: string; onPage: string; intention: string };
  };
  assert.equal(open.agent, "DESIGNER");
  assert.equal(open.status, "RUNNING");
  assert.deepEqual(open.input, {
    boardId: "b1",
    intention: "a welcome sign",
    onPage: "pg1",
  });

  const closed = of("agentRun", "update");
  assert.equal(closed.length, 1);
  const close = closed[0]!.args.data as {
    status: string;
    model: string;
    totalTokens: number;
    output: { calls: string[]; rounds: number; modelCalls: number; pictures: number };
  };
  assert.equal(close.status, "SUCCEEDED");
  assert.equal(close.model, MODELS.FLASH);
  assert.equal(close.totalTokens, PER_ROUND.totalTokenCount * 2);
  assert.deepEqual(close.output.calls, [GET_PAGE.name]);
  assert.equal(close.output.rounds, 1);
  assert.equal(close.output.modelCalls, 2);
  assert.equal(close.output.pictures, 1);

  assert.equal(answered(outcome).line, "I put the portrait at the top.");
  assert.equal(answered(outcome).runId, "run1");
  assert.deepEqual(answered(outcome).calls, [GET_PAGE.name]);
});

test("a design that hit the round ceiling says so on the row and to agent 6", async () => {
  const { db, of, render } = project();
  const { generate } = saying([call(GET_SKILLS.name, { names: ["typography"] })]);

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  assert.equal((outcome as { stopped: string }).stopped, "rounds");
  const closed = of("agentRun", "update")[0]!.args.data as {
    status: string;
    output: { stopped: string; rounds: number };
  };
  assert.equal(closed.status, "SUCCEEDED");
  assert.equal(closed.output.stopped, "rounds");
  assert.equal(closed.output.rounds, DESIGNER_ROUND_LIMIT);
});

test("a loop that throws closes its own row failed rather than leaving it running", async () => {
  const { db, of, render } = project();
  const generate = (async () => {
    throw new Error("vertex is down");
  }) as never;

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  assert.deepEqual(outcome, { error: "vertex is down", runId: "run1" });
  const closed = of("agentRun", "update")[0]!.args.data as { status: string; error: string };
  assert.equal(closed.status, "FAILED");
  assert.equal(closed.error, "vertex is down");
});

test("what the looking cost the bucket is on the row, made from cached from failed", async () => {
  const { db, of } = project();
  const answers: ModelRender[] = [
    { ...drawn, drawn: "made" },
    { ...drawn, drawn: "cached" },
    { failed: true, reason: "the renderer did not finish drawing that page in time" },
  ];
  let asked = 0;
  const render = async () => answers[asked++] ?? answers[answers.length - 1]!;

  const { generate } = saying(
    [call(GET_PAGE.name, { boardId: "b1", pageId: "pg1" })],
    [call(READ_CANVAS.name, { boardId: "b1" })],
    [call(GET_PAGE.name, { boardId: "b1", pageId: "pg1" })],
    [{ text: "I put the portrait at the top." }],
  );

  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  assert.equal(asked, 3);
  const closed = of("agentRun", "update")[0]!.args.data as {
    output: { renders: { made: number; cached: number; failed: number } };
  };
  assert.deepEqual(closed.output.renders, { made: 1, cached: 1, failed: 1 });
});

test("a design that never looked carries no render count at all", async () => {
  const { db, of, render } = project();
  const { generate } = saying([{ text: "There is nothing here I can design yet." }]);

  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  const closed = of("agentRun", "update")[0]!.args.data as { output: Record<string, unknown> };
  assert.equal("renders" in closed.output, false);
});

test("the draws a design made before it threw are on the failed row", async () => {
  const { db, of } = project();
  let asked = 0;
  const render = async () => {
    asked += 1;
    return drawn;
  };
  const generate = (async (_model: string, contents: unknown[]) => {
    if (contents.length > 1) throw new Error("vertex is down");
    return {
      candidates: [
        { content: { parts: [call(GET_PAGE.name, { boardId: "b1", pageId: "pg1" })] } },
      ],
      usageMetadata: PER_ROUND,
    };
  }) as never;

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  assert.equal((outcome as { error: string }).error, "vertex is down");
  assert.equal(asked, 1);
  const closed = of("agentRun", "update")[0]!.args.data as {
    status: string;
    output: { renders: { made: number } };
  };
  assert.equal(closed.status, "FAILED");
  assert.deepEqual(closed.output.renders, { made: 1, cached: 0, failed: 0 });
});

test("the skills a design read are on its row, and only the ones that answered", async () => {
  const { db, of, render } = project();
  const { generate } = saying(
    [
      call(GET_SKILLS.name, {
        skills: ["wedding-designer", "not-a-skill", "typography", "composition", "grid-systems"],
      }),
    ],
    [{ text: "I set the names across the top." }],
  );

  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  const closed = of("agentRun", "update")[0]!.args.data as { output: { skills: string[] } };
  assert.deepEqual(closed.output.skills, [
    "wedding-designer",
    "typography",
    "composition",
    "grid-systems",
  ]);
});

test("a design that read no skill carries no skills key", async () => {
  const { db, of, render } = project();
  const { generate } = saying([{ text: "There is nothing here I can design yet." }]);

  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  const closed = of("agentRun", "update")[0]!.args.data as { output: Record<string, unknown> };
  assert.equal("skills" in closed.output, false);
});

test("the skills read before a throw are on the failed row", async () => {
  const { db, of, render } = project();
  const generate = (async (_model: string, contents: unknown[]) => {
    if (contents.length > 1) throw new Error("vertex is down");
    return {
      candidates: [{ content: { parts: [call(GET_SKILLS.name, { skills: ["photographer"] })] } }],
      usageMetadata: PER_ROUND,
    };
  }) as never;

  await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    pageId: "pg1",
    intention: "a welcome sign",
    generate,
    render,
  });

  const closed = of("agentRun", "update")[0]!.args.data as {
    status: string;
    output: { skills: string[] };
  };
  assert.equal(closed.status, "FAILED");
  assert.deepEqual(closed.output.skills, ["photographer"]);
});

const scene = (result: unknown) =>
  result as {
    pageId?: string;
    boardTitle: string;
    report: { page?: { pageId: string }; pages?: unknown[]; placed: { referenceId: string }[] };
    scene: { board: { id: string; title: string }; elements: unknown[] };
  };

function writing(one: Board, after: unknown[]) {
  const { sent, generate } = saying([call("put_on_canvas", {})], [{ text: "done." }]);
  const writes = (async (model: string, contents: Content[], config: GenerateConfig) => {
    const answer = await (generate as unknown as (
      m: string,
      c: Content[],
      g: GenerateConfig,
    ) => Promise<unknown>)(model, contents, config);
    if (sent.length === 1) one.elements = after;
    return answer;
  }) as never;
  return { sent, generate: writes };
}

const imageOn = (id: string, referenceId: string, box: Record<string, number> = {}) => ({
  id,
  type: "image",
  fileId: `ref:${referenceId}`,
  x: 100,
  y: 100,
  width: 400,
  height: 300,
  ...box,
});

test("the report is read off the board the design left, not off the one the door read", async () => {
  const one = board();
  const { db, of } = project({ boards: [one], rows: [photo("r1", "gate.jpg")] });
  const { generate } = writing(one, [pageFrame("pg1"), imageOn("el1", "r1")]);

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    intention: "a welcome sign",
    generate,
    render: async () => drawn,
  });

  const answer = scene(outcome);
  assert.deepEqual(answer.report.placed, [{ referenceId: "r1", clipped: false }]);
  assert.equal(answer.report.page?.pageId, "pg1");
  assert.equal(answer.pageId, "pg1");
  assert.equal(answer.boardTitle, "Wedding");

  assert.equal(of("moodboard", "findFirst").length, 2);
  assert.equal(answer.scene.board.id, "b1");
  assert.equal(answer.scene.board.title, "Wedding");
  assert.equal(answer.scene.elements.length, 2);
});

test("a page the design made itself is the page the answer names", async () => {
  const one = board({ elements: [pageFrame("pg1")] });
  const { db } = project({ boards: [one] });
  const { generate } = writing(one, [
    pageFrame("pg1"),
    pageFrame("pg2", { x: 2200, name: "The exteriors" }),
  ]);

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    intention: "a poster for the exteriors as well",
    newPage: true,
    generate,
    render: async () => drawn,
  });

  const answer = scene(outcome);
  assert.equal(answer.pageId, "pg2");
  assert.equal(answer.report.page?.pageId, "pg2");
});

test("a board of several pages with none named is answered with the pages", async () => {
  const one = board({
    elements: [pageFrame("pg1"), pageFrame("pg2", { x: 2200, name: "Act two" })],
  });
  const { db } = project({ boards: [one] });
  const { generate } = saying([{ text: "read it and left it." }]);

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    intention: "tidy it up",
    generate,
    render: async () => drawn,
  });

  const answer = scene(outcome);
  assert.equal(answer.pageId, undefined);
  assert.equal(answer.report.page, undefined);
  assert.equal(answer.report.pages?.length, 2);
});

test("a board of one page is that page, whether or not agent 6 named it", async () => {
  const { db } = project({ boards: [board()] });
  const { generate } = saying([{ text: "done." }]);

  const outcome = await designPage({
    db,
    projectId: "p1",
    boardId: "b1",
    intention: "a welcome sign",
    generate,
    render: async () => drawn,
  });

  assert.equal(scene(outcome).pageId, "pg1");
});
