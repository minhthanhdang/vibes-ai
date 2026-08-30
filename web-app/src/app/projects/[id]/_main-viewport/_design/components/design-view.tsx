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

  const requestedId = useOpenBoardStore((state) => state.requestedId);

  const activeId = activeBoardId(boards, requestedId ?? chosenId);

  useEffect(() => boardOpened(activeId), [activeId]);

  function chooseBoard(id: string | null) {
    openBoard(null);
    setChosenId(id);
  }

  const saveGateRef = useRef<(() => Promise<void>) | null>(null);

  const create = useMutation(
    trpc.moodboard.create.mutationOptions({
      onSuccess: async (board) => {
        chooseBoard(board.id);
        await queryClient.invalidateQueries({ queryKey: boardsKey });
      },
    }),
  );

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

  const duplicate = useMutation(
    trpc.moodboard.duplicate.mutationOptions({
      onSuccess: async (board) => {
        chooseBoard(board.id);
        await queryClient.invalidateQueries({ queryKey: boardsKey });
      },
    }),
  );

  async function duplicateBoard(board: Board) {
    if (duplicate.isPending) return;
    await saveGateRef.current?.();
    duplicate.mutate({ id: board.id, title: duplicateBoardTitle(boards ?? [], board.title) });
  }

  const remove = useMutation(
    trpc.moodboard.remove.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey: boardsKey });
        const previous = queryClient.getQueryData(boardsKey);
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
        queryClient.removeQueries({ queryKey: trpc.moodboard.scene.queryOptions({ id }).queryKey });
        announceBoardDiscarded({
          boardId: id,
          title: context?.previous?.find((board) => board.id === id)?.title ?? "",
        });
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: boardsKey }),
    }),
  );

  const activeTitle = boards?.find((board) => board.id === activeId)?.title ?? null;

  return (
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
