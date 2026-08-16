"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { isUploadContentType, UPLOAD_CONTENT_TYPES } from "@/lib/image-types";
import { readImageForUpload, THUMBNAIL_CONTENT_TYPE } from "@/lib/thumbnail";

type TRPCClient = ReturnType<typeof useTRPCClient>;

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

export function ReferenceUploader({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [isDropTarget, setIsDropTarget] = useState(false);

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
    setFailures([]);
    setPending((count) => count + files.length);

    for (const file of files) {
      await upload(file).catch((error: Error) =>
        setFailures((current) => [...current, error.message]),
      );
      setPending((count) => count - 1);
      await queryClient.invalidateQueries({
        queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
      });
    }
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

      {pending ? <p className="opacity-60">Uploading {pending}…</p> : null}
      {failures.map((failure, index) => (
        <p key={index} className="text-red-500">
          {failure}
        </p>
      ))}
    </div>
  );
}
