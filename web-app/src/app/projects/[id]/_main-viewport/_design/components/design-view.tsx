"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  activeBoardId,
  boardAfterRemoval,
  duplicateBoardTitle,
  nextBoardTitle,
  withBoardTitle,
} from "@/lib/scene/moodboard-boards";
import { boardOpened, openBoard, useOpenBoardStore } from "../../../_workspace/stores/use-open-board-store";
import { announceBoardDiscarded } from "../../../_events/board-discarded";
import { BoardScene, Placeholder } from "./canvas/board-scene";
import { BoardDock } from "./boards/board-dock";
import { BoardTabs } from "./boards/board-tabs";
import type { Board } from "../types";

export function DesignView({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [chosenId, setChosenId] = useState<string | null>(null);

  const boardsOptions = trpc.moodboard.listByProject.queryOptions({ projectId });
  const boardsKey = boardsOptions.queryKey;
  const { data: boards, isPending } = useQuery(boardsOptions);

  /// A board the assistant composed and put in the chat. It outranks the last
  /// tab clicked because it is the more recent instruction, and clicking any tab
  /// clears it — so the request opens the board once rather than pinning it.
  const requestedId = useOpenBoardStore((state) => state.requestedId);

  /// A board deleted elsewhere leaves a chosen id nothing answers to, so the
  /// list decides and the choice only narrows it.
  const activeId = activeBoardId(boards, requestedId ?? chosenId);

  /// Said out loud because the chat is the one asking: a page is attached to a
  /// message from the board the tab is showing, and the sidebar is in the other
  /// column with no way to know which that is.
  useEffect(() => boardOpened(activeId), [activeId]);

  function chooseBoard(id: string | null) {
    openBoard(null);
    setChosenId(id);
  }

  /// The open board's "the server holds what is on screen" gate. Duplicating
  /// copies the stored row, so the copy would otherwise be the board as of the
  /// last autosave — missing whatever was done in the second before the click.
  const saveGateRef = useRef<(() => Promise<void>) | null>(null);

  const create = useMutation(
    trpc.moodboard.create.mutationOptions({
      onSuccess: async (board) => {
        chooseBoard(board.id);
        await queryClient.invalidateQueries({ queryKey: boardsKey });
      },
    }),
  );

  /// Renaming writes the new title into the list before the request lands: the
  /// tab the user just typed into is the one thing on screen that must not
  /// flicker back to the old name for a round trip.
  const rename = useMutation(
    trpc.moodboard.rename.mutationOptions({
      onMutate: async ({ id, title }) => {
        await queryClient.cancelQueries({ queryKey: boardsKey });
        const previous = queryClient.getQueryData(boardsKey);
        queryClient.setQueryData(boardsKey, (current) =>
          current ? withBoardTitle(current, id, title) : current,
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot) queryClient.setQueryData(boardsKey, snapshot.previous);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: boardsKey }),
    }),
  );

  /// A copy opens immediately: duplicating a board is how a second direction is
  /// started, and the next thing done is changing the copy rather than admiring
  /// the original.
  const duplicate = useMutation(
    trpc.moodboard.duplicate.mutationOptions({
      onSuccess: async (board) => {
        chooseBoard(board.id);
        await queryClient.invalidateQueries({ queryKey: boardsKey });
      },
    }),
  );

  async function duplicateBoard(board: Board) {
    /// The click waits for a save, which is long enough to click again — and two
    /// copies named from the same list would be two boards with one name.
    if (duplicate.isPending) return;
    await saveGateRef.current?.();
    duplicate.mutate({ id: board.id, title: duplicateBoardTitle(boards ?? [], board.title) });
  }

  const remove = useMutation(
    trpc.moodboard.remove.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey: boardsKey });
        const previous = queryClient.getQueryData(boardsKey);
        /// Chosen before the row goes: which board is left open is decided from
        /// the list that still contains the one being deleted.
        chooseBoard(boardAfterRemoval(previous ?? [], id, activeId));
        queryClient.setQueryData(boardsKey, (current) =>
          current?.filter((board) => board.id !== id),
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot) queryClient.setQueryData(boardsKey, snapshot.previous);
      },
      onSuccess: ({ id }, _input, context) => {
        /// The deleted board's scene is dead cache — it is pinned with
        /// `staleTime: Infinity`, so nothing would ever evict it on its own.
        queryClient.removeQueries({ queryKey: trpc.moodboard.scene.queryOptions({ id }).queryKey });
        /// And the chat may be holding a tile of it. Announced from here as well
        /// as from the chat's own Discard button, because a tile whose board is
        /// gone opens whichever board the tab row falls back to — a click that
        /// silently lands somewhere else. The count is not in this list, and the
        /// note says so rather than guessing.
        announceBoardDiscarded({
          boardId: id,
          title: context?.previous?.find((board) => board.id === id)?.title ?? "",
        });
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: boardsKey }),
    }),
  );

  /// The name the collapsed dock carries. Read from the list rather than held,
  /// so a rename shows on the dock the moment the tab commits it.
  const activeTitle = boards?.find((board) => board.id === activeId)?.title ?? null;

  return (
    /// The canvas sizes itself from its container, and a flex basis is not a
    /// height a percentage can resolve against — so the board is positioned
    /// rather than stretched. The dock is positioned against the same box,
    /// which is why it is the board's full height and not the column's.
    <div className="relative min-h-0 flex-1">
      {activeId ? (
        <BoardScene
          key={activeId}
          projectId={projectId}
          boardId={activeId}
          saveGateRef={saveGateRef}
        />
      ) : (
        <Placeholder>
          {isPending ? "Loading boards…" : "No board yet — start one with “New board”."}
        </Placeholder>
      )}

      <BoardDock activeTitle={activeTitle}>
        <BoardTabs
          boards={boards}
          activeId={activeId}
          isCreating={create.isPending}
          onOpen={(board) => chooseBoard(board.id)}
          onRename={(board, title) => rename.mutate({ id: board.id, title })}
          onDuplicate={(board) => void duplicateBoard(board)}
          onRemove={(board) => remove.mutate({ id: board.id })}
          onCreate={() => create.mutate({ projectId, title: nextBoardTitle(boards ?? []) })}
        />
      </BoardDock>
    </div>
  );
}
