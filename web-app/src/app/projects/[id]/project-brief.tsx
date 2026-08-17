"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";

/// The user's own statement of what this project is for.
///
/// The column has existed since the first schema and the header has rendered it
/// since the first workspace; what neither had was a way to write it, so its
/// only value was the empty string the create form sends. It is now primed into
/// every turn the assistant takes, which is what makes the door worth building:
/// this is the one piece of context in a turn that nothing derived.
///
/// Held in local state after a save rather than refetched. The page is a server
/// component, so the alternative is a route refresh to redraw one paragraph the
/// browser already has.
export function ProjectBrief({ projectId, brief }: { projectId: string; brief: string }) {
  const trpc = useTRPC();
  const [saved, setSaved] = useState(brief);
  const [draft, setDraft] = useState<string | null>(null);

  const save = useMutation(
    trpc.project.setBrief.mutationOptions({
      onSuccess: ({ brief: written }) => {
        setSaved(written);
        setDraft(null);
      },
    }),
  );

  if (draft === null) {
    return (
      <div className="flex max-w-2xl items-start gap-2">
        <p className={`text-sm ${saved ? "opacity-60" : "opacity-40"}`}>
          {saved || "No brief yet — say what this project is for and the assistant reads it."}
        </p>
        <button
          type="button"
          onClick={() => setDraft(saved)}
          className="shrink-0 text-xs opacity-50 underline-offset-2 hover:underline hover:opacity-90"
        >
          {saved ? "Edit" : "Write one"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col items-start gap-2">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={5000}
        rows={4}
        autoFocus
        aria-label="Project brief"
        placeholder="What is this project for? The look, the reference, the scene."
        className="w-full rounded-lg border border-current/15 bg-transparent p-3 text-sm outline-none focus:border-current/40"
      />
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ id: projectId, brief: draft.trim() })}
          className="rounded-full border border-current/20 px-3 py-1 hover:bg-current/10 disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save brief"}
        </button>
        <button
          type="button"
          onClick={() => setDraft(null)}
          className="opacity-50 hover:opacity-90"
        >
          Cancel
        </button>
        {/* The whole point of the field is that the assistant reads it, and a
            user who does not know that writes nothing worth reading. */}
        <span className="opacity-40">The assistant reads this on every message.</span>
        {save.isError ? <span className="opacity-70">Could not save — try again.</span> : null}
      </div>
    </div>
  );
}
