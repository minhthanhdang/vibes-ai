"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { coalesceRuns } from "@/lib/util/coalesce";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import {
  hashFileContent,
  partitionDrop,
  HASH_LOOKUP_LIMIT,
  type HashedFile,
} from "@/lib/intake/content-hash";
import { sortDroppedFiles } from "@/lib/intake/drag-drop";
import { UPLOAD_CONTENT_TYPES } from "@/lib/intake/image-types";
import { uploadReference } from "./upload-reference";
import {
  retryableFiles,
  uploadFailure,
  withFailure,
  withoutFailures,
  type UploadFailure,
} from "@/lib/intake/upload-failures";
import type { usePendingUploads } from "./pending-uploads";
import { useFileDrop } from "./use-file-drop";

type TRPCClient = ReturnType<typeof useTRPCClient>;

/// A drop of twenty files used to run strictly one at a time, so the batch cost
/// the sum of every round trip. Three at once is the useful part of the win
/// without making the tab fight itself for decode and upstream bandwidth.
const UPLOAD_CONCURRENCY = 3;

/// Hashing is a disk read plus a digest rather than a round trip, so a few at
/// once is enough to keep a drop's files moving without thrashing the tab.
const HASH_CONCURRENCY = 4;

/// Which of these images the project already holds, in query-sized chunks.
/// Never rejects: the duplicate check is what saves an upload, not what
/// authorizes it, so a failed check falls back to uploading everything —
/// exactly the behaviour every project had before hashes existed.
async function hashesAlreadyInProject(client: TRPCClient, projectId: string, hashes: string[]) {
  const held = new Set<string>();
  try {
    for (let start = 0; start < hashes.length; start += HASH_LOOKUP_LIMIT) {
      const found = await client.reference.existingHashes.query({
        projectId,
        contentHashes: hashes.slice(start, start + HASH_LOOKUP_LIMIT),
      });
      for (const hash of found) held.add(hash);
    }
  } catch {
    return new Set<string>();
  }
  return held;
}

