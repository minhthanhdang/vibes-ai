"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { mapWithConcurrency } from "@/lib/concurrency";
import { isUploadContentType, UPLOAD_CONTENT_TYPES } from "@/lib/image-types";
import { readImageForUpload, THUMBNAIL_CONTENT_TYPE } from "@/lib/thumbnail";
import type { usePendingUploads } from "./pending-uploads";

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
  const [isDropTarget, setIsDropTarget] = useState(false);
  /// Mirrors the in-flight count outside React so a second drop can tell
  /// whether it is joining a running batch or starting a fresh one — a state
  /// updater cannot answer that, since updaters have to stay pure.
  const inFlight = useRef(0);

  async function upload(file: File) {
    const contentType = file.type;
    if (!isUploadContentType(contentType)) throw new Error(`${file.name}: unsupported format`);

    /// Decoded before the bytes leave the browser: the pixel size agent 3 needs
    /// to denormalize Gemini's 0-1000 boxes, and the grid-sized copy.
    const { thumbnail, ...dimensions } = await readImageForUpload(file);

    const { url, gcsUri } = await client.reference.uploadUrl.mutate({ projectId, contentType });
    await putObject(url, file, contentType).catch((error: Error) => {
      throw new Error(`${file.name}: ${error.message}`);
    });

    await client.reference.add.mutate({
      projectId,
      gcsUri,
      thumbGcsUri: thumbnail ? await uploadThumbnail(client, projectId, thumbnail) : undefined,
      title: file.name,
      ...dimensions,
    });
  }

  async function uploadAll(files: File[]) {
    if (!files.length) return;

    if (inFlight.current === 0) {
      setFailures([]);
      setProgress({ done: 0, total: 0 });
    }
    inFlight.current += files.length;
    setProgress((current) => ({ ...current, total: current.total + files.length }));

    await mapWithConcurrency(uploads.start(files), UPLOAD_CONCURRENCY, async (entry) => {
      try {
        await upload(entry.file);
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

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDropTarget(false);
        void uploadAll([...event.dataTransfer.files]);
      }}
      className={`flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-sm transition-colors ${
        isDropTarget ? "border-current/60 bg-current/5" : "border-current/20"
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
    </div>
  );
}
