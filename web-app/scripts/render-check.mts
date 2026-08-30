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
