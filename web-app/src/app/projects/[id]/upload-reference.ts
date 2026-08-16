"use client";

import { readImageForUpload, THUMBNAIL_CONTENT_TYPE } from "@/lib/thumbnail";
import type { UploadContentType } from "@/lib/image-types";
import type { useTRPCClient } from "@/trpc/react";

/// One image becoming one `Reference`: bytes to the bucket, a thumbnail beside
/// them, then the row that makes both visible. Shared by the gallery's dropzone
/// and by the moodboard adopting an image pasted onto the board, so the two
/// cannot drift on the part that is easy to get wrong — the window between the
/// PUT landing and the row landing, where bytes exist that nothing points at.

type TRPCClient = ReturnType<typeof useTRPCClient>;

export type ReferenceUpload = {
  file: File;
  contentType: UploadContentType;
  contentHash: string;
  title: string;
};

async function putObject(url: string, body: Blob, contentType: string) {
  // Content-Type is part of what the URL was signed for — a mismatch here is
  // a 403 from GCS, not a warning.
  const response = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
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

export async function uploadReference(
  client: TRPCClient,
  projectId: string,
  { file, contentType, contentHash, title }: ReferenceUpload,
) {
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
    return await client.reference.add.mutate({
      projectId,
      gcsUri,
      thumbGcsUri,
      title,
      contentHash,
      ...dimensions,
    });
  } catch (error) {
    await client.reference.discardUpload
      .mutate({ projectId, gcsUris: [gcsUri, thumbGcsUri].filter((uri) => uri !== undefined) })
      .catch(() => undefined);
    throw error;
  }
}
