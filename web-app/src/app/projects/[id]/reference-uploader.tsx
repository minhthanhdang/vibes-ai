"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { coalesceRuns } from "@/lib/coalesce";
import { mapWithConcurrency } from "@/lib/concurrency";
import { sortDroppedFiles } from "@/lib/drag-drop";
import { UPLOAD_CONTENT_TYPES, type UploadContentType } from "@/lib/image-types";
import { readImageForUpload, THUMBNAIL_CONTENT_TYPE } from "@/lib/thumbnail";
import {
  retryableFiles,
  uploadFailure,
  withFailure,
  withoutFailures,
  type UploadFailure,
} from "@/lib/upload-failures";
import type { usePendingUploads } from "./pending-uploads";
import { useFileDrop } from "./use-file-drop";

type TRPCClient = ReturnType<typeof useTRPCClient>;

/// A drop of twenty files used to run strictly one at a time, so the batch cost
/// the sum of every round trip. Three at once is the useful part of the win
/// without making the tab fight itself for decode and upstream bandwidth.
const UPLOAD_CONCURRENCY = 3;

async function putObject(url: string, body: Blob, contentType: string) {
  // Content-Type is part of what the URL was signed for — a mismatch here is
  // a 403 from GCS, not a warning.
  const response = await fetch(url, { method: "PUT", body, headers: { "Content-Type": contentType } });
  if (!response.ok) throw new Error(`upload failed (${response.status})`);
}

/// A missing thumbnail costs bandwidth, not correctness — the gallery falls
/// back to the original — so a failed thumbnail upload must not fail the file.
async function uploadThumbnail(client: TRPCClient, projectId: string, thumbnail: Blob) {
  try {
    const { url, gcsUri } = await client.reference.uploadUrl.mutate({
      projectId,
      contentType: THUMBNAIL_CONTENT_TYPE,
    });
    await putObject(url, thumbnail, THUMBNAIL_CONTENT_TYPE);
    return gcsUri;
  } catch {
    return undefined;
  }
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
  /// would upload the seventeen that landed a second time.
  const [failures, setFailures] = useState<UploadFailure[]>([]);
  /// Mirrors the in-flight count outside React so a second drop can tell
  /// whether it is joining a running batch or starting a fresh one — a state
  /// updater cannot answer that, since updaters have to stay pure.
  const inFlight = useRef(0);

  async function upload(file: File, contentType: UploadContentType) {
    /// Decoded before the bytes leave the browser: the pixel size agent 3 needs
    /// to denormalize Gemini's 0-1000 boxes, and the grid-sized copy.
    const { thumbnail, ...dimensions } = await readImageForUpload(file);

    const { url, gcsUri } = await client.reference.uploadUrl.mutate({ projectId, contentType });
    await putObject(url, file, contentType);

    /// Past this line the bytes are in the bucket with nothing pointing at them.
    /// If the row never lands they are invisible to the gallery and to every
    /// delete path, so they have to be handed back rather than left to be paid
    /// for forever.
    let thumbGcsUri: string | undefined;
    try {
      thumbGcsUri = thumbnail ? await uploadThumbnail(client, projectId, thumbnail) : undefined;
      await client.reference.add.mutate({
        projectId,
        gcsUri,
        thumbGcsUri,
        title: file.name,
        ...dimensions,
      });
    } catch (error) {
      await client.reference.discardUpload
        .mutate({ projectId, gcsUris: [gcsUri, thumbGcsUri].filter((uri) => uri !== undefined) })
        .catch(() => undefined);
      throw error;
    }
  }

  async function uploadAll(dropped: File[]) {
    if (!dropped.length) return;
    const { uploadable, unsupported } = sortDroppedFiles(dropped);

    if (inFlight.current === 0) setProgress({ done: 0, total: 0 });

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

    inFlight.current += uploadable.length;
    setProgress((current) => ({ ...current, total: current.total + uploadable.length }));

    const entries = uploads.start(uploadable.map((item) => item.file));
    await mapWithConcurrency(entries, UPLOAD_CONCURRENCY, async (entry, index) => {
      let landed = true;
      try {
        await upload(entry.file, uploadable[index]!.contentType);
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
