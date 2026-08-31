import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { formatCost, spendSummary } from "../src/lib/agent/shared/model-cost";
import { boardPages, pagesInReadingOrder } from "../src/lib/pages/board-pages";
import { planRead } from "../src/lib/render/plan-read";
import { pageRenderPlan } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import { designPage } from "../src/server/agents/designer/design";
import { closeDb, db } from "../src/server/db";
import { readObject } from "../src/server/google/storage";
import { generateContent, generateContentStream, functionCallsIn } from "../src/server/google/vertex";
import { RENDER_SOURCE_BYTE_LIMIT, renderForModel } from "../src/server/render/for-model";

config({ path: ".env.local" });
config({ path: ".env" });

const ASKS = [
  {
    name: "welcome-sign",
    intention:
      "a welcome sign for Amara and Ines's wedding, to stand at the door — their names large, the date and the venue under them, and room around it all",
  },
  {
    name: "banner",
    intention:
      "a wide banner for the studio's spring portrait sessions — one photograph, a headline that fits on one line, and somewhere to click at the end of it",
  },
  {
    name: "photo-spread",
    intention:
      "an album spread of three photographs from this project, one large and two smaller beside it, with a caption under the big one",
  },
] as const;

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

const boardWanted = valueOf("--board");
const projectWanted = valueOf("--project");
const only = valueOf("--only");
const out = valueOf("--out") ?? ".design-fixtures";

const asks = only ? ASKS.filter(({ name }) => name === only) : ASKS;
if (!asks.length) {
  console.error(`no fixture called ${only} — the set is ${ASKS.map(({ name }) => name).join(", ")}`);
  process.exit(1);
}

