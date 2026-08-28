import { pagesInReadingOrder, type BoardPage } from "@/lib/pages/board-pages";

/// The Preview tab's page order (multi-vibes-and-preview PRD §III.5): a stored
/// list of page ids on the board, read by exactly two consumers — Preview and
/// the deck export. Everything that says "reading order" to a model
/// (`page-brief`, vibes' "page 3 of 6", `inspect_board`) stays on reading
/// order: agents work the canvas, and the canvas never moves when the user
/// reorders a preview. That line is the whole reason a second ordering is safe.
///
/// Page deletion and duplication on the canvas need no cleanup hook here, and
/// the absence of one is deliberate rather than a miss: ids of deleted pages
/// fall out in `orderedPages`, and pages the list has never heard of are
/// appended in reading order — so the column can go stale forever without
/// anything breaking.

/// The board's pages in preview order: the stored ids first (those that still
/// name a page), then every page the list does not mention, appended in reading
/// order. An empty list therefore *is* reading order — the default costs
/// nothing and the column never needs backfilling.
export function orderedPages(
  pages: readonly BoardPage[],
  stored: readonly string[],
): BoardPage[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const placed: BoardPage[] = [];
  const seen = new Set<string>();
  for (const id of stored) {
    const page = byId.get(id);
    if (!page || seen.has(id)) continue;
    seen.add(id);
    placed.push(page);
  }
  return [...placed, ...pagesInReadingOrder(pages).filter((page) => !seen.has(page.id))];
}

/// The reorder arithmetic: one id moved from one seat to another, the rest
/// shifting to make room. Returns the full explicit list because writing all of
/// it on first touch is what makes pages added later land *after* the user's
/// arrangement rather than interleaved with it. A move that names a seat off
/// the list is refused unchanged — the rail's up button on the first row is
/// exactly that press.
export function moveInOrder(
  orderedIds: readonly string[],
  from: number,
  to: number,
): string[] {
  const ids = [...orderedIds];
  if (from === to) return ids;
  if (!withinOrder(ids, from) || !withinOrder(ids, to)) return ids;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved!);
  return ids;
}

function withinOrder(ids: readonly string[], seat: number): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < ids.length;
}

/// The rail drag's midpoint hit-test (§III.6): which seat a lifted row should
/// take, given the resting rows' vertical midpoints and where the pointer is.
/// The insertion point is how many midpoints the pointer sits below, corrected
/// for the hole the lifted row left behind — so a drag that never crosses a
/// *neighbour's* midpoint hands back the seat it was picked up from. Midpoints
/// are measured once at lift: only the dragged row moves (a transform, not a
/// reflow), so the others' seats hold still for the whole drag.
export function dragSeat(
  midpoints: readonly number[],
  from: number,
  pointerY: number,
): number {
  if (midpoints.length === 0) return 0;
  let passed = 0;
  for (const midpoint of midpoints) if (pointerY > midpoint) passed += 1;
  const seat = passed > from ? passed - 1 : passed;
  return Math.max(0, Math.min(midpoints.length - 1, seat));
}
