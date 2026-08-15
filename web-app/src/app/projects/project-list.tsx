"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";

export function ProjectList() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");

  const listOptions = trpc.project.list.queryOptions({ limit: 20 });
  const { data } = useQuery(listOptions);

  const create = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: () => {
        setTitle("");
        return queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
      },
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) create.mutate({ title: title.trim(), brief: "" });
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New project title"
          className="flex-1 rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg border border-current/20 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </form>

      {data?.items.length ? (
        <ul className="flex flex-col gap-px overflow-hidden rounded-xl border border-current/10 bg-current/10">
          {data.items.map((project) => (
            <li key={project.id} className="bg-[var(--background)] px-5 py-4">
              <div className="text-sm font-medium">{project.title}</div>
              <div className="text-sm opacity-60">
                {project.brief || "No brief yet."}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm opacity-60">No projects yet.</p>
      )}
    </div>
  );
}
