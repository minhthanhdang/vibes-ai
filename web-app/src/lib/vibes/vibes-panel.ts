import type { VibesBoardProgress } from "@/lib/vibes/vibes-batch";

export function vibesDismissKey(board: VibesBoardProgress): string {
  return `${board.boardId}@${board.settled}`;
}

export function visibleVibesBoards(
  boards: readonly VibesBoardProgress[],
  dismissed: ReadonlySet<string>,
): VibesBoardProgress[] {
  return boards.filter((board) => board.live || !dismissed.has(vibesDismissKey(board)));
}

export function liveVibesCount(boards: readonly VibesBoardProgress[]): number {
  return boards.filter((board) => board.live).length;
}
