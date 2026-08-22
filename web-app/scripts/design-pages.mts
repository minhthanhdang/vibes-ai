/// Every page on this database, read the way `design:check` reads the one it
/// just made. `npm run design:pages`, or `npm run design:pages -- <projectId>`.
///
/// The third free census, and the one three separate iterations have written by
/// hand and thrown away. `npm run design:runs` asks what the designs *cost*;
/// this asks what they *left* — the shape of every page, how much of it is
/// inked, how far the work stops from each edge and how big the type is set.
///
/// It exists because that hand-written query has twice said something no fixture
/// run could: twenty-three pages made across every run and every one of them
/// 1920x1080 or 1080x1920, which is what sent iteration 36 looking for a number
/// in the prompt rather than an argument to add to it. §VIII's answer to "free
/// placement can make an ugly page" is a fixture set that is eyeballed, and
/// three eyeballed pages is a smaller sample than the one already sitting in
/// this database for nothing.
///
/// What it said the first time it was run, over 41 pages on 19 boards:
///
///   shapes      1920x1080 x22, 1080x1920 x13, 2048x2048 x3, 1920x600 x2, 1920x640 x1
///   median ink  24%
///   type        median 5% of the frame, up to 10%, median step 1.5x
///
/// The three 2048x2048 are agent 4's moodboards and the 1920x640 is a page
/// `design:check --page-box` handed the design; every other row is a page agent
/// 8 wrote a box for. The type line is the reading that had never been taken and
/// the argument for it is above `typeOf` in `render/plan-read.ts`.
///
/// And what it said once the type read learnt where the door's own ceiling is,
/// over 42 pages:
///
///   ceiling     11 of the 33 pages with type on them at or past 96px
///
/// Starred in the type column. Ten of the eleven are welcome signs, which is
/// the ask whose §VIII flaw has been read as small type for six iterations —
/// `put_on_canvas` cannot set a line over 96px whatever box it is handed, so on
/// a 1080x1920 sign 5.0% of the frame is not a choice, it is the maximum. The
/// eleventh is at 110px, which is a put at the ceiling that a
/// `transform_on_canvas` then scaled.
///
/// Both readings above were taken with the rasteriser's pad standing in for a
/// measurement, and every ink and margin figure in them is inflated by whatever
/// each page's paragraphs over-stated (`setOverflow`, `render/render-plan.ts`).
/// Re-taken over 79 pages with the set line measured: median ink 60%, the
/// text-heavy pages 1–7 points lower than the pad said, and one welcome sign
/// that had been reaching both side edges of its own frame now leaving 10% at
/// each. The contrast line moved the other way — 203 of 536 failing pairs to
/// 206 — because two lines the pad had been sampling off the page came back
/// onto the teal ground they are really standing on.
///
/// Nothing here is a verdict, for the reason `plan-read.ts` gives at length. It
/// is also not a check on a *user's* board: a page a person dragged and filled
/// themselves reads on the same lines, and the column that tells them apart is
/// the project.

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

/// Sorted rather than said in the order the rows came back: the reading being
/// taken is "what does this design make", and a column of shapes with the same
/// number down it is the answer arriving without anybody counting.
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
    /// Marked with a `*` in the column above rather than only totalled here: the
    /// share and the ceiling are the same number on those rows, and a reader
    /// comparing two pages needs to know which of them was stopped.
    console.log(
      `  ceiling: ${typed.filter(({ atCeiling }) => atCeiling).length} pages at or past the ${LAYOUT_TEXT_MAX_FONT}px a put sets (*)`,
    );
  }
  /// The reading `compositor-v2.md` §IX.5's palette bullet has been owed since
  /// its third run: a page can hold every hex in the brief and still lay two of
  /// them on each other. `!` marks a page carrying a pair under what its size
  /// wants; the pages with no number at all are the ones whose type all stands
  /// on photographs, which is ground no plan holds and not a clean page.
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
