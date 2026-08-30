"use client";

import { readImageForUpload, THUMBNAIL_CONTENT_TYPE } from "@/lib/intake/thumbnail";
import { IMMUTABLE_CACHE_CONTROL, type UploadContentType } from "@/lib/intake/image-types";
import type { useTRPCClient } from "@/trpc/react";

type TRPCClient = ReturnType<typeof useTRPCClient>;

export type ReferenceUpload = {
  file: File;
  contentType: UploadContentType;
  contentHash: string;
  title: string;
};

async function putObject(url: string, body: Blob, contentType: string) {
  const response = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE_CACHE_CONTROL },
  });
  if (!response.ok) throw new Error(`upload failed (${response.status})`);
}

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
  const { thumbnail, ...dimensions } = await readImageForUpload(file);

  const { url, gcsUri } = await client.reference.uploadUrl.mutate({ projectId, contentType });
  await putObject(url, file, contentType);

  const thumbGcsUri = thumbnail ? await uploadThumbnail(client, projectId, thumbnail) : undefined;
  return { gcsUri, thumbGcsUri, ...dimensions };
}

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

export type ReferenceVersionUpload = {
  file: File;
  contentType: UploadContentType;
  contentHash: string;
  sourceReferenceId: string;
  editIntent: string;
  editRationale?: string;
  cropBox: number[];
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
