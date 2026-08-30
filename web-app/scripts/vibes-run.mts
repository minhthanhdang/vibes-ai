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

const purpose = argv
  .filter((word, at) => !word.startsWith("--") && !FLAGS.includes(argv[at - 1] ?? ""))
  .join(" ")
  .trim();

const usage =
  'usage: npm run vibes:run -- [--project <id>] [--pages N] [--designs N] [--size 1920x1080] [--palette #hex,#hex] [--vibes "..."] [--out <dir>] "<what the board is for>"\n       npm run vibes:run -- --board <id> --resume';

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
    try {
      await vibes.resume({ boardId: run.boardId });
    } catch (refused) {
      if (!(refused instanceof Error) || !refused.message.includes("still going")) throw refused;
      console.log("the chain is still on the queue — draining it");
    }
  } else {
    const refusals = vibesRefusals(draft);
    const asked = vibesBrief(draft);
    if (!asked) {
      for (const [field, why] of Object.entries(refusals)) console.error(`${field}: ${why}`);
      process.exit(1);
    }

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

  if (showIntentions) {
    const { all } = await designerReferences({ db, projectId: project.id })();
    for (let index = 0; index < brief.pages; index++) {
      console.log(`\n${"─".repeat(70)}\nintention, page ${index + 1}:`);
      console.log(vibesIntention({ brief, index, pictures: all }));
    }
  }

  const designed: Designed[] = [];
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

  for (const [take, boardId] of boardIds.entries()) {
    const after = await db.moodboard.findUniqueOrThrow({
      where: { id: boardId },
      select: { title: true, projectId: true, revision: true, elements: true, appState: true },
    });
    const elements = persistableElements(after.elements);
    const drawnPages = pagesInReadingOrder(boardPages(elements));
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
      if (read.read) console.log(`  ${read.read}`);
      console.log(`  ${file}`);
    }

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
