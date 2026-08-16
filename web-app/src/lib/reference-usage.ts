import { persistableElements, referenceIdFromFileId } from "./moodboard-scene";

/// Which boards a reference is on. A reference is deleted from the gallery, but
/// it is *used* on the canvas — and the two views never share a screen, so
/// removing a photo is done with no sight of the boards it is holding up.
///
/// Nothing else recovers from that: the row goes, its bucket objects go with it,
/// and every board element naming it turns into one of excalidraw's placeholder
/// boxes on the next reload. This is the reading that lets the removal say so
/// first.

export type UsingBoard = { id: string; title: string };

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
    const seen = new Set<string>();
    for (const element of persistableElements(board.elements)) {
      const referenceId = referenceIdFromFileId(element.fileId);
      if (!referenceId || seen.has(referenceId)) continue;
      seen.add(referenceId);

      const using = usage.get(referenceId);
      if (using) using.push({ id: board.id, title: board.title });
      else usage.set(referenceId, [{ id: board.id, title: board.title }]);
    }
  }

  return [...usage].map(([referenceId, boards]) => ({ referenceId, boards }));
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
  if (titles.length === 1) return `“${titles[0]}”`;
  if (titles.length === 2) return `“${titles[0]}” and “${titles[1]}”`;
  return `${titles.length} boards`;
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
