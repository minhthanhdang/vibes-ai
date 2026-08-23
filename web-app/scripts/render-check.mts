/// `renderForModel` against excalidraw's own export, on the real boards in this
/// database. `npm run render:check`.
///
///   npm run render:check
///   npm run render:check -- --board <boardId> --out /tmp/look
///
/// This is the comparison compositor-v2.md §III.2.1 turns on and the first
/// thing the task says to flag rather than decide: stage 0's renderer is a
/// re-implementation, and a shape it draws differently from the export is a page
/// the model judges differently from the user. The arithmetic is in
/// `src/server/render/compare.ts` and tested there; what this adds is the only
/// part that cannot be tested — real scenes, drawn by real people, with the
/// browser's picture of the same revision sitting beside them in the bucket.
///
/// A board qualifies when its stored `renderRevision` equals its `revision`:
/// that is what makes the two pictures of the *same scene*, and comparing
/// against an export of a board that has since moved on would measure the
/// user's edits rather than this renderer.
///
/// What it does not cover, said out loud because a passing verdict here reads
/// as "the renderer agrees": a grid of luminance cells over six boards missed
/// text set wider than its own element, which this renderer cut mid-word until
/// `textOverflow` was written. The boards it has been run on carry text
/// excalidraw itself sized around the words; a design agent writes the box
/// first and the words into it, so the case only shows up on pages nobody had
/// exported yet.
///
/// Both PNGs are written to disk so the numbers can be looked at. That is not
/// the requirement agent 8 is held to — nothing it draws is ever shown to a
/// *user* — it is an operator looking at their own bucket from their own
/// machine, which is what `npm run spend` and `npm run smoke` also are.
///
/// **Drawn here rather than through `renderForModel`, and that is a correction.**
/// This script asked for the model's own picture for five iterations of renderer
/// work and was handed a *cached* one: `renderForModel` names its object by board
/// and revision alone (`lib/scene/moodboard-render.ts`), so a HEAD that hits
/// returns bytes drawn by whatever the renderer was on the day the board was last
/// opened.
/// A renderer fix therefore could not move the comparison at all until the object
/// aged out of the bucket (`MODEL_RENDER_LIFECYCLE_DAYS` 7) or the user edited the
/// board. The first fix with a live case on this database — the sketched stroke —
/// read as byte-identical through the cache and as CLOSE 2.4% -> AGREES 0.0% when
/// the same board was rasterised fresh. The plan and the rasteriser are what this
/// script is about, so it now calls them directly.
///
/// The product had the same staleness and no longer does: the object name carries
/// `MODEL_RENDER_DIALECT` (§III.2.1's eighth block), so a renderer fix renames
/// every picture it would have drawn differently. Drawing directly here is still
/// the right call for a different reason — this script is about the two halves it
/// names, not about the bucket in front of them.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { boardRenderPlan } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import { compareRenders, COMPARE_GRID, type RenderDifference } from "../src/server/render/compare";
import { closeDb, db } from "../src/server/db";
import { readObject } from "../src/server/google/storage";
import { RENDER_SOURCE_BYTE_LIMIT, projectReferenceBytes } from "../src/server/render/for-model";
import { rasterise } from "../src/server/render/rasterise";

config({ path: ".env.local" });
config({ path: ".env" });

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

const onlyBoard = valueOf("--board");
const onlyProject = valueOf("--project");
const out = valueOf("--out") ?? ".render-check";
const grid = Number(valueOf("--grid") ?? COMPARE_GRID);
const limit = Number(valueOf("--limit") ?? 6);

/// The columns the pick is made on. `elements` is the megabytes and is read per
/// board afterwards, so a database with fifty boards on it is not fifty scenes
/// in memory to choose six.
const CANDIDATE_SELECT = {
  id: true,
  projectId: true,
  title: true,
  revision: true,
  renderUri: true,
  renderRevision: true,
} as const;

function percent(share: number) {
  return `${(share * 100).toFixed(1)}%`;
}

