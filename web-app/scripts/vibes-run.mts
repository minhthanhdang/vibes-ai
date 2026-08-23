/// A whole "Let's Vibes" run, for real, from the command line.
/// `npm run vibes:run`.
///
///   npm run vibes:run -- --project <projectId> --pages 6 "a menu for the supper club"
///   npm run vibes:run -- --board <boardId> --resume
///
/// compositor-v2.md §IX's verification is the one in this repo that no assertion
/// can stand in for: six pages that each read well on their own and do not
/// belong beside each other is a failed run, and coherence has no number. The
/// suite covers the brief, the intention, the loop's arithmetic and the resume,
/// every one of them with the model call injected — so the one thing never
/// exercised end to end is the run itself, which is the product's headline
/// action and the most expensive click in it.
///
/// This is that run, driven through the procedures the browser calls rather
/// than through the modules under them. `vibes.start`, then `vibes.designPage`
/// once per page in reading order, then `vibes.resume` — a caller over
/// `vibesRouter` with a real user in the context, so the ownership checks, the
/// stored brief, the chat rows and the page grounds are all the product's own
/// and not this script's re-enactment of them. The browser's loop
/// (`vibes-loop.ts`) is the only thing here that is re-implemented, because it
/// is a React component; what it does is a `for` loop that stops on a refusal,
/// and that is what this does.
///
/// Every page is drawn afterwards and written out to look at, the way
/// `npm run design:fixtures` writes its three. The pictures are an operator
/// looking at their own bucket from their own machine (§III) — nothing agent 8
/// draws is ever shown to a user and this does not change that.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { formatCost, spendSummary } from "../src/lib/agent/model-cost";
import { PAGE_PRESET_IDS } from "../src/lib/layout/moodboard-layouts";
import { boardPages, pagesInReadingOrder } from "../src/lib/pages/board-pages";
import { planRead } from "../src/lib/render/plan-read";
import { pageRenderPlan } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import {
  VIBES_PAGE_LIMIT,
  storedBrief,
  themeColour,
  vibesBrief,
  vibesIntention,
  type VibesBrief,
} from "../src/lib/vibes/vibes-brief";
import { vibesDraft, vibesRefusals, type VibesDraft } from "../src/lib/vibes/vibes-form";
import { vibesResumeOffer } from "../src/lib/vibes/vibes-resume";
import { createCallerFactory } from "../src/server/api/trpc";
import { vibesRouter } from "../src/server/api/routers/vibes";
import { designerReferences } from "../src/server/agents/designer/references";
import { closeDb, db } from "../src/server/db";
import { readObject } from "../src/server/google/storage";
import { RENDER_SOURCE_BYTE_LIMIT, renderForModel } from "../src/server/render/for-model";

config({ path: ".env.local" });
config({ path: ".env" });

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

const FLAGS = ["--project", "--board", "--pages", "--preset", "--palette", "--vibes", "--out"];
const projectWanted = valueOf("--project");
const boardWanted = valueOf("--board");
const out = valueOf("--out") ?? ".vibes-run";
const showIntentions = argv.includes("--intentions");

/// Everything that is not a flag or a flag's value is the purpose, joined — the
/// field the form puts first and the only one a run cannot be started without.
const purpose = argv
  .filter((word, at) => !word.startsWith("--") && !FLAGS.includes(argv[at - 1] ?? ""))
  .join(" ")
  .trim();

const usage =
  'usage: npm run vibes:run -- [--project <id>] [--pages N] [--preset LANDSCAPE_HD] [--palette #hex,#hex] [--vibes "..."] [--out <dir>] "<what the board is for>"\n       npm run vibes:run -- --board <id> --resume';

/// `--board` on its own is a resume: the brief is on the board already (§IX.2),
/// so a run picked up from here reads the same answer the panel's offer card
/// reads and walks the same pending pages.
const resuming = Boolean(boardWanted);
if (!resuming && !purpose) {
  console.error(usage);
  process.exit(1);
}

const presetWanted = valueOf("--preset");
const preset = PAGE_PRESET_IDS.find((id) => id === presetWanted);
if (presetWanted && !preset) {
  console.error(`--preset is one of ${PAGE_PRESET_IDS.join(", ")} — not ${presetWanted}`);
  process.exit(1);
}

const pagesWanted = valueOf("--pages");
const pages = pagesWanted === undefined ? undefined : Number(pagesWanted);
if (pagesWanted !== undefined && !Number.isInteger(pages)) {
  console.error(`--pages takes a whole number of pages, one to ${VIBES_PAGE_LIMIT}`);
  process.exit(1);
}

