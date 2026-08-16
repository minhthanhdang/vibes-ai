"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { mapWithConcurrency } from "@/lib/concurrency";
import { sortDroppedFiles } from "@/lib/drag-drop";
import { UPLOAD_CONTENT_TYPES, type UploadContentType } from "@/lib/image-types";
import { readImageForUpload, THUMBNAIL_CONTENT_TYPE } from "@/lib/thumbnail";
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

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failures, setFailures] = useState<string[]>([]);
  /// Mirrors the in-flight count outside React so a second drop can tell
  /// whether it is joining a running batch or starting a fresh one — a state
  /// updater cannot answer that, since updaters have to stay pure.
  const inFlight = useRef(0);

  async function upload(file: File, contentType: UploadContentType) {
    /// Decoded before the bytes leave the browser: the pixel size agent 3 needs
    /// to denormalize Gemini's 0-1000 boxes, and the grid-sized copy.
    const { thumbnail, ...dimensions } = await readImageForUpload(file);

    const { url, gcsUri } = await client.reference.uploadUrl.mutate({ projectId, contentType });
    await putObject(url, file, contentType).catch((error: Error) => {
      throw new Error(`${file.name}: ${error.message}`);
    });

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
      throw new Error(`${file.name}: ${(error as Error).message}`);
    }
  }

  async function uploadAll(dropped: File[]) {
    if (!dropped.length) return;
    const { uploadable, unsupported } = sortDroppedFiles(dropped);

    if (inFlight.current === 0) {
      setFailures([]);
      setProgress({ done: 0, total: 0 });
    }
    /// Rejected up front rather than inside the worker, so a PDF dragged in with
    /// the photos never gets a placeholder tile that vanishes a moment later.
    if (unsupported.length) {
      setFailures((current) => [
        ...current,
        ...unsupported.map((file) => `${file.name}: unsupported format`),
      ]);
    }
    if (!uploadable.length) return;

    inFlight.current += uploadable.length;
    setProgress((current) => ({ ...current, total: current.total + uploadable.length }));

    const entries = uploads.start(uploadable.map((item) => item.file));
    await mapWithConcurrency(entries, UPLOAD_CONCURRENCY, async (entry, index) => {
      try {
        await upload(entry.file, uploadable[index]!.contentType);
      } catch (error) {
        setFailures((current) => [...current, (error as Error).message]);
      } finally {
        inFlight.current -= 1;
        setProgress((current) => ({ ...current, done: current.done + 1 }));
      }
      // Per file rather than per batch, so tiles appear as they land. The list
      // query is cheap to refetch — tile srcs are stable app paths, so this
      // costs no image bytes.
      await queryClient.invalidateQueries({
        queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
      });
      /// Only once the real row is in the cache — dropping the placeholder any
      /// earlier leaves a gap in the grid where the tile is about to appear.
      uploads.finish(entry);
    });
  }

  /// The whole page is the drop target; this component only owns what happens
  /// to the files. Nothing here listens for a drop of its own — two handlers
  /// firing on the same drop would upload the batch twice.
  const isDragging = useFileDrop((files) => void uploadAll(files));

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
      {failures.map((failure, index) => (
        <p key={index} className="text-red-500">
          {failure}
        </p>
      ))}

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
