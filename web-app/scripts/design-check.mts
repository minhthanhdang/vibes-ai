/// One real `design_page` call, against Vertex, from the command line.
/// `npm run design:check`.
///
///   npm run design:check -- --board <boardId> "a wedding welcome sign, calligraphic"
///   npm run design:check -- --board <boardId> --page <pageId> --images a,b "tighten this"
///
/// Agent 8 was built with the model call injected — every round of every test in
/// `src/server/agents/designer/` hands `designPage` a `generate` that answers
/// from a script. That is what made twenty-seven iterations of it cost nothing,
/// and it is also the reason nothing here has ever been read by a model: a fake
/// answers with the tool names the test wrote down, so a declaration a real
/// model cannot follow, an ask it reads the wrong way and a picture it cannot
/// see all look identical from inside the suite.
///
/// This is the other half, the way `npm run smoke` is the other half of agent 6:
/// the deliberate call. It runs `designPage` — the same function `design_page`
/// runs behind agent 6's door — and prints the loop from the outside: what each
/// round sent, how many pictures rode on it, what the model asked for, what the
/// bucket was asked to draw, and what the whole thing came to on the
/// `AgentKind.DESIGNER` row it just wrote.
///
/// It writes to a real board, because that is what agent 8 does. With no
/// `--page` it asks for a fresh one (§VI's `newPage`), so the work lands beside
/// what is already on the board rather than on top of it.

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
import { generateContent, functionCallsIn, textOf, type Content } from "../src/server/google/vertex";

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

/// `--page-box 1920x640`: make the page here, at that shape, and hand the design
/// a frame it did not choose.
///
/// The question it exists for is §VIII's, one step past where the margin read
/// left it. Every page agent 8 has ever made on this database is 1920x1080 or
/// 1080x1920 — twenty-three of them, no other shape — and each one carries its
/// work in a strip with a quarter to two fifths of the frame dead at each end.
/// Two readings fit that: the design chooses a frame too large for the work and
/// then centres correctly in it, or it under-fills whatever frame it is in. A
/// run on a page somebody else sized separates them, and neither the fixture set
/// (which always asks for a fresh page) nor `--page` (which can only name a page
/// that already exists, and all of them are the two shapes) could put the
/// question.
///
/// What it answered, the first time it was put: the banner ask on a 1920x640
/// page came back at 64% ink and 59% / 75% / 59%, with no margin over the floor
/// on any edge, against 22% and 7% / 53% / 7% with 28% dead top and bottom on
/// the 1920x1080 page the same ask chose for itself. The design fills a frame
/// somebody else sized. The flaw is the frame it writes (`plan-read.ts`).
const pageBoxWanted = valueOf("--page-box");

/// A `<width>x<height>` in scene pixels, or null. Rejected rather than rounded
/// into something: a mistyped box is a page nobody meant to make, on a real
/// board, and the design that follows is measured against it.
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
/// Off unless asked for: this script is read in a terminal and the band read
/// below is the part of the picture worth a line. `--out` is for the run
/// somebody means to compare against a fixture PNG by eye.
const out = valueOf("--out");

/// Everything that is not a flag or a flag's value is the intention, joined —
/// so a quoted sentence and a bare one both arrive as the user's own words,
/// which is the one argument agent 8 cannot read off the board.
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

/// What a request carries, read off the parts rather than off the loop: the
/// window is the dominant cost lever (§III.1) and the only honest reading of it
/// is the body that really went up.
function sent(contents: Content[]) {
  const parts = contents.flatMap(({ parts }) => parts);
  const pictures = parts.filter((part) => part.fileData || part.inlineData).length;
  const dropped = parts.filter(
    (part) => typeof part.text === "string" && part.text.startsWith("[The picture"),
  ).length;
  return { contents: contents.length, pictures, dropped };
}

/// The shape of the body, one letter per turn and one letter per part. Vertex
/// refuses a request whose last turn is the model's, and a loop that builds its
/// transcript out of two windows and a pinned slice can produce that shape from
/// code that reads correctly — so the shape goes in the log rather than being
/// reconstructed from the error afterwards.
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

/// Wide enough for the boxes. An intention or a closing line is prose and the
/// first clause of it is enough to know which one it is; an argument is
/// geometry, and a `put_on_canvas` truncated before its box is the one thing
/// this script exists to show, said in a way that reads as if it were not
/// there. Two designs were run against the real model before anybody noticed
/// the page box was being cut off at 45 characters rather than left out.
///
/// Raised from 200 to 900 for the same reason it was raised from 45: one page
/// box fits in 200 characters and a `put_on_canvas` of four lines does not, so
/// the run that put a welcome sign's whole type stack on the board printed the
/// first box and hid the other three — and the box that was hidden is the one
/// the door clamped (`render/plan-read.ts`). A put is the widest argument this
/// agent sends and the number is set by that call rather than by the terminal.
const shortly = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 900 ? `${text.slice(0, 897)}…` : text;
};

const named = ({ name, args }: { name: string; args?: Record<string, unknown> }) =>
  `${name}(${Object.entries(args ?? {})
    .map(([key, value]) => `${key}=${shortly(value)}`)
    .join(", ")})`;

let round = 0;

/// The two injected seams, wrapped rather than replaced — everything below runs
/// for real and the wrapper only watches.
const watchedGenerate: typeof generateContent = async (model, contents, options) => {
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

  /// The page `--page-box` asked for, made before the design and through the
  /// same door agent 8 makes one through — `put_on_canvas` with `kind: "page"`
  /// and a box, run by the shared canvas toolset, guarded on the revision it
  /// read. A page written straight into the scene from here would be a page no
  /// tool has ever produced, and the run measured against it would be measuring
  /// this script.
  ///
  /// Placed clear of everything the board already carries, for the reason the
  /// fresh-page path is the default: a run leaves its work beside what is there
  /// rather than on top of it.
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

  /// The pages the board already had. `design_page` answers with a pageId only
  /// when agent 6 named one — a design on a fresh page makes the page itself
  /// with `put_on_canvas` and the id of it is on the board (`tools.ts`) — so
  /// the page this ask produced is the one that was not there a moment ago.
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

  /// Read back off the row rather than off the outcome, because the row is what
  /// anybody looking at this design tomorrow will have — a design whose
  /// `renders` say `made` twelve times is one that redrew the board every round
  /// (§VIII), and that is only visible here.
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

  /// What the ask actually produced, measured rather than described. The closing
  /// line is the design's own account of its page and it has been wrong about
  /// one — "generous margins and breathing room" about a page that was 88%
  /// white (§VIII) — so the run prints the arithmetic beside the line. Read
  /// after the design rather than during it: a plan taken mid-loop is a page
  /// halfway through being written.
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