const seconds = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`;
const percent = (share: number) => `${(share * 100).toFixed(0)}%`;

type Designed = {
  index: number;
  pageId: string;
  line: string;
  calls: string[];
  runId: string | null;
  costMicros: number | null;
  elapsed: string;
};

try {
  /// The project, and the user it belongs to. The procedures below are
  /// `protectedProcedure`s and every one of them scopes its read by
  /// `project: { userId }` — so a context with a real user is the only way to
  /// run the product's own path rather than a version of it with the ownership
  /// checks taken out.
  const board = boardWanted
    ? await db.moodboard.findUnique({
        where: { id: boardWanted },
        select: { id: true, projectId: true, title: true },
      })
    : null;
  if (boardWanted && !board) {
    console.error(`no board ${boardWanted} on this database`);
    process.exit(1);
  }

  const project = await db.project.findFirst({
    where: { ...(board ? { id: board.projectId } : projectWanted ? { id: projectWanted } : {}) },
    select: { id: true, title: true, userId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!project) {
    console.error("no project on this database — make one in the app first");
    process.exit(1);
  }

  const user = await db.user.findUniqueOrThrow({
    where: { id: project.userId },
    select: { id: true, email: true, name: true, imageUrl: true },
  });

  const vibes = createCallerFactory(vibesRouter)({ db, headers: new Headers(), user });

  console.log(`project "${project.title || "untitled"}" ${project.id} — ${user.email}`);
  mkdirSync(out, { recursive: true });

  /// The form's own opening draft, seeded from the project's photographs the
  /// way the form seeds it — agent 2's palettes, merged and cut to five. A
  /// script that made its own colours up would be measuring a brief no user can
  /// type; the flags below are the fields somebody would have edited.
  const analyses = await db.analysis.findMany({
    where: { reference: { projectId: project.id } },
    select: { colorPalette: true },
  });
  const draft: VibesDraft = {
    ...vibesDraft({ palettes: analyses.map(({ colorPalette }) => colorPalette) }),
    purpose,
    ...(pages !== undefined && { pages }),
    ...(preset && { preset }),
    ...(valueOf("--palette") && {
      palette: (valueOf("--palette") ?? "").split(",").map((colour) => colour.trim()),
    }),
    ...(valueOf("--vibes") && { vibes: valueOf("--vibes") ?? "" }),
  };

  let boardId: string;
  let brief: VibesBrief;
  let walking: { pageId: string; index: number }[];

  if (board) {
    const run = await vibes.resume({ boardId: board.id });
    if (!run) {
      console.error(`board ${board.id} was not started from a Vibes brief — nothing to resume`);
      process.exit(1);
    }
    /// The brief off the board and not off the flags: a resumed run is the run
    /// that was started, and the whole reason `Moodboard.vibesBrief` is a
    /// column is that the tab it was typed in has closed (§IX.2).
    const stored = storedBrief(
      (
        await db.moodboard.findUniqueOrThrow({
          where: { id: run.boardId },
          select: { vibesBrief: true },
        })
      ).vibesBrief,
    );
    if (!stored) {
      console.error(`board ${run.boardId} has no readable brief on it`);
      process.exit(1);
    }
    const offer = vibesResumeOffer(run.pages);
    console.log(`board "${run.title || "untitled"}" ${run.boardId}: ${stored.purpose}`);
    if (!offer) {
      console.log("every page of this run is designed — nothing to pick up");
      process.exit(0);
    }
    console.log(`${offer.label} — ${offer.action}`);
    boardId = run.boardId;
    brief = stored;
    walking = run.pending.map(({ pageId, index }) => ({ pageId, index }));
  } else {
    /// The refusals said out loud, because they are the messages the form shows
    /// beside its fields — a run refused here is refused for a reason a user
    /// would have seen before spending anything.
    const refusals = vibesRefusals(draft);
    const asked = vibesBrief(draft);
    if (!asked) {
      for (const [field, why] of Object.entries(refusals)) console.error(`${field}: ${why}`);
      process.exit(1);
    }

    const started = await vibes.start({ projectId: project.id, ...draft });
    boardId = started.boardId;
    brief = asked;
    walking = started.pageIds.map((pageId, index) => ({ pageId, index }));
    console.log(
      `board "${started.title}" ${started.boardId} — ${walking.length} ${asked.preset} page${walking.length === 1 ? "" : "s"} standing on ${themeColour(asked)}`,
    );
  }

  /// What the model is about to be asked, rebuilt through the same pure
  /// function the mutation calls with the same arguments (§IX.3). Printed
  /// rather than inferred from the answer: the coherence clause for page 2 and
  /// after is the whole of what makes six pages a set, it is a request and not
  /// a mechanism, and this is the only place anybody ever sees it.
  if (showIntentions) {
    const { all } = await designerReferences({ db, projectId: project.id })();
    for (const { index } of walking) {
      console.log(`\n${"─".repeat(70)}\nintention, page ${index + 1}:`);
      console.log(vibesIntention({ brief, index, pictures: all }));
    }
  }

  const designed: Designed[] = [];
  for (const { pageId, index } of walking) {
    console.log(`\n${"═".repeat(70)}\npage ${index + 1} of ${brief.pages}`);
    const started = Date.now();
    const outcome = await vibes.designPage({ boardId, pageId, index });

    /// A refusal halts the run rather than skipping to the next page, which is
    /// what the browser's loop does (`vibes-loop.ts`) and for the same reason:
    /// whatever refused page four is almost always still true for page five,
    /// and the pages before it are kept either way.
    if ("error" in outcome) {
      console.log(`  refused: ${outcome.error}`);
      designed.push({
        index,
        pageId,
        line: `refused: ${outcome.error}`,
        calls: [],
        runId: null,
        costMicros: 0,
        elapsed: seconds(started),
      });
      break;
    }

    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: outcome.runId },
      select: { model: true, agent: true, promptTokens: true, outputTokens: true, totalTokens: true, output: true },
    });
    const spend = spendSummary([run]);
    /// A design that ran out of rounds answers with a line and leaves the page
    /// blank; the mutation reads the scene and says so, and the run's count is
    /// what the board holds rather than what came back (§IX.5).
    if (outcome.empty) console.log("  empty: nothing was placed on the page");
    console.log(`  line: ${outcome.line}`);
    console.log(`  called: ${outcome.calls.join(", ") || "nothing"}`);
    console.log(
      `  run ${outcome.runId} (${seconds(started)}): ${JSON.stringify(run.output)}  ${formatCost(spend.total.costMicros)}`,
    );

    designed.push({
      index,
      pageId,
      line: outcome.line,
      calls: outcome.calls,
      runId: outcome.runId,
      costMicros: spend.total.costMicros,
      elapsed: seconds(started),
    });
  }

  /// The board as the run left it, read once. Every page is drawn from this one
  /// scene rather than page by page as the walk went, because a render taken
  /// mid-run is a board halfway through being written — and the question this
  /// script exists for is about the set, not about any one page.
  const after = await db.moodboard.findUniqueOrThrow({
    where: { id: boardId },
    select: { projectId: true, revision: true, elements: true, appState: true },
  });
  const elements = persistableElements(after.elements);
  const drawnPages = pagesInReadingOrder(boardPages(elements));

  console.log(`\n${"═".repeat(70)}\nthe set, in reading order — look at these before raising anything (§IX):`);
  for (const [order, page] of drawnPages.entries()) {
    const at = order + 1;
    const drawn = await renderForModel({ boardId, pageId: page.id, scene: after });
    if ("failed" in drawn) {
      console.log(`page ${at} ${page.id} not drawn: ${drawn.reason}`);
      continue;
    }
    const file = join(out, `page-${String(at).padStart(2, "0")}@${drawn.revision}.png`);
    writeFileSync(file, await readObject(drawn.uri, RENDER_SOURCE_BYTE_LIMIT));

    const read = planRead(
      pageRenderPlan(elements, page, {
        background: (after.appState as { viewBackgroundColor?: unknown } | null)?.viewBackgroundColor,
      }),
    );
    console.log(
      `page ${at} ${page.id}${page.name ? ` "${page.name}"` : ""}: ${read.shape}, ${percent(read.ink)} inked, stands on ${read.standing}`,
    );
    if (read.framed) console.log(`  ${read.framed}`);
    if (read.typed) console.log(`  ${read.typed}`);
    /// §IX.5's palette bullet is eyeballed on this run, and the failure it
    /// spent three readings circling — two colours of the brief laid on each
    /// other — is the one thing on the page a picture at 1600px does not show.
    if (read.read) console.log(`  ${read.read}`);
    console.log(`  ${file}`);
  }

  /// Where the run got to, asked of the same door the panel asks — a run that
  /// walked every page and still reports pages pending is a page that came back
  /// with a line and nothing on it, which no assertion in the suite can catch
  /// because the suite never lets a real model answer.
  const left = await vibes.resume({ boardId });
  const offer = left && vibesResumeOffer(left.pages);
  console.log(`\n${offer ? `${offer.label} — ${offer.action}` : "every page of this run is designed"}`);

  const totalMicros = designed.reduce<number | null>(
    (sum, { costMicros }) => (sum === null || costMicros === null ? null : sum + costMicros),
    0,
  );
  console.log(
    `${formatCost(totalMicros)} for ${designed.length} design${designed.length === 1 ? "" : "s"} — board ${boardId} @${after.revision}`,
  );
} finally {
  await closeDb();
}
