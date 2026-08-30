/// A whole "Let's Vibes" run, for real, from the command line.
/// `npm run vibes:run`.
///
///   npm run vibes:run -- --project <projectId> --pages 6 "a menu for the supper club"
///   npm run vibes:run -- --project <projectId> --pages 2 --designs 2 "a menu"
///   npm run vibes:run -- --board <boardId> --resume
///
/// compositor-v2.md §IX's verification is the one in this repo that no assertion
/// can stand in for: six pages that each read well on their own and do not
/// belong beside each other is a failed run, and coherence has no number. The
/// suite covers the brief, the intention, the queue's arithmetic and the resume,
/// every one of them with the model call injected — so the one thing never
/// exercised end to end is the run itself, which is the product's headline
/// action and the most expensive click in it.
///
/// This is that run, driven through the procedures the browser calls rather
/// than through the modules under them. `vibes.startBatch` (or `vibes.resume`)
/// files the chain heads exactly as the app does — ownership checks and the
/// stored brief all the product's own; `--designs 2` asks
/// for two takes of the one brief, which is the take clause's own proof run
/// (§II.3) — and then this script *is*
/// the worker (multi-vibes-and-preview-prd §II.8): it claims and runs the jobs
/// through the same `claimVibesRun`/`runClaimedVibesJob` the endpoint drains,
/// which makes it the integration test for the claim, the chain and the settle.
/// Kill it mid-run and `--resume` picks the board up, which is the queue's own
/// promise being exercised.
///
/// Every page is drawn afterwards and written out to look at, the way
/// `npm run design:fixtures` writes its three. The pictures are an operator
/// looking at their own bucket from their own machine (§III) — nothing agent 8
/// draws is ever shown to a user and this does not change that.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { formatCost, spendSummary } from "../src/lib/agent/shared/model-cost";
import { boardPages, pagesInReadingOrder } from "../src/lib/pages/board-pages";
import { planRead } from "../src/lib/render/plan-read";
import { pageRenderPlan } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import {
  VIBES_DESIGN_LIMIT,
  VIBES_PAGE_LIMIT,
  storedBrief,
  vibesBrief,
  vibesIntention,
  type VibesBrief,
} from "../src/lib/vibes/vibes-brief";
import { vibesDraft, vibesRefusals, type VibesDraft } from "../src/lib/vibes/vibes-form";
import { vibesResumeOffer } from "../src/lib/vibes/vibes-resume";
import { vibesJob } from "../src/lib/vibes/vibes-queue";
import { createCallerFactory } from "../src/server/api/trpc";
import { vibesRouter } from "../src/server/api/routers/vibes";
import { designerReferences } from "../src/server/agents/designer/references";
import {
  claimVibesRun,
  runClaimedVibesJob,
  type VibesWorkerDeps,
} from "../src/server/agents/vibes/vibes-worker";
import { runVibesPage, type VibesOutcome } from "../src/server/agents/vibes/run-vibes-page";
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

const FLAGS = [
  "--project",
  "--board",
  "--pages",
  "--designs",
  "--size",
  "--palette",
  "--vibes",
  "--out",
];
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
  'usage: npm run vibes:run -- [--project <id>] [--pages N] [--designs N] [--size 1920x1080] [--palette #hex,#hex] [--vibes "..."] [--out <dir>] "<what the board is for>"\n       npm run vibes:run -- --board <id> --resume';

/// `--board` on its own is a resume: the brief is on the board already (§IX.2),
/// so a run picked up from here files the same chain head the panel's offer
/// card files and the worker walks the same pending pages.
const resuming = Boolean(boardWanted);
if (!resuming && !purpose) {
  console.error(usage);
  process.exit(1);
}

const sizeWanted = valueOf("--size");
const sizeMatch = sizeWanted?.match(/^(\d+)x(\d+)$/);
const size = sizeMatch ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) } : undefined;
if (sizeWanted && !size) {
  console.error(`--size takes width x height in pixels, like 1920x1080 — not ${sizeWanted}`);
  process.exit(1);
}

const pagesWanted = valueOf("--pages");
const pages = pagesWanted === undefined ? undefined : Number(pagesWanted);
if (pagesWanted !== undefined && !Number.isInteger(pages)) {
  console.error(`--pages takes a whole number of pages, one to ${VIBES_PAGE_LIMIT}`);
  process.exit(1);
}