function verdict(difference: RenderDifference) {
  /// Three bands rather than a pass/fail, because the question §III.2.1 asks is
  /// not "are they the same" — they cannot be — but "would a model judging the
  /// arrangement in one judge it the same way in the other". A tenth of the
  /// cells is roughly one photograph's worth of page.
  if (difference.aspect > 0.02) return "FRAMED DIFFERENTLY";
  if (difference.differing > 0.1) return "APART";
  if (difference.differing > 0.02) return "CLOSE";
  return "AGREES";
}

try {
  const candidates = await db.moodboard.findMany({
    where: {
      ...(onlyBoard && { id: onlyBoard }),
      ...(onlyProject && { projectId: onlyProject }),
      renderUri: { not: null },
    },
    select: CANDIDATE_SELECT,
    orderBy: { updatedAt: "desc" },
  });

  /// Filtered here rather than in the query: Prisma has no column-to-column
  /// comparison, and the rows are small.
  const comparable = candidates.filter((board) => board.renderRevision === board.revision);
  const stale = candidates.length - comparable.length;

  console.log(
    `${candidates.length} board${candidates.length === 1 ? "" : "s"} with a stored export, ${comparable.length} of them at the revision the board is now on${stale ? ` (${stale} skipped — the user has edited since)` : ""}`,
  );
  if (!comparable.length) {
    console.log("nothing to compare — open a board in the app and let it autosave a render");
    process.exit(0);
  }

  mkdirSync(out, { recursive: true });

  for (const board of comparable.slice(0, limit)) {
    const scene = await db.moodboard.findUniqueOrThrow({
      where: { id: board.id },
      select: { projectId: true, revision: true, elements: true, appState: true },
    });

    const named = `${board.title || "untitled"} (${board.id} @${board.revision})`;
    console.log(`\n${"─".repeat(70)}\n${named}`);

    const started = Date.now();
    const plan = boardRenderPlan(persistableElements(scene.elements as never) as never, {
      background: (scene.appState as { viewBackgroundColor?: unknown } | null)
        ?.viewBackgroundColor,
    });
    if (!plan) {
      console.log("  nothing on this board to draw");
      continue;
    }
    const drawn = await rasterise(plan, projectReferenceBytes(scene.projectId));
    const seconds = ((Date.now() - started) / 1000).toFixed(2);

    const mine = Buffer.from(drawn.bytes);
    const theirs = await readObject(board.renderUri as string, RENDER_SOURCE_BYTE_LIMIT);

    const stem = join(out, `${board.id}@${board.revision}`);
    writeFileSync(`${stem}.mine.png`, mine);
    writeFileSync(`${stem}.theirs.png`, theirs);

    const difference = await compareRenders(new Uint8Array(mine), new Uint8Array(theirs), grid);

    console.log(`  ${verdict(difference)}  ${percent(difference.differing)} of cells apart, mean ${difference.mean.toFixed(3)}`);
    console.log(
      `  mine ${difference.mine.width}×${difference.mine.height} (drawn fresh, ${seconds}s), theirs ${difference.theirs.width}×${difference.theirs.height}, framing ${percent(difference.aspect)} apart`,
    );
    console.log(
      `  worst cell ${difference.worst.difference.toFixed(3)} at ${difference.worst.x},${difference.worst.y} of ${difference.grid}`,
    );
    /// The undrawn list is the other half of the honesty rule (§III.2): a shape
    /// outside the subset is drawn as an outline and named, and a comparison
    /// that scored badly without saying what was outlined would send whoever
    /// reads it looking for a bug in the drawing of something never drawn.
    if (plan.undrawn.length) {
      console.log(
        `  not drawn: ${plan.undrawn.map(({ type, id }) => `${type} ${id}`).join(", ")}`,
      );
    }
    console.log(`  ${stem}.mine.png  ${stem}.theirs.png`);
  }
} finally {
  await closeDb();
}
