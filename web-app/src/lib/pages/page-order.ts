import { pagesInReadingOrder, type BoardPage } from "@/lib/pages/board-pages";

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
