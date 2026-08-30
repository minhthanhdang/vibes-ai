import {
  boardPages,
  elementBox,
  pageHolding,
  pagesInReadingOrder,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { persistableElements, referenceIdFromFileId } from "@/lib/scene/moodboard-scene";

export type UsingPage = { pageId: string; name: string };

export type UsingBoard = {
  id: string;
  title: string;
  pages?: UsingPage[];
};

export type ReferenceUsageEntry = { referenceId: string; boards: UsingBoard[] };

export type StoredBoard = {
  id: string;
  title: string;
  elements: unknown;
};

export function boardReferenceUsage(boards: readonly StoredBoard[]): ReferenceUsageEntry[] {
  const usage = new Map<string, UsingBoard[]>();

  for (const board of boards) {
    const elements = persistableElements(board.elements);
    const pages = pagesInReadingOrder(boardPages(elements));
    const spread = pages.length > 1;

    const seats = new Map<string, Set<string>>();
    for (const element of elements) {
      const referenceId = referenceIdFromFileId(element.fileId);
      if (!referenceId) continue;

      let on = seats.get(referenceId);
      if (!on) {
        on = new Set<string>();
        seats.set(referenceId, on);
      }
      if (!spread) continue;

      const box = elementBox(element);
      const page = box && pageHolding(pages, box);
      if (page) on.add(page.id);
    }

    for (const [referenceId, on] of seats) {
      const using = {
        id: board.id,
        title: board.title,
        ...(spread && { pages: pagesSaid(pages, on) }),
      };
      const named = usage.get(referenceId);
      if (named) named.push(using);
      else usage.set(referenceId, [using]);
    }
  }

  return [...usage].map(([referenceId, boards]) => ({ referenceId, boards }));
}

function pagesSaid(pages: readonly BoardPage[], on: ReadonlySet<string>): UsingPage[] {
  return pages
    .filter((page) => on.has(page.id))
    .map((page) => ({ pageId: page.id, name: page.name }));
}

export function sceneReferenceCounts(elements: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const element of persistableElements(elements)) {
    const referenceId = referenceIdFromFileId(element.fileId);
    if (!referenceId) continue;
    counts.set(referenceId, (counts.get(referenceId) ?? 0) + 1);
  }
  return counts;
}

export function sameReferenceCounts(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, count] of a) if (b.get(id) !== count) return false;
  return true;
}

export function referenceUsageIndex(
  entries: readonly ReferenceUsageEntry[],
): Map<string, UsingBoard[]> {
  return new Map(entries.map((entry) => [entry.referenceId, entry.boards]));
}

export function usingBoards(
  index: ReadonlyMap<string, UsingBoard[]> | null,
  referenceId: string,
): UsingBoard[] {
  return index?.get(referenceId) ?? [];
}

export function usageSummary(boards: readonly UsingBoard[]): string | null {
  return boards.length ? `On ${boardList(boards)}` : null;
}

function boardList(boards: readonly UsingBoard[]): string {
  const titles = boards.map((board) => board.title.trim() || "Untitled board");
  if (titles.length === 1) return `“${titles[0]}”${pagesSeen(boards[0]!)}`;
  if (titles.length === 2) return `“${titles[0]}” and “${titles[1]}”`;
  return `${titles.length} boards`;
}

function pagesSeen({ pages }: UsingBoard): string {
  if (!pages) return "";
  if (!pages.length) return " (on none of its pages)";
  if (pages.length > 2) return ` (${pages.length} pages of it)`;
  return ` (${pages.map(pageName).join(" and ")})`;
}

function pageName(page: UsingPage) {
  return page.name.trim() || "an unnamed page";
}

export function usingPagesSaid({ pages }: UsingBoard): string {
  if (!pages?.length) return "";
  return ` on ${pages.map((page) => `“${pageName(page)}” (${page.pageId})`).join(" and ")}`;
}

export type RemovalUsage = { own: UsingBoard[]; viaVersions: UsingBoard[] };

export function removalUsage(
  index: ReadonlyMap<string, UsingBoard[]> | null,
  referenceId: string,
  versionIds: readonly string[],
): RemovalUsage {
  const own = usingBoards(index, referenceId);
  const named = new Set(own.map((board) => board.id));
  const viaVersions: UsingBoard[] = [];

  for (const versionId of versionIds) {
    for (const board of usingBoards(index, versionId)) {
      if (named.has(board.id)) continue;
      named.add(board.id);
      viaVersions.push(board);
    }
  }

  return { own, viaVersions };
}

export function removalUsageSummary({ own, viaVersions }: RemovalUsage): string | null {
  if (!viaVersions.length) return usageSummary(own);
  if (!own.length) return `Its crops are on ${boardList(viaVersions)}`;
  return `On ${boardList(own)} — its crops on ${boardList(viaVersions)}`;
}
