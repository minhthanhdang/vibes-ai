"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";

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

export function MoodboardPanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [chosenId, setChosenId] = useState<string | null>(null);

  const boardsOptions = trpc.moodboard.listByProject.queryOptions({ projectId });
  const { data: boards, isPending } = useQuery(boardsOptions);

  const create = useMutation(
    trpc.moodboard.create.mutationOptions({
      onSuccess: async (board) => {
        setChosenId(board.id);
        await queryClient.invalidateQueries({ queryKey: boardsOptions.queryKey });
      },
    }),
  );

  /// A board deleted elsewhere leaves a chosen id nothing answers to, so the
  /// list decides and the choice only narrows it.
  const activeId = boards?.some((board) => board.id === chosenId)
    ? chosenId
    : (boards?.[0]?.id ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2 overflow-x-auto">
        {boards?.map((board) => (
          <button
            key={board.id}
            type="button"
            onClick={() => setChosenId(board.id)}
            aria-current={board.id === activeId}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-opacity ${
              board.id === activeId
                ? "border-current/40 font-medium"
                : "border-current/15 opacity-60 hover:opacity-100"
            }`}
          >
            {board.title}
          </button>
        ))}

        <button
          type="button"
          onClick={() => create.mutate({ projectId })}
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