/// Takes of the one brief, a board each (§II.3). One is the old run exactly;
/// two is the cheapest look at whether the take clause produces distinct
/// boards or a hedge, which the PRD asks to be eyeballed rather than asserted.
const designsWanted = valueOf("--designs");
const designs = designsWanted === undefined ? 1 : Number(designsWanted);
if (!Number.isInteger(designs) || designs < 1 || designs > VIBES_DESIGN_LIMIT) {
  console.error(`--designs takes a whole number of takes, one to ${VIBES_DESIGN_LIMIT}`);
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
    ...(size && size),
    ...(valueOf("--palette") && {
      palette: (valueOf("--palette") ?? "").split(",").map((colour) => colour.trim()),
    }),
    ...(valueOf("--vibes") && { vibes: valueOf("--vibes") ?? "" }),
  };

  let boardIds: string[];
  let brief: VibesBrief;

  if (board) {
    const run = await vibes.offer({ boardId: board.id });
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
    boardIds = [run.boardId];
    brief = stored;
    /// The mutation the offer card presses: the first blank page goes back on
    /// the queue, and the drain below is what walks the chain from there. A
    /// CONFLICT is not a failure here — a drain killed mid-run leaves the
    /// chain head live on the queue, and picking that up is exactly what this
    /// path exists to prove (multi-vibes-and-preview-prd Part IV, stage 3).
    /// One caveat when it was killed mid-*page*: that row's lease has to
    /// expire (15 minutes) before the claim below may take it.
    try {
      await vibes.resume({ boardId: run.boardId });
    } catch (refused) {
      if (!(refused instanceof Error) || !refused.message.includes("still going")) throw refused;
      console.log("the chain is still on the queue — draining it");
    }
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

    /// `startBatch` files each board's page-1 job in the same transaction as
    /// that board; its own kick cannot fire here (`after()` wants a request),
    /// which is exactly right — this script is the worker. One form, `designs`
    /// takes: the single-design call is the old `start` exactly.
    const { boards } = await vibes.startBatch({
      projectId: project.id,
      forms: [{ ...draft, designs }],
    });
    boardIds = boards.map(({ boardId }) => boardId);
    brief = asked;
    for (const made of boards) {
      console.log(
        `board "${made.title}" ${made.boardId}${designs > 1 ? ` — take ${made.designIndex + 1} of ${designs}` : ""} — ${asked.pages} ${asked.width}×${asked.height} page${asked.pages === 1 ? "" : "s"} in ${asked.palette.join(", ")}`,
      );
    }
  }

  /// What the model is about to be asked, rebuilt through the same pure
  /// function the worker calls with the same arguments (§IX.3). Printed
  /// rather than inferred from the answer: the coherence clause for page 2 and
  /// after is the whole of what makes six pages a set, it is a request and not
  /// a mechanism, and this is the only place anybody ever sees it.
  if (showIntentions) {
    const { all } = await designerReferences({ db, projectId: project.id })();
    for (let index = 0; index < brief.pages; index++) {
      console.log(`\n${"─".repeat(70)}\nintention, page ${index + 1}:`);
      console.log(vibesIntention({ brief, index, pictures: all }));
    }
  }

  /// The worker, run in this process: claim, design, settle, chain — until a
  /// claim comes up empty, which is the chain ended (its last page settled, or
  /// a refusal declined to extend it). One caveat worth a line: the claim
  /// takes the oldest runnable `VIBES` job on the whole database, not this
  /// board's — on a shared dev database this drains whatever is queued, which
  /// is what a worker does.
  const designed: Designed[] = [];
  /// The worker calls `runPage` from inside `runClaimedVibesJob`; overhearing
  /// the outcomes here is how the script prices each page without changing
  /// the worker's own signature. Keyed by page: a job the worker settled
  /// without a model call — already designed, or failed before the design —
  /// has no entry, and the ticket row is its whole account.
  const answers = new Map<string, VibesOutcome>();
  const deps: VibesWorkerDeps = {
    db,
    runPage: async (job) => {
      const outcome = await runVibesPage({ db, ...job });
      answers.set(job.pageId, outcome);
      return outcome;
    },
  };

  for (;;) {
    const claimed = await claimVibesRun(deps);
    if (!claimed) break;
    const job = vibesJob(claimed.input);
    console.log(
      `\n${"═".repeat(70)}\npage ${job ? job.index + 1 : "?"} of ${brief.pages} — job ${claimed.id}`,
    );

    const startedAt = Date.now();
    const settled = await runClaimedVibesJob(deps, claimed);

    /// The settle read back off the ticket itself rather than trusted from
    /// memory — the row is what the panel's progress query reads, so printing
    /// it is printing what the user would see.
    const ticket = await db.agentRun.findUniqueOrThrow({
      where: { id: settled.id },
      select: { status: true, output: true, error: true },
    });
    console.log(
      `  settle: ${ticket.status} ${JSON.stringify(ticket.output ?? ticket.error)} (${seconds(startedAt)}${settled.chained ? ", next page queued" : ""})`,
    );

    if (!job) continue;
    const outcome = answers.get(job.pageId);
    if (!outcome) {
      /// No page ran: an already-designed reclaim settled without a model
      /// call, or a structural failure threw before the design. Either way
      /// the row above said so; there is nothing to price.
      designed.push({
        index: job.index,
        pageId: job.pageId,
        line:
          ticket.status === "FAILED"
            ? `failed: ${ticket.error ?? "no reason recorded"}`
            : "already designed — settled without a model call",
        calls: [],
        runId: null,
        costMicros: 0,
        elapsed: seconds(startedAt),
      });
      continue;
    }

    if ("error" in outcome) {
      console.log(`  refused: ${outcome.error}`);
      designed.push({
        index: job.index,
        pageId: job.pageId,
        line: `refused: ${outcome.error}`,
        calls: [],
        runId: null,
        costMicros: 0,
        elapsed: seconds(startedAt),
      });
      continue;
    }

    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: outcome.runId },
      select: { model: true, agent: true, promptTokens: true, outputTokens: true, totalTokens: true, output: true },
    });
    const spend = spendSummary([run]);
    /// A design that ran out of rounds answers with a line and leaves the page
    /// blank; the worker reads the scene and says so, and the run's count is
    /// what the board holds rather than what came back (§IX.5).
    if (outcome.empty) console.log("  empty: nothing was placed on the page");
    console.log(`  line: ${outcome.line}`);
    console.log(`  called: ${outcome.calls.join(", ") || "nothing"}`);
    console.log(
      `  run ${outcome.runId} (${seconds(startedAt)}): ${JSON.stringify(run.output)}  ${formatCost(spend.total.costMicros)}`,
    );

    designed.push({
      index: job.index,
      pageId: job.pageId,
      line: outcome.line,
      calls: outcome.calls,
      runId: outcome.runId,
      costMicros: spend.total.costMicros,
      elapsed: seconds(startedAt),
    });
  }

  /// Each board as the run left it, read once. Every page is drawn from that
  /// one scene rather than page by page as the walk went, because a render
  /// taken mid-run is a board halfway through being written — and the question
  /// this script exists for is about the set, not about any one page. With
  /// `--designs 2` this is where the takes sit side by side to be eyeballed
  /// (§II.3's flag: distinct directions, or a hedge twice).
  for (const [take, boardId] of boardIds.entries()) {
    const after = await db.moodboard.findUniqueOrThrow({
      where: { id: boardId },
      select: { title: true, projectId: true, revision: true, elements: true, appState: true },
    });
    const elements = persistableElements(after.elements);
    const drawnPages = pagesInReadingOrder(boardPages(elements));
    /// A file per page per board — the take's number in the name when there is
    /// more than one, so two takes of page 1 do not overwrite each other.
    const prefix = boardIds.length > 1 ? `board-${take + 1}-` : "";

    console.log(
      `\n${"═".repeat(70)}\n"${after.title}" in reading order — look at these before raising anything (§IX):`,
    );
    for (const [order, page] of drawnPages.entries()) {
      const at = order + 1;
      const drawn = await renderForModel({ boardId, pageId: page.id, scene: after });
      if ("failed" in drawn) {
        console.log(`page ${at} ${page.id} not drawn: ${drawn.reason}`);
        continue;
      }
      const file = join(out, `${prefix}page-${String(at).padStart(2, "0")}@${drawn.revision}.png`);
      writeFileSync(file, await readObject(drawn.uri, RENDER_SOURCE_BYTE_LIMIT));

      const read = planRead(
        pageRenderPlan(elements, page, {
          background: (after.appState as { viewBackgroundColor?: unknown } | null)
            ?.viewBackgroundColor,
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
    /// walked every page and still reports pages pending is a page that came
    /// back with a line and nothing on it, which no assertion in the suite can
    /// catch because the suite never lets a real model answer.
    const left = await vibes.offer({ boardId });
    const offer = left && vibesResumeOffer(left.pages);
    console.log(
      `${offer ? `${offer.label} — ${offer.action}` : "every page of this run is designed"} — board ${boardId} @${after.revision}`,
    );
  }

  const totalMicros = designed.reduce<number | null>(
    (sum, { costMicros }) => (sum === null || costMicros === null ? null : sum + costMicros),
    0,
  );
  console.log(
    `\n${formatCost(totalMicros)} for ${designed.length} design${designed.length === 1 ? "" : "s"} across ${boardIds.length} board${boardIds.length === 1 ? "" : "s"}`,
  );
} finally {
  await closeDb();
}
