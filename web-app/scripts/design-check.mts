import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { formatCost, spendSummary } from "../src/lib/agent/shared/model-cost";
import { boardPages, pagesInReadingOrder } from "../src/lib/pages/board-pages";
import { planRead, planReadLine } from "../src/lib/render/plan-read";
import { pageRenderPlan } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import { designPage } from "../src/server/agents/designer/design";
import { canvasToolset } from "../src/server/canvas/tool-canvas";
import { closeDb, db } from "../src/server/db";
import { readObject } from "../src/server/google/storage";
import { RENDER_SOURCE_BYTE_LIMIT, renderForModel } from "../src/server/render/for-model";
import {
  generateContent,
  generateContentStream,
  functionCallsIn,
  textOf,
  type Content,
} from "../src/server/google/vertex";

config({ path: ".env.local" });
config({ path: ".env" });

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

const FLAGS = ["--project", "--board", "--page", "--page-box", "--images", "--out"];
const boardWanted = valueOf("--board");
const projectWanted = valueOf("--project");
const pageWanted = valueOf("--page");
const imageIds = (valueOf("--images") ?? "").split(",").filter(Boolean);

const pageBoxWanted = valueOf("--page-box");

function pageBoxOf(said: string | undefined) {
  const match = /^(\d+)x(\d+)$/.exec((said ?? "").trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

const pageBox = pageBoxOf(pageBoxWanted);
if (pageBox && pageWanted) {
  console.error("--page names a page that exists and --page-box makes one — pass one of them");
  process.exit(1);
}
if (pageBoxWanted && !pageBox) {
  console.error(
    `--page-box takes <width>x<height> in page pixels, like 1920x640 — not ${pageBoxWanted}`,
  );
  process.exit(1);
}

const newPage = (argv.includes("--new-page") || !pageWanted) && !pageBox;
const out = valueOf("--out");

const intention = argv
  .filter((word, at) => !word.startsWith("--") && !FLAGS.includes(argv[at - 1] ?? ""))
  .join(" ")
  .trim();

if (!intention) {
  console.error(
    'usage: npm run design:check -- [--project <id>] [--board <id>] [--page <id>] [--page-box <w>x<h>] [--images <id,id>] [--out <dir>] "<what the design is for>"',
  );
  process.exit(1);
}

const seconds = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

function sent(contents: Content[]) {
  const parts = contents.flatMap(({ parts }) => parts);
  const pictures = parts.filter((part) => part.fileData || part.inlineData).length;
  const dropped = parts.filter(
    (part) => typeof part.text === "string" && part.text.startsWith("[The picture"),
  ).length;
  return { contents: contents.length, pictures, dropped };
}

const shape = (contents: Content[]) =>
  contents
    .map(
      ({ role, parts }) =>
        `${role[0]}[${parts
          .map((part) =>
            part.functionCall
              ? "c"
              : part.functionResponse
                ? "r"
                : part.fileData || part.inlineData
                  ? "P"
                  : part.text
                    ? "t"
                    : "?",
          )
          .join("")}]`,
    )
    .join(" ");

const shortly = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 900 ? `${text.slice(0, 897)}…` : text;
};

const named = ({ name, args }: { name: string; args?: Record<string, unknown> }) =>
  `${name}(${Object.entries(args ?? {})
    .map(([key, value]) => `${key}=${shortly(value)}`)
    .join(", ")})`;

let round = 0;

const watchedGenerate: typeof generateContentStream = async (model, contents, options) => {
  round += 1;
  const carried = sent(contents);
  const started = Date.now();
  let answer;
  try {
    answer = await generateContent(model, contents, options);
  } catch (cause) {
    console.log(`\nround ${round} refused by Vertex — sent ${shape(contents)}`);
    throw cause;
  }
  const parts = answer.candidates?.[0]?.content?.parts ?? [];
  const calls = functionCallsIn(parts);
  const text = textOf(parts);

  console.log(
    `\nround ${round}  ${carried.contents} contents, ${carried.pictures} picture${carried.pictures === 1 ? "" : "s"}${carried.dropped ? `, ${carried.dropped} dropped` : ""}  (${seconds(started)})`,
  );
  console.log(`  sent: ${shape(contents)}`);
  if (calls.length) console.log(`  asked: ${calls.map(named).join("  ")}`);
  if (text) console.log(`  said: ${text.trim()}`);
  if (!calls.length && !text) console.log(`  said nothing (${answer.candidates?.[0]?.finishReason})`);
  return answer;
};

const watchedRender: typeof renderForModel = async (request, options) => {
  const started = Date.now();
  const drawn = await renderForModel(request, options);
  const what = request.pageId ? `page ${request.pageId}` : `board ${request.boardId}`;
  console.log(
    "failed" in drawn
      ? `  drew ${what} — refused: ${drawn.reason}`
      : `  drew ${what} @${drawn.revision} ${drawn.drawn} in ${seconds(started)}${drawn.undrawn.length ? ` — not drawn: ${drawn.undrawn.map(({ type }) => type).join(", ")}` : ""}`,
  );
  return drawn;
};

try {
  const board = await db.moodboard.findFirst({
    where: { ...(boardWanted && { id: boardWanted }), ...(projectWanted && { projectId: projectWanted }) },
    select: { id: true, projectId: true, title: true, revision: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!board) {
    console.error("no board on this database — make one in the app first");
    process.exit(1);
  }

  console.log(
    `project ${board.projectId}\nboard "${board.title || "untitled"}" ${board.id} @${board.revision}`,
  );
  console.log(`asking for: ${intention}${newPage ? "  (on a fresh page)" : ""}`);

  let madePageId: string | undefined;
  if (pageBox) {
    const scene = await db.moodboard.findUniqueOrThrow({
      where: { id: board.id },
      select: { elements: true },
    });
    const standing = boardPages(persistableElements(scene.elements));
    const x = standing.reduce((right, page) => Math.max(right, page.x + page.width), 0) + 400;
    const y = standing.length ? Math.min(...standing.map((page) => page.y)) : 0;
    const { result } = await canvasToolset({
      db,
      projectId: board.projectId,
      references: async () => ({ all: [] }),
    }).putOnCanvas({
      boardId: board.id,
      objects: [
        {
          kind: "page",
          name: `${pageBox.width}x${pageBox.height} given`,
          box: [y, x, y + pageBox.height, x + pageBox.width],
        },
      ],
    });
    const put = Array.isArray(result.put) ? (result.put as { objectId?: unknown }[]) : [];
    madePageId = typeof put[0]?.objectId === "string" ? put[0].objectId : undefined;
    if (!madePageId) {
      console.error(`could not make the page: ${JSON.stringify(result)}`);
      process.exit(1);
    }
    console.log(
      `made page ${madePageId} at ${pageBox.width}x${pageBox.height} for the design to work in`,
    );
  }

  const before = new Set(
    boardPages(
      persistableElements(
        (
          await db.moodboard.findUniqueOrThrow({
            where: { id: board.id },
            select: { elements: true },
          })
        ).elements,
      ),
    ).map(({ id }) => id),
  );

  const started = Date.now();
  const outcome = await designPage({
    db,
    projectId: board.projectId,
    boardId: board.id,
    ...((pageWanted || madePageId) && { pageId: pageWanted ?? madePageId }),
    intention,
    imageIds,
    newPage,
    generate: watchedGenerate,
    render: watchedRender,
  });

  console.log(`\n${"─".repeat(70)}`);
  if (!("line" in outcome)) {
    console.log(`refused: ${outcome.error}`);
    process.exit(1);
  }

  console.log(`line: ${outcome.line}`);
  console.log(`called: ${outcome.calls.join(", ") || "nothing"}`);
  if (outcome.notFound?.length) console.log(`pictures not in this project: ${outcome.notFound.join(", ")}`);
  if (outcome.stopped) console.log(`stopped: ${outcome.stopped}`);

  const { report } = outcome;
  console.log(`board: "${outcome.boardTitle}" (${outcome.boardId})`);
  console.log(
    report.page
      ? `page: ${report.page.pageId} "${report.page.name}" ${report.page.position}/${report.page.of} · ${report.page.width}×${report.page.height} ${report.page.preset}`
      : `page: not resolvable — ${report.pages?.length ?? 0} on the board`,
  );
  console.log(
    `placed: ${
      report.placed
        .map(({ referenceId, clipped }) => (clipped ? `${referenceId} (clipped)` : referenceId))
        .join(", ") || "nothing"
    }`,
  );
  if (report.lines.length) console.log(`lines: ${report.lines.map((one) => `"${one}"`).join(", ")}`);
  if (report.background) console.log(`background: ${report.background}`);
  if (report.notPlaced?.length) console.log(`named and not placed: ${report.notPlaced.join(", ")}`);
  if (report.looseOnBoard?.length) console.log(`loose on the board: ${report.looseOnBoard.join(", ")}`);
  if (report.made?.generated?.length) console.log(`drew: ${report.made.generated.join(", ")}`);
  if (report.made?.cropped?.length) console.log(`cut: ${report.made.cropped.join(", ")}`);

  const run = await db.agentRun.findUniqueOrThrow({
    where: { id: outcome.runId },
    select: { model: true, agent: true, promptTokens: true, outputTokens: true, totalTokens: true, output: true },
  });
  console.log(`\nrun ${outcome.runId} (${seconds(started)}): ${JSON.stringify(run.output)}`);

  const spend = spendSummary([run]);
  console.log(
    `${run.model}  ${spend.total.usage.promptTokens} in ${spend.total.usage.outputTokens} out  ${formatCost(spend.total.costMicros)}`,
  );

  const after = await db.moodboard.findUniqueOrThrow({
    where: { id: board.id },
    select: { projectId: true, revision: true, elements: true, appState: true },
  });
  console.log(`board @${board.revision} → @${after.revision}`);

  const elements = persistableElements(after.elements);
  const made = pagesInReadingOrder(boardPages(elements)).filter(({ id }) =>
    outcome.pageId ? id === outcome.pageId : !before.has(id),
  );
  if (!made.length) console.log("no page — the design ended without one on the board");
  if (out && made.length) mkdirSync(out, { recursive: true });

  for (const page of made) {
    const read = planRead(
      pageRenderPlan(elements, page, {
        background: (after.appState as { viewBackgroundColor?: unknown } | null)
          ?.viewBackgroundColor,
      }),
    );
    console.log(`page ${page.id}${page.name ? ` "${page.name}"` : ""}: ${planReadLine(read)}`);

    if (!out) continue;
    const drawn = await renderForModel({ boardId: board.id, pageId: page.id, scene: after });
    if ("failed" in drawn) {
      console.log(`  not drawn: ${drawn.reason}`);
      continue;
    }
    const file = join(out, `${page.id}@${drawn.revision}.png`);
    writeFileSync(file, await readObject(drawn.uri, RENDER_SOURCE_BYTE_LIMIT));
    console.log(`  ${file}`);
  }
} finally {
  await closeDb();
}
