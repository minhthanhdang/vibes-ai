"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { isUnlimited, roomFor } from "@/lib/limits/account-tier";

export function ProjectList() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const listOptions = trpc.project.list.queryOptions({ limit: 20 });
  const { data } = useQuery(listOptions);

  const usageOptions = trpc.account.usage.queryOptions({});
  const { data: usage } = useQuery(usageOptions);

  const create = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: async () => {
        setTitle("");
        await queryClient.invalidateQueries({ queryKey: usageOptions.queryKey });
        return queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
      },
    }),
  );

  const remove = useMutation(
    trpc.project.remove.mutationOptions({
      onSuccess: async () => {
        setConfirming(null);
        await queryClient.invalidateQueries({ queryKey: usageOptions.queryKey });
        return queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
      },
    }),
  );

  const full = usage ? !roomFor(usage.limits.projects, usage.used.projects) : false;

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && !full) create.mutate({ title: title.trim(), brief: "" });
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
          disabled={create.isPending || full}
          className="rounded-lg border border-current/20 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </form>

      {create.error ? <p className="text-sm text-red-500">{create.error.message}</p> : null}
      {remove.error ? <p className="text-sm text-red-500">{remove.error.message}</p> : null}

      {usage && !isUnlimited(usage.limits.projects) ? (
        <p className="text-sm opacity-60">
          {usage.used.projects} of {usage.limits.projects} projects
          {full ? " — delete one to start another." : "."}
        </p>
      ) : null}

      {data?.items.length ? (
        <ul className="flex flex-col gap-px overflow-hidden rounded-xl border border-current/10 bg-current/10">
          {data.items.map((project) => (
            <li key={project.id} className="flex items-center bg-[var(--background)]">
              {confirming === project.id ? (
                <span
                  className="flex flex-1 items-center gap-2 px-5 py-4 text-sm"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setConfirming(null);
                  }}
                >
                  Delete “{project.title}”?
                  <button
                    type="button"
                    autoFocus
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: project.id })}
                    className="font-medium underline disabled:opacity-40"
                  >
                    {remove.isPending && remove.variables?.id === project.id ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="opacity-60 underline hover:opacity-100"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <Link href={`/projects/${project.id}`} className="flex-1 px-5 py-4">
                    <div className="text-sm font-medium">{project.title}</div>
                    <div className="text-sm opacity-60">
                      {project.brief || "No brief yet."}
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setConfirming(project.id)}
                    aria-label={`Delete ${project.title}`}
                    title="Delete project"
                    className="px-5 py-4 text-sm opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm opacity-60">No projects yet.</p>
      )}
    </div>
  );
}
