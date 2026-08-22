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
} finally {
  await closeDb();
}
