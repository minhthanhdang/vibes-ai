"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  BOARD_TITLE_LIMIT,
  activeBoardId,
  boardAfterRemoval,
  nextBoardTitle,
  normalizedBoardTitle,
  withBoardTitle,
} from "@/lib/moodboard-boards";

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center rounded-xl border border-dashed border-current/15 text-sm opacity-60">
      {children}
    </div>
  );
}

/// The editor is 1.5 MB of canvas code that cannot render on the server — it
/// reaches for `window` on import — so the whole canvas module is loaded only
/// once a board is on screen. Deferred here rather than inside the canvas so
/// that module can reach for excalidraw's coordinate and element helpers
/// directly: a static import of those from a file the page always loads would
/// pull the editor back into the first payload.
const MoodboardCanvas = dynamic(
  async () => (await import("./moodboard-canvas")).MoodboardCanvas,
  { ssr: false, loading: () => <Placeholder>Loading canvas…</Placeholder> },
);

/// The board's scene, fetched once and handed to the editor as its initial
/// document. Not refetched on focus or on mount: excalidraw owns the scene from
/// the moment it mounts, so a background refetch replacing `data` under it
/// would be a silent revert of whatever the director has drawn since.
function BoardScene({ boardId }: { boardId: string }) {
  const trpc = useTRPC();
  const [reloads, setReloads] = useState(0);
  const { data, error, refetch } = useQuery(
    trpc.moodboard.scene.queryOptions(
      { id: boardId },
      { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
    ),
  );

  /// Remounting is the point: the editor is initialised from a document, so
  /// the only way to show a newer one is to give it a new instance.
  const reload = useCallback(async () => {
    await refetch();
    setReloads((count) => count + 1);
  }, [refetch]);

  if (error) return <Placeholder>Could not open this board.</Placeholder>;
  if (!data) return <Placeholder>Opening board…</Placeholder>;

  return <MoodboardCanvas key={`${boardId}:${reloads}`} scene={data} onReload={reload} />;
}

type Board = { id: string; title: string };

/// A tab is the board's name, its rename field and its delete confirmation in
/// one place — the boards live in a single scrolling row, so a menu or a modal
/// would be more chrome than the row itself.
function BoardTab({
  board,
  isActive,
  onOpen,
  onRename,
  onRemove,
}: {
  board: Board;
  isActive: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  /// A blur commits, and Enter blurs — so without this the commit runs twice,
  /// the second time against a draft the first already cleared.
  const committed = useRef(false);

  function startRename() {
    setConfirmingRemoval(false);
    committed.current = false;
    setDraft(board.title);
  }

  function commitRename() {
    if (committed.current || draft === null) return;
    committed.current = true;
    const title = normalizedBoardTitle(draft);
    setDraft(null);
    if (title && title !== board.title) onRename(title);
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={BOARD_TITLE_LIMIT}
        aria-label={`Rename ${board.title}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitRename}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            committed.current = true;
            setDraft(null);
          }
        }}
        className="w-40 shrink-0 rounded-full border border-current/40 bg-transparent px-3 py-1 text-xs outline-none"
      />
    );
  }

  if (confirmingRemoval) {
    return (
      <span className="flex shrink-0 items-center gap-2 rounded-full border border-current/40 px-3 py-1 text-xs">
        Delete “{board.title}”?
        <button type="button" onClick={onRemove} className="font-medium underline">
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirmingRemoval(false)}
          className="opacity-60 underline hover:opacity-100"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center rounded-full border transition-opacity ${
        isActive ? "border-current/40 font-medium" : "border-current/15 opacity-60 hover:opacity-100"
      }`}
    >
      {/* Double-click renames rather than a nested pencil button: a button
          inside a button is invalid markup and swallows the click. */}
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={startRename}
        aria-current={isActive}
        className="max-w-56 truncate py-1 pr-1 pl-3 text-xs"
      >
        {board.title}
      </button>

      {isActive ? (
        <>
          <button
            type="button"
            onClick={startRename}
            aria-label={`Rename ${board.title}`}
            title="Rename"
            className="px-1 py-1 text-xs opacity-60 hover:opacity-100"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemoval(true)}
            aria-label={`Delete ${board.title}`}
            title="Delete board"
            className="py-1 pr-3 pl-1 text-xs opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </>
      ) : (
        <span className="pr-3" />
      )}
    </span>
  );
}

export function MoodboardPanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [chosenId, setChosenId] = useState<string | null>(null);

  const boardsOptions = trpc.moodboard.listByProject.queryOptions({ projectId });
  const boardsKey = boardsOptions.queryKey;
  const { data: boards, isPending } = useQuery(boardsOptions);

  /// A board deleted elsewhere leaves a chosen id nothing answers to, so the
  /// list decides and the choice only narrows it.
  const activeId = activeBoardId(boards, chosenId);

  const create = useMutation(
    trpc.moodboard.create.mutationOptions({
      onSuccess: async (board) => {
        setChosenId(board.id);
        await queryClient.invalidateQueries({ queryKey: boardsKey });
      },
    }),
  );

  /// Renaming writes the new title into the list before the request lands: the
  /// tab the director just typed into is the one thing on screen that must not
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

  const remove = useMutation(
    trpc.moodboard.remove.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey: boardsKey });
        const previous = queryClient.getQueryData(boardsKey);
        /// Chosen before the row goes: which board is left open is decided from
        /// the list that still contains the one being deleted.
        setChosenId(boardAfterRemoval(previous ?? [], id, activeId));
        queryClient.setQueryData(boardsKey, (current) =>
          current?.filter((board) => board.id !== id),
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot) queryClient.setQueryData(boardsKey, snapshot.previous);
      },
      onSuccess: ({ id }) => {
        /// The deleted board's scene is dead cache — it is pinned with
        /// `staleTime: Infinity`, so nothing would ever evict it on its own.
        queryClient.removeQueries({ queryKey: trpc.moodboard.scene.queryOptions({ id }).queryKey });
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: boardsKey }),
    }),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2 overflow-x-auto">
        {boards?.map((board) => (
          <BoardTab
            key={board.id}
            board={board}
            isActive={board.id === activeId}
            onOpen={() => setChosenId(board.id)}
            onRename={(title) => rename.mutate({ id: board.id, title })}
            onRemove={() => remove.mutate({ id: board.id })}
          />
        ))}

        <button
          type="button"
          onClick={() => create.mutate({ projectId, title: nextBoardTitle(boards ?? []) })}
          disabled={create.isPending}
          className="shrink-0 rounded-full border border-dashed border-current/25 px-3 py-1 text-xs opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
        >
          + New board
        </button>
      </div>

      {/* The canvas sizes itself from its container, and a flex basis is not a
          height a percentage can resolve against — so the board is positioned
          rather than stretched. */}
      <div className="relative min-h-0 flex-1">
        {activeId ? (
          <BoardScene key={activeId} boardId={activeId} />
        ) : (
          <Placeholder>
            {isPending ? "Loading boards…" : "No board yet — start one with “New board”."}
          </Placeholder>
        )}
      </div>
    </div>
  );
}
