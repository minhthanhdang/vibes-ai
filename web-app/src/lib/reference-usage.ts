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
  const titles = boards.map((board) => board.title.trim() || "Untitled board");
  if (titles.length === 0) return null;
  if (titles.length === 1) return `On “${titles[0]}”`;
  if (titles.length === 2) return `On “${titles[0]}” and “${titles[1]}”`;
  return `On ${titles.length} boards`;
}
