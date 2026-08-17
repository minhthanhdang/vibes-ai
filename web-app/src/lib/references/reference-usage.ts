import {
  boardPages,
  elementBox,
  pageHolding,
  pagesInReadingOrder,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { persistableElements, referenceIdFromFileId } from "@/lib/scene/moodboard-scene";

/// Which boards a reference is on. A reference is deleted from the gallery, but
/// it is *used* on the canvas — and the two views never share a screen, so
/// removing a photo is done with no sight of the boards it is holding up.
///
/// Nothing else recovers from that: the row goes, its bucket objects go with it,
/// and every board element naming it turns into one of excalidraw's placeholder
/// boxes on the next reload. This is the reading that lets the removal say so
/// first.

/// A page of a board this reference sits on (§V.3). Named as the tools take it,
/// because "it is on Act one" about a three-page spread leaves both the director
/// and the model one read short of knowing where.
export type UsingPage = { pageId: string; name: string };

export type UsingBoard = {
  id: string;
  title: string;
  /// Which pages of it show the reference, in reading order.
  ///
  /// Absent on a board of one page, where the board *is* the page and naming it
  /// twice says nothing — the same rule every other per-page report in this
  /// codebase follows, and what keeps a one-page board's answer byte-identical
  /// to the one it gave before pages existed.
  ///
  /// Present and empty on a spread means the copies sit between its pages: on
  /// the board, on none of its pages, which is a real place a picture can be and
  /// the one a page-scoped call would never find.
  pages?: UsingPage[];
};

/// Wire shape rather than a Map: this crosses tRPC, and a Map does not.
export type ReferenceUsageEntry = { referenceId: string; boards: UsingBoard[] };

export type StoredBoard = {
  id: string;
  title: string;
  /// The `elements` Json column, unparsed — `persistableElements` is what turns
  /// it into elements, and it is the same reading the board's own load applies.
  elements: unknown;
};

/// Every board that shows each reference, in the order the boards were given —
/// which is the tab row's order, so a summary names them the way the director
/// sees them. A reference on twenty elements of one board is that board once.
///
/// Tombstones are not counted: `persistableElements` drops them, so what this
/// reads is the stored document rather than another tab's undo stack.
export function boardReferenceUsage(boards: readonly StoredBoard[]): ReferenceUsageEntry[] {
  const usage = new Map<string, UsingBoard[]>();

  for (const board of boards) {
    const elements = persistableElements(board.elements);
    /// A spread is the only board this question is ambiguous on, so it is the
    /// only one that pays for the geometry: a board of one page reads exactly
    /// as it did before, one pass over the elements and no membership test.
    const pages = pagesInReadingOrder(boardPages(elements));
    const spread = pages.length > 1;

    /// Every copy is visited even though the board is named once, because the
    /// copies can be on different pages — the case a first-appearance-wins read
    /// answers by naming whichever page the scene array happened to carry first.
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

/// Reading order rather than the order the copies were met in: it is the order
/// the pages are numbered in everywhere else, and "page 2 and page 1" is a list
/// about the scene array rather than about the board.
function pagesSaid(pages: readonly BoardPage[], on: ReadonlySet<string>): UsingPage[] {
  return pages
    .filter((page) => on.has(page.id))
    .map((page) => ({ pageId: page.id, name: page.name }));
}

/// The same link read from the composing side rather than the deleting one: how
/// many elements of *one* board — the one open in the editor — show each
/// reference. A director building a board from eighty thumbnails cannot tell
/// which of them are already on it, and placing the same photo twice by accident
/// is the commonest way that goes wrong.
///
/// The count rather than a set, because twice on purpose and twice by accident
/// look identical in a strip that only says "used".
export function sceneReferenceCounts(elements: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const element of persistableElements(elements)) {
    const referenceId = referenceIdFromFileId(element.fileId);
    if (!referenceId) continue;
    counts.set(referenceId, (counts.get(referenceId) ?? 0) + 1);
  }
  return counts;
}

/// Whether a fresh read says anything the last one did not. The board is walked
/// on every quiet period of the autosave, and moving a photo does not change
/// which photos are on the board — so this is what stops a drag from re-rendering
/// the strip.
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

/// What the removal says before it happens. One or two boards are named,
/// because the name is what tells the director whether they care; past that the
/// list stops being readable in a line of a tile and the count is the fact.
///
/// Null is "on no board", which is the case that gets no warning at all — the
/// guard has to be about something or it becomes the thing that is clicked
/// through.
export function usageSummary(boards: readonly UsingBoard[]): string | null {
  return boards.length ? `On ${boardList(boards)}` : null;
}

function boardList(boards: readonly UsingBoard[]): string {
  const titles = boards.map((board) => board.title.trim() || "Untitled board");
  /// The pages ride only on the board named alone. Two boards with their pages
  /// after each is a line nobody reads to the end, and the name of the board is
  /// what decides whether the director cares in the first place.
  if (titles.length === 1) return `“${titles[0]}”${pagesSeen(boards[0]!)}`;
  if (titles.length === 2) return `“${titles[0]}” and “${titles[1]}”`;
  return `${titles.length} boards`;
}

/// Where on a spread, for the director's eyes: the page's name, which is what
/// the canvas draws above the rectangle they are looking at. No ids — this is
/// the line under a Delete button, not a tool argument.
function pagesSeen({ pages }: UsingBoard): string {
  if (!pages) return "";
  if (!pages.length) return " (on none of its pages)";
  if (pages.length > 2) return ` (${pages.length} pages of it)`;
  return ` (${pages.map(pageName).join(" and ")})`;
}

function pageName(page: UsingPage) {
  return page.name.trim() || "an unnamed page";
}

/// The same fact for the model, which needs the id as well as the name: a hole
/// on page 2 of a spread is filled by `swap_on_board` with that pageId, and
/// without it the swap lands on whichever copy the scene array carries first —
/// the exact silent wrong-copy edit page-scoping those tools was written for.
///
/// Empty for a board of one page, where there is no pageId to pass and the tools
/// fall back to the board's only page anyway.
export function usingPagesSaid({ pages }: UsingBoard): string {
  if (!pages?.length) return "";
  return ` on ${pages.map((page) => `“${pageName(page)}” (${page.pageId})`).join(" and ")}`;
}

/// What a removal actually costs the boards, which is not the same question as
/// which boards show this reference: deleting a frame deletes the cuts made of
/// it — the row cascades — and a cut is placed on a board exactly as the
/// photograph is. A frame kept off every board while a crop of it holds up two
/// was the case the guard answered "on no board" to.
///
/// Split rather than merged, because the two are different news: a board showing
/// the photograph loses the photograph, and a board showing only a cut loses a
/// picture the director may not connect to the tile they are deleting. A board
/// showing both is the frame's — it is already named, and naming it twice says
/// nothing more.
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

/// The same line `usageSummary` gives, with the crops in it when they are what
/// is at stake — said as crops rather than folded into one list, since "On
/// “Act one”" about a photograph that is not on Act one is a warning the
/// director cannot check by looking at the board.
export function removalUsageSummary({ own, viaVersions }: RemovalUsage): string | null {
  if (!viaVersions.length) return usageSummary(own);
  if (!own.length) return `Its crops are on ${boardList(viaVersions)}`;
  return `On ${boardList(own)} — its crops on ${boardList(viaVersions)}`;
}
