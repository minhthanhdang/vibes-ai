"use client";

import { readImageForUpload, THUMBNAIL_CONTENT_TYPE } from "@/lib/intake/thumbnail";
import type { UploadContentType } from "@/lib/intake/image-types";
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
export async function uploadThumbnail(client: TRPCClient, projectId: string, thumbnail: Blob) {
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

/// The bytes in the bucket, and what the row that claims them will need.
type StoredBytes = {
  gcsUri: string;
  thumbGcsUri?: string;
  width?: number;
  height?: number;
};

async function storeBytes(
  client: TRPCClient,
  projectId: string,
  file: File,
  contentType: UploadContentType,
): Promise<StoredBytes> {
  /// Decoded before the bytes leave the browser: the pixel size agent 3 needs
  /// to denormalize Gemini's 0-1000 boxes, and the grid-sized copy.
  const { thumbnail, ...dimensions } = await readImageForUpload(file);

  const { url, gcsUri } = await client.reference.uploadUrl.mutate({ projectId, contentType });
  await putObject(url, file, contentType);

  /// A thumbnail that will not upload is bandwidth, not correctness, and
  /// `uploadThumbnail` already answers `undefined` rather than throwing — so
  /// past this point the only thing that can fail is the row.
  const thumbGcsUri = thumbnail ? await uploadThumbnail(client, projectId, thumbnail) : undefined;
  return { gcsUri, thumbGcsUri, ...dimensions };
}

/// Past the PUT the bytes are in the bucket with nothing pointing at them. If
/// the row never lands they are invisible to the gallery and to every delete
/// path, so they have to be handed back rather than paid for forever.
async function claimed<T>(
  client: TRPCClient,
  projectId: string,
  stored: StoredBytes,
  row: () => Promise<T>,
) {
  try {
    return await row();
  } catch (error) {
    await client.reference.discardUpload
      .mutate({
        projectId,
        gcsUris: [stored.gcsUri, stored.thumbGcsUri].filter((uri) => uri !== undefined),
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function uploadReference(
  client: TRPCClient,
  projectId: string,
  { file, contentType, contentHash, title }: ReferenceUpload,
) {
  const stored = await storeBytes(client, projectId, file, contentType);
  return claimed(client, projectId, stored, () =>
    client.reference.add.mutate({ projectId, title, contentHash, ...stored }),
  );
}

/// A cut of a frame, filed as a *modified version* of it rather than as a photo
/// of the project — the same bytes-then-row dance, ending at the one mutation
/// that writes the columns that make a reference a version.
///
/// The title is not passed: what a cut of a frame is called follows from the
/// frame, and `addVersion` derives it from the source it just read.
export type ReferenceVersionUpload = {
  file: File;
  contentType: UploadContentType;
  contentHash: string;
  sourceReferenceId: string;
  editIntent: string;
  /// What the cropper said about this box. Omitted by a crop the director drew
  /// on the board — that one had no model behind it to explain itself.
  editRationale?: string;
  cropBox: number[];
  /// The format the box was held to, when the ask named one. Omitted by a crop
  /// drawn by hand and by an ask at no particular shape — both of which are cuts
  /// at whatever shape that part of the frame happens to be.
  editAspect?: string;
};

export async function uploadVersion(
  client: TRPCClient,
  projectId: string,
  { file, contentType, contentHash, ...version }: ReferenceVersionUpload,
) {
  const stored = await storeBytes(client, projectId, file, contentType);
  return claimed(client, projectId, stored, () =>
    client.reference.addVersion.mutate({ projectId, contentHash, ...version, ...stored }),
  );
}