const seconds = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`;
const percent = (share: number) => `${(share * 100).toFixed(0)}%`;

function said(call: { name: string; args?: Record<string, unknown> | null }) {
  const asked = call.args?.skills;
  if (call.name !== "get_skills" || !Array.isArray(asked)) return call.name;
  return `${call.name}(${asked.join(",")})`;
}

const BOARD_SCENE_SELECT = {
  projectId: true,
  revision: true,
  elements: true,
  appState: true,
} as const;

const pageIdsOf = (elements: unknown) =>
  new Set(boardPages(persistableElements(elements)).map(({ id }) => id));

type Drawn = {
  file: string;
  shape: string;
  landed: string;
  ink: number;
  bands: string;
  framed: string;
  typed: string;
  read: string;
};
type Result = {
  name: string;
  rounds: number;
  line: string;
  costMicros: number | null;
  pages: Drawn[];
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

  mkdirSync(out, { recursive: true });
  console.log(
    `project ${board.projectId}\nboard "${board.title || "untitled"}" ${board.id} @${board.revision}\n${asks.length} ask${asks.length === 1 ? "" : "s"} → ${out}/`,
  );

  const results: Result[] = [];

  for (const ask of asks) {
    console.log(`\n${"═".repeat(70)}\n${ask.name}: ${ask.intention}`);

    const before = pageIdsOf(
      (await db.moodboard.findUniqueOrThrow({ where: { id: board.id }, select: { elements: true } }))
        .elements,
    );

    let rounds = 0;
    const watched: typeof generateContentStream = async (model, contents, options) => {
      rounds += 1;
      const parts = contents.flatMap(({ parts }) => parts);
      const pictures = parts.filter((part) => part.fileData || part.inlineData).length;
      const started = Date.now();
      const answer = await generateContent(model, contents, options);
      const calls = functionCallsIn(answer.candidates?.[0]?.content?.parts ?? []);
      console.log(
        `  round ${rounds}  ${pictures} picture${pictures === 1 ? "" : "s"} carried  (${seconds(started)})  ${calls.map(said).join(" ") || "answered"}`,
      );
      return answer;
    };

    const started = Date.now();
    const outcome = await designPage({
      db,
      projectId: board.projectId,
      boardId: board.id,
      intention: ask.intention,
      newPage: true,
      generate: watched,
      render: renderForModel,
    });

    if (!("line" in outcome)) {
      console.log(`  refused: ${outcome.error}`);
      results.push({ name: ask.name, rounds, line: `refused: ${outcome.error}`, costMicros: 0, pages: [] });
      continue;
    }

    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: outcome.runId },
      select: { model: true, promptTokens: true, outputTokens: true, totalTokens: true, agent: true, output: true },
    });
    const spend = spendSummary([run]);

    console.log(`  line: ${outcome.line}`);
    console.log(`  called: ${outcome.calls.join(", ") || "nothing"}${outcome.stopped ? `  (stopped: ${outcome.stopped})` : ""}`);
    console.log(`  run ${outcome.runId} (${seconds(started)}): ${JSON.stringify(run.output)}  ${formatCost(spend.total.costMicros)}`);

    const result: Result = {
      name: ask.name,
      rounds,
      line: outcome.line,
      costMicros: spend.total.costMicros,
      pages: [],
    };
    results.push(result);

    const after = await db.moodboard.findUniqueOrThrow({
      where: { id: board.id },
      select: BOARD_SCENE_SELECT,
    });
    const elements = persistableElements(after.elements);
    const pages = pagesInReadingOrder(boardPages(elements));
    const made = outcome.pageId
      ? pages.filter(({ id }) => id === outcome.pageId)
      : pages.filter(({ id }) => !before.has(id));

    if (!made.length) {
      console.log("  no page — the design ended without one on the board");
      continue;
    }

    for (const [at, page] of made.entries()) {
      const drawn = await renderForModel({ boardId: board.id, pageId: page.id, scene: after });
      if ("failed" in drawn) {
        console.log(`  page ${page.id} not drawn: ${drawn.reason}`);
        continue;
      }

      const stem = made.length > 1 ? `${ask.name}-${at + 1}` : ask.name;
      const file = join(out, `${stem}@${drawn.revision}.png`);
      writeFileSync(file, await readObject(drawn.uri, RENDER_SOURCE_BYTE_LIMIT));

      const read = planRead(
        pageRenderPlan(elements, page, {
          background: (after.appState as { viewBackgroundColor?: unknown } | null)
            ?.viewBackgroundColor,
        }),
      );

      result.pages.push({
        file,
        shape: read.shape,
        landed: read.landed,
        ink: read.ink,
        bands: read.standing,
        framed: read.framed,
        typed: read.typed,
        read: read.read,
      });
      console.log(
        `  page ${page.id}${page.name ? ` "${page.name}"` : ""} @${drawn.revision} ${drawn.drawn}: ${read.shape}, ${read.landed}, ${percent(read.ink)} of the page inked${drawn.undrawn.length ? `, not drawn: ${drawn.undrawn.map(({ type }) => type).join(", ")}` : ""}`,
      );
      console.log(`  stands on ${read.standing}`);
      if (read.framed) console.log(`  ${read.framed}`);
      if (read.typed) console.log(`  ${read.typed}`);
      if (read.read) console.log(`  ${read.read}`);
      console.log(`  ${file}`);
    }
  }

  console.log(`\n${"═".repeat(70)}\nlook at these before raising anything:`);
  console.log(
    ["ask".padEnd(14), "rounds".padStart(7), "cost".padStart(8), "page".padStart(10), "ink".padStart(5), "stands on"].join(" "),
  );
  for (const result of results) {
    if (!result.pages.length) {
      console.log([result.name.padEnd(14), String(result.rounds).padStart(7), formatCost(result.costMicros).padStart(8), "—".padStart(10), "—".padStart(5), result.line].join(" "));
      continue;
    }
    for (const [at, page] of result.pages.entries()) {
      console.log(
        [
          (at ? "" : result.name).padEnd(14),
          (at ? "" : String(result.rounds)).padStart(7),
          (at ? "" : formatCost(result.costMicros)).padStart(8),
          page.shape.padStart(10),
          percent(page.ink).padStart(5),
          `${page.bands}${page.framed ? `\n${"".padEnd(48)}${page.framed}` : ""}${page.typed ? `\n${"".padEnd(48)}${page.typed}` : ""}\n${"".padEnd(48)}${page.landed}  ${page.file}`,
        ].join(" "),
      );
    }
  }
  const totalMicros = results.reduce<number | null>(
    (sum, { costMicros }) => (sum === null || costMicros === null ? null : sum + costMicros),
    0,
  );
  console.log(`\n${formatCost(totalMicros)} for ${results.length} design${results.length === 1 ? "" : "s"}`);
} finally {
  await closeDb();
}