export function ReferenceUploader({
  projectId,
  uploads,
}: {
  projectId: string;
  uploads: ReturnType<typeof usePendingUploads>;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  /// Every landing row wants the gallery refetched, and the list it refetches
  /// gets longer as the batch lands — so one refetch per file is the most
  /// expensive possible schedule. Collapsed to one refetch in flight plus one
  /// queued behind it, which is still fresh enough to release a placeholder:
  /// a coalesced request only settles on a refetch that started after it.
  /// Measured over 24 files at concurrency 3: 25 list fetches down to 10.
  const refreshGallery = useMemo(
    () =>
      coalesceRuns(() =>
        queryClient.invalidateQueries({
          queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
        }),
      ),
    [queryClient, trpc, projectId],
  );

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  /// Keeps the File, not just the message: a batch where three of twenty failed
  /// can only be finished by re-sending those three — re-dropping the folder
  /// makes the user pick them out again and the tab re-read all twenty.
  const [failures, setFailures] = useState<UploadFailure[]>([]);
  /// Not errors — the user dropped the folder again and the project already
  /// holds these — but silence would read as the drop having been ignored.
  const [skipped, setSkipped] = useState<File[]>([]);
  /// Mirrors the in-flight count outside React so a second drop can tell
  /// whether it is joining a running batch or starting a fresh one — a state
  /// updater cannot answer that, since updaters have to stay pure.
  const inFlight = useRef(0);

  async function upload({ file, contentType, contentHash }: HashedFile) {
    await uploadReference(client, projectId, {
      file,
      contentType,
      contentHash,
      title: file.name,
    });
  }

  async function uploadAll(dropped: File[]) {
    if (!dropped.length) return;
    const { uploadable, unsupported } = sortDroppedFiles(dropped);

    if (inFlight.current === 0) {
      setProgress({ done: 0, total: 0 });
      setSkipped([]);
    }

    /// The batch clears its own lines and no one else's, which is what makes a
    /// retry a plain re-drop of one file: it erases that file's error, and the
    /// errors of the files it is not retrying survive.
    /// Unsupported formats are rejected up front rather than inside the worker,
    /// so a PDF dragged in with the photos never gets a placeholder tile that
    /// vanishes a moment later.
    setFailures((current) => [
      ...withoutFailures(current, dropped),
      ...unsupported.map((file) => uploadFailure(file, "unsupported format", false)),
    ]);
    if (!uploadable.length) return;

    /// The grid stays empty until this resolves, which is the whole cost of
    /// asking before uploading rather than after: a dropped folder has to be
    /// read off disk to be hashed. The alternative pays worse — a placeholder
    /// tile per duplicate that appears and then vanishes, and a second copy of
    /// every already-held photo's bytes uploaded to find that out.
    const hashed: HashedFile[] = [];
    const unreadable: File[] = [];
    const digests = await mapWithConcurrency(uploadable, HASH_CONCURRENCY, async (item) => ({
      ...item,
      contentHash: await hashFileContent(item.file),
    }));
    digests.forEach((digest, index) => {
      if (digest.status === "fulfilled") hashed.push(digest.value);
      else unreadable.push(uploadable[index]!.file);
    });
    if (unreadable.length) {
      setFailures((current) =>
        unreadable.reduce(
          (list, file) => withFailure(list, uploadFailure(file, "could not be read", true)),
          current,
        ),
      );
    }

    const alreadyHeld = await hashesAlreadyInProject(client, projectId, [
      ...new Set(hashed.map((item) => item.contentHash)),
    ]);
    const { fresh, duplicates } = partitionDrop(hashed, alreadyHeld);
    if (duplicates.length) {
      setSkipped((current) => [...current, ...duplicates.map((item) => item.file)]);
    }
    if (!fresh.length) return;

    inFlight.current += fresh.length;
    setProgress((current) => ({ ...current, total: current.total + fresh.length }));

    const entries = uploads.start(fresh.map((item) => item.file));
    await mapWithConcurrency(entries, UPLOAD_CONCURRENCY, async (entry, index) => {
      let landed = true;
      try {
        await upload(fresh[index]!);
      } catch (error) {
        landed = false;
        setFailures((current) =>
          withFailure(current, uploadFailure(entry.file, (error as Error).message, true)),
        );
      } finally {
        inFlight.current -= 1;
        setProgress((current) => ({ ...current, done: current.done + 1 }));
      }

      /// A file that failed has no row coming, so its placeholder goes now
      /// rather than after a refetch that cannot contain it.
      if (!landed) return uploads.finish(entry);

      /// Deliberately not awaited: a worker that waits for the gallery to
      /// refetch before picking up the next file pays a list round trip per
      /// file, on a list that is getting longer as the batch lands. The
      /// placeholder still only goes once a refetch that includes this row
      /// has landed — dropping it earlier leaves a gap in the grid where the
      /// tile is about to appear.
      void refreshGallery()
        .catch(() => undefined)
        .then(() => uploads.finish(entry));
    });
  }

  /// The whole page is the drop target; this component only owns what happens
  /// to the files. Nothing here listens for a drop of its own — two handlers
  /// firing on the same drop would upload the batch twice.
  const isDragging = useFileDrop((files) => void uploadAll(files));
  const retryable = retryableFiles(failures);

  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-sm transition-colors ${
        isDragging ? "border-current/60 bg-current/5" : "border-current/20"
      }`}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={UPLOAD_CONTENT_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          void uploadAll([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />

      <p className="opacity-60">Drop reference images here</p>
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="rounded-lg border border-current/20 px-4 py-2 font-medium"
      >
        Choose files
      </button>

      {progress.done < progress.total ? (
        <div className="flex w-full max-w-xs flex-col gap-2">
          <p className="text-center opacity-60">
            Uploaded {progress.done} of {progress.total}…
          </p>
          <div
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemax={progress.total}
            className="h-1 overflow-hidden rounded-full bg-current/10"
          >
            <div
              className="h-full bg-current/40 transition-[width] duration-200"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      ) : null}
      {skipped.length ? (
        <p className="text-xs opacity-60" title={skipped.map((file) => file.name).join("\n")}>
          Skipped {skipped.length} already in this project.{" "}
          <button
            type="button"
            onClick={() => setSkipped([])}
            className="underline underline-offset-2"
          >
            Dismiss
          </button>
        </p>
      ) : null}
      {failures.length ? (
        <ul className="flex w-full max-w-md flex-col gap-1 text-xs">
          {failures.map((failure) => (
            <li key={failure.key} className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-red-500" title={failure.reason}>
                {failure.file.name}: {failure.reason}
              </span>
              <button
                type="button"
                onClick={() =>
                  failure.retryable
                    ? void uploadAll([failure.file])
                    : setFailures((current) => withoutFailures(current, [failure.file]))
                }
                className="shrink-0 underline underline-offset-2 opacity-60 hover:opacity-100"
              >
                {failure.retryable ? "Retry" : "Dismiss"}
              </button>
            </li>
          ))}
          {retryable.length > 1 ? (
            <li className="flex justify-end">
              <button
                type="button"
                onClick={() => void uploadAll(retryable)}
                className="rounded-lg border border-current/20 px-3 py-1 font-medium"
              >
                Retry all {retryable.length}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Only visible while a drag is in progress, and transparent to the
          pointer so it cannot steal the drop from the window listener. */}
      {isDragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[var(--background)]/80">
          <p className="rounded-xl border border-dashed border-current/40 px-8 py-6 text-base font-medium">
            Drop to add to this project
          </p>
        </div>
      ) : null}
    </div>
  );
}
