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
import { uploadReference } from "../../../_reference/utils/upload-reference";
import {
  retryableFiles,
  uploadFailure,
  withFailure,
  withoutFailures,
  type UploadFailure,
} from "@/lib/intake/upload-failures";
import { finishUpload, startUploads } from "../stores/use-pending-uploads-store";
import { useFileDrop } from "../hooks/use-file-drop";

type TRPCClient = ReturnType<typeof useTRPCClient>;

const UPLOAD_CONCURRENCY = 3;

const HASH_CONCURRENCY = 4;

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

export function GalleryUploader({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

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
  const [failures, setFailures] = useState<UploadFailure[]>([]);
  const [skipped, setSkipped] = useState<File[]>([]);
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

    setFailures((current) => [
      ...withoutFailures(current, dropped),
      ...unsupported.map((file) => uploadFailure(file, "unsupported format", false)),
    ]);
    if (!uploadable.length) return;

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

    const entries = startUploads(fresh.map((item) => item.file));
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

      if (!landed) return finishUpload(entry);

      void refreshGallery()
        .catch(() => undefined)
        .then(() => finishUpload(entry));
    });
  }

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
