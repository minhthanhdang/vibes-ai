/// The fixture set of asks compositor-v2.md §VIII calls for, run for real.
/// `npm run design:fixtures`.
///
///   npm run design:fixtures
///   npm run design:fixtures -- --board <boardId> --only banner
///
/// §VIII's second risk is the one nothing in the system answers: free placement
/// can make an ugly page, and agent 4's layout constants — which made a bad
/// arrangement impossible — are not here. The only guards are the skill, the
/// picture and the second look, and none of the three is assertable. So the
/// spec asks for a fixture set of asks — a welcome sign, a banner, a three-photo
/// spread — kept and eyeballed, and this is that set.
///
/// `npm run design:check` is one ask, typed at the moment somebody wants it;
/// this is the same three asks every time, which is what makes two runs
/// comparable. Each lands on a fresh page (§VI's `newPage`), so a run leaves its
/// pages beside whatever the board already held rather than on top of it, and
/// every page a design made is drawn afterwards and written out to look at.
///
/// The picture written here is an operator looking at their own bucket from
/// their own machine, the way `npm run render:check` and `npm run spend` are.
/// Nothing agent 8 draws is ever shown to a user (§III) and this does not
/// change that.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { formatCost, spendSummary } from "../src/lib/agent/model-cost";
import { boardPages, pagesInReadingOrder } from "../src/lib/pages/board-pages";
import { pageRenderPlan, type RenderDraw } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import { designPage } from "../src/server/agents/designer/design";
import { closeDb, db } from "../src/server/db";
import { readObject } from "../src/server/google/storage";
import { generateContent, functionCallsIn } from "../src/server/google/vertex";
import { RENDER_SOURCE_BYTE_LIMIT, renderForModel } from "../src/server/render/for-model";

config({ path: ".env.local" });
config({ path: ".env" });

/// §VIII's three, in its own order and in a director's own words — an ask is
/// the one argument agent 8 cannot read off the board, and a fixture set whose
/// asks read like tool arguments would exercise a model nobody has.
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

const BOARD_SCENE_SELECT = {
  projectId: true,
  revision: true,
  elements: true,
  appState: true,
} as const;

const pageIdsOf = (elements: unknown) =>
  new Set(boardPages(persistableElements(elements)).map(({ id }) => id));

/// What landed, by kind rather than by element: the eyeball is the verdict, and
/// this is what tells two run logs apart before anybody opens the pictures. An
/// outline is counted separately because §III.2 says it is a shape the model was
/// told about rather than one it saw.
function landed(draws: readonly RenderDraw[]) {
  const counted = new Map<string, number>();
  for (const draw of draws) counted.set(draw.kind, (counted.get(draw.kind) ?? 0) + 1);
  return [...counted].map(([kind, count]) => `${count} ${kind}`).join(", ") || "nothing";
}

type Drawn = { file: string; landed: string; ink: number };
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

    /// The pages the board already had, taken before the design rather than
    /// after: `design_page` answers with a pageId only when agent 6 named one,
    /// because a design on a fresh page made the page itself with
    /// `put_on_canvas` and the id of it is on the board (`tools.ts`). So the
    /// page this ask produced is the one that was not there a moment ago — and
    /// an ask that made two, as an album spread reasonably does, is two.
    const before = pageIdsOf(
      (await db.moodboard.findUniqueOrThrow({ where: { id: board.id }, select: { elements: true } }))
        .elements,
    );

    let rounds = 0;
    const watched: typeof generateContent = async (model, contents, options) => {
      rounds += 1;
      const parts = contents.flatMap(({ parts }) => parts);
      const pictures = parts.filter((part) => part.fileData || part.inlineData).length;
      const started = Date.now();
      const answer = await generateContent(model, contents, options);
      const calls = functionCallsIn(answer.candidates?.[0]?.content?.parts ?? []);
      console.log(
        `  round ${rounds}  ${pictures} picture${pictures === 1 ? "" : "s"} carried  (${seconds(started)})  ${calls.map(({ name }) => name).join(" ") || "answered"}`,
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

    /// Read after the design rather than during it: the scene the pictures are
    /// of is the one the design left behind, and a render taken mid-loop is a
    /// page halfway through being written.
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

      const plan = pageRenderPlan(elements, page, {
        background: (after.appState as { viewBackgroundColor?: unknown } | null)?.viewBackgroundColor,
      });

      /// The share of the page any element covers at all, counted on the boxes
      /// rather than on the pixels — boxes overlap, so this passes 100% on a
      /// stack. Not a verdict, and two pages can score the same and only one of
      /// them be lookable, but an empty page and a page with everything piled
      /// in one corner are both visible in one number and neither is visible in
      /// a list of draws.
      const ink =
        plan.draws.reduce((sum, draw) => sum + draw.box.width * draw.box.height, 0) /
        (plan.width * plan.height);

      result.pages.push({ file, landed: landed(plan.draws), ink });
      console.log(
        `  page ${page.id}${page.name ? ` "${page.name}"` : ""} @${drawn.revision} ${drawn.drawn}: ${landed(plan.draws)}, ${percent(ink)} of the page inked${drawn.undrawn.length ? `, not drawn: ${drawn.undrawn.map(({ type }) => type).join(", ")}` : ""}`,
      );
      console.log(`  ${file}`);
    }
  }

  console.log(`\n${"═".repeat(70)}\nlook at these before raising anything (§VIII):`);
  console.log(["ask".padEnd(14), "rounds".padStart(7), "cost".padStart(8), "ink".padStart(5), "what landed"].join(" "));
  for (const result of results) {
    if (!result.pages.length) {
      console.log([result.name.padEnd(14), String(result.rounds).padStart(7), formatCost(result.costMicros).padStart(8), "—".padStart(5), result.line].join(" "));
      continue;
    }
    for (const [at, page] of result.pages.entries()) {
      console.log(
        [
          (at ? "" : result.name).padEnd(14),
          (at ? "" : String(result.rounds)).padStart(7),
          (at ? "" : formatCost(result.costMicros)).padStart(8),
          percent(page.ink).padStart(5),
          `${page.landed}  ${page.file}`,
        ].join(" "),
      );
    }
  }
  /// Null-poisoned the way `spendSummary` itself is: a model with no price in
  /// the table makes the total unknown rather than makes it smaller.
  const totalMicros = results.reduce<number | null>(
    (sum, { costMicros }) => (sum === null || costMicros === null ? null : sum + costMicros),
    0,
  );
  console.log(`\n${formatCost(totalMicros)} for ${results.length} design${results.length === 1 ? "" : "s"}`);
} finally {
  await closeDb();
}
