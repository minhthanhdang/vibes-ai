import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { bucket, signedUploadUrl } from "@/server/google/storage";
import { IMAGE_EXTENSIONS, type UploadContentType } from "@/lib/intake/image-types";

const prefixOf = (projectId: string) => `projects/${projectId}/references/`;

function newObjectPath(projectId: string, contentType: UploadContentType) {
  return `${prefixOf(projectId)}${randomUUID()}.${IMAGE_EXTENSIONS[contentType]}`;
}

export function referenceUploadUrl(projectId: string, contentType: UploadContentType) {
  return signedUploadUrl(newObjectPath(projectId, contentType), contentType);
}

export async function storeProjectUpload(
  projectId: string,
  contentType: UploadContentType,
  bytes: Uint8Array,
) {
  const objectPath = newObjectPath(projectId, contentType);
  await bucket().file(objectPath).save(Buffer.from(bytes), { contentType, resumable: false });
  return `gs://${env().GCS_BUCKET}/${objectPath}`;
}

export function uploadObjectPath(projectId: string, gcsUri: string) {
  const bucketPrefix = `gs://${env().GCS_BUCKET}/`;
  if (!gcsUri.startsWith(bucketPrefix)) return null;

  const objectPath = gcsUri.slice(bucketPrefix.length);
  const projectPrefix = prefixOf(projectId);
  if (!objectPath.startsWith(projectPrefix) || objectPath === projectPrefix) return null;
  return objectPath;
}

export function isProjectUpload(projectId: string, gcsUri: string) {
  return uploadObjectPath(projectId, gcsUri) !== null;
}

export function discardableUploads(
  projectId: string,
  gcsUris: string[],
  stillReferenced: ReadonlySet<string>,
) {
  return [...new Set(gcsUris)].filter(
    (gcsUri) => uploadObjectPath(projectId, gcsUri) !== null && !stillReferenced.has(gcsUri),
  );
}

export async function deleteProjectUpload(projectId: string, gcsUri: string) {
  const objectPath = uploadObjectPath(projectId, gcsUri);
  if (!objectPath) return false;

  await bucket().file(objectPath).delete({ ignoreNotFound: true });
  return true;
}
