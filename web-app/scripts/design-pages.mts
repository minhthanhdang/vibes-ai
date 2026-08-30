import { config } from "dotenv";

import { LAYOUT_TEXT_MAX_FONT } from "../src/lib/layout/moodboard-layouts";
import { boardPages, pagesInReadingOrder } from "../src/lib/pages/board-pages";
import { planRead, type PlanRead } from "../src/lib/render/plan-read";
import { pageRenderPlan } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import { closeDb, db } from "../src/server/db";

config({ path: ".env.local" });
config({ path: ".env" });

const projectId = process.argv[2];

const percent = (share: number) => `${Math.round(share * 100)}%`;

const median = (values: number[]) =>
  values.length ? values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0;

type PageRow = { project: string; board: string; name: string; read: PlanRead };

try {
  const boards = await db.moodboard.findMany({
    where: projectId ? { projectId } : {},
    select: { id: true, projectId: true, elements: true, appState: true },
    orderBy: { updatedAt: "asc" },
  });

  const rows: PageRow[] = [];
  for (const board of boards) {
    const elements = persistableElements(board.elements as never);
    const background = (board.appState as { viewBackgroundColor?: unknown } | null)
      ?.viewBackgroundColor;
    for (const page of pagesInReadingOrder(boardPages(elements))) {
      rows.push({
        project: board.projectId,
        board: board.id,
        name: page.name ?? "",
        read: planRead(pageRenderPlan(elements, page, { background })),
      });
    }
  }

  if (!rows.length) {
    console.log("no pages on this database");
  }

  console.log(
    [
      "page".padEnd(28),
      "shape".padStart(10),
      "ink".padStart(5),
      "type".padStart(6),
      "step".padStart(5),
      "worst".padStart(7),
      "what stands on it",
    ].join(" "),
  );
  for (const { name, read } of rows) {
    const type = read.type;
    console.log(
      [
        (name || "—").slice(0, 28).padEnd(28),
        read.shape.padStart(10),
        percent(read.ink).padStart(5),
        (type ? `${percent(type.largest)}${type.atCeiling ? "*" : ""}` : "—").padStart(6),
        (type ? `${(type.largest / type.smallest).toFixed(1)}x` : "—").padStart(5),
        (read.contrast.worst
          ? `${read.contrast.worst.ratio.toFixed(1)}${read.contrast.failing.length ? "!" : ""}`
          : "—"
        ).padStart(7),
        `${read.landed}${read.framed ? ` — ${read.framed}` : ""}`,
      ].join(" "),
    );
  }

  const shapes = new Map<string, number>();
  for (const { read } of rows) shapes.set(read.shape, (shapes.get(read.shape) ?? 0) + 1);
  const typed = rows.map(({ read }) => read.type).filter((type) => type !== null);

  console.log(`\n${rows.length} pages on ${boards.length} boards`);
  console.log(
    `  shapes: ${[...shapes]
      .sort(([, a], [, b]) => b - a)
      .map(([shape, count]) => `${shape} x${count}`)
      .join(", ")}`,
  );
  console.log(`  median ink: ${percent(median(rows.map(({ read }) => read.ink)))}`);
  if (typed.length) {
    console.log(
      `  type on ${typed.length}: largest is a median ${percent(median(typed.map(({ largest }) => largest)))} of the frame, ` +
        `up to ${percent(Math.max(...typed.map(({ largest }) => largest)))}`,
    );
    console.log(
      `  hierarchy: median step ${median(typed.map(({ largest, smallest }) => largest / smallest)).toFixed(1)}x, ` +
        `${typed.filter(({ sizes }) => sizes === 1).length} pages set at one size`,
    );
    console.log(
      `  ceiling: ${typed.filter(({ atCeiling }) => atCeiling).length} pages at or past the ${LAYOUT_TEXT_MAX_FONT}px a put sets (*)`,
    );
  }
  const reads = rows.map(({ read }) => read.contrast);
  const pairs = reads.reduce((sum, read) => sum + read.pairs, 0);
  if (pairs || reads.some(({ overImage }) => overImage)) {
    const failing = reads.filter(({ failing }) => failing.length);
    console.log(
      `  contrast: ${failing.length} of ${rows.length} pages carry a pair under what its size wants, ` +
        `${failing.reduce((sum, { failing }) => sum + failing.length, 0)} of ${pairs} pairs`,
    );
    console.log(
      `  over a photograph: ${reads.reduce((sum, { overImage }) => sum + overImage, 0)} lines stand on ground this cannot read`,
    );
  }
} finally {
  await closeDb();
}
