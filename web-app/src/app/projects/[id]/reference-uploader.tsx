"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { isUploadContentType, UPLOAD_CONTENT_TYPES } from "@/lib/image-types";

/// The real pixel size, read before the bytes leave the browser — agent 3
/// needs it to denormalize Gemini's 0-1000 boxes, and nothing downstream
/// re-opens the object just to measure it.
async function readDimensions(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    return { width, height };
  } catch {
    return {};
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

    const { url, gcsUri } = await client.reference.uploadUrl.mutate({ projectId, contentType });
    // Content-Type is part of what the URL was signed for — a mismatch here is
    // a 403 from GCS, not a warning.
    const response = await fetch(url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": contentType },
    });
    if (!response.ok) throw new Error(`${file.name}: upload failed (${response.status})`);

    await client.reference.add.mutate({
      projectId,
      gcsUri,
      title: file.name,
      ...(await readDimensions(file)),
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
