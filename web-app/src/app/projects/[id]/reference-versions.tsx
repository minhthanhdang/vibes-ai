"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { EDIT_INTENT_LIMIT, versionLabel } from "@/lib/reference-version";
import { useReferenceCrop, type CropStage } from "./crop-reference";

/// The other half of a reference's properties: not what this photograph is, but
/// the ways it has been used.
///
/// A version has no tile in the gallery on purpose — the grid is the photos of
/// the project, and a cut of one is not a second photo. It lives here instead,
/// under the frame it came out of, which is also where the director asks for it:
/// the prompt below is agent 3, and the row it produces appears in the list
/// above the moment it lands.

const STAGE_LABEL: Record<Exclude<CropStage, "idle">, string> = {
  asking: "Reading the frame…",
  cutting: "Cutting…",
  filing: "Saving…",
};

export function ReferenceVersions({
  projectId,
  referenceId,
}: {
  projectId: string;
  referenceId: string;
}) {
  const trpc = useTRPC();
  const { data: versions } = useQuery(trpc.reference.versions.queryOptions({ referenceId }));
  const { crop, stage, error, dismissError } = useReferenceCrop({ projectId, referenceId });
  const [prompt, setPrompt] = useState("");

  const busy = stage !== "idle";

  return (
    <section className="flex flex-col gap-3 border-t border-current/10 pt-4">
      <h3 className="text-[11px] font-medium tracking-widest uppercase opacity-45">Versions</h3>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          /// Cleared on submit rather than on success: the crop is out for
          /// seconds, and a field still holding the last prompt is one a
          /// director types the next one into the middle of.
          void crop(prompt);
          setPrompt("");
        }}
        className="flex gap-2"
      >
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={EDIT_INTENT_LIMIT}
          disabled={busy}
          placeholder="Crop to… e.g. just the hands"
          aria-label="What to crop this reference to"
          className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || prompt.trim().length === 0}
          className="shrink-0 rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-40"
        >
          Crop
        </button>
      </form>

      {busy ? (
        <p className="flex items-center gap-2 text-xs opacity-60" aria-live="polite">
          <span className="size-3 animate-spin rounded-full border-2 border-current/25 border-t-current" />
          {STAGE_LABEL[stage]}
        </p>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 text-xs text-red-500">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={dismissError} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </p>
      ) : null}

      {versions && versions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {versions.map((version) => (
            <li key={version.id} className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={version.thumbUrl}
                alt={versionLabel(version)}
                loading="lazy"
                className="size-12 shrink-0 rounded-md object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-xs" title={version.title}>
                {versionLabel(version)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !busy && (
          <p className="text-xs opacity-45">
            No versions yet. Ask for part of this frame and it is kept here, beside the original.
          </p>
        )
      )}
    </section>
  );
}
