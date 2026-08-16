"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";

/// The seat the orchestrator will take over: for now it calls agent 1's
/// collect tool directly with whatever phrase is typed.
export function ReferenceSidebar({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const collect = useMutation(
    trpc.reference.collect.mutationOptions({
      onSuccess: () => {
        setQuery("");
        return queryClient.invalidateQueries({
          queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
        });
      },
    }),
  );

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) collect.mutate({ projectId, query: query.trim(), limit: 12 });
        }}
      >
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          rows={3}
          placeholder="gloomy historical mansion"
          className="resize-none rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
        <button
          type="submit"
          disabled={collect.isPending}
          className="rounded-lg border border-current/20 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {collect.isPending ? "Searching…" : "Find references"}
        </button>
      </form>

      {collect.error ? (
        <p className="text-sm text-red-500">{collect.error.message}</p>
      ) : collect.data ? (
        <p className="text-sm opacity-60">
          {collect.data.found} images for “{collect.data.query}”.
        </p>
      ) : (
        <p className="text-sm opacity-60">
          Searches Unsplash, Pexels and Google Custom Search for freely licensed images and adds
          them to this project with their credits.
        </p>
      )}
    </div>
  );
}
