import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { bucket, signedUploadUrl } from "@/server/google/storage";
import { IMAGE_EXTENSIONS, type UploadContentType } from "@/lib/image-types";

/// Every object a project owns lives under one prefix, which is what makes the
/// locator the client hands back verifiable.
const prefixOf = (projectId: string) => `projects/${projectId}/references/`;

export function referenceUploadUrl(projectId: string, contentType: UploadContentType) {
  const objectPath = `${prefixOf(projectId)}${randomUUID()}.${IMAGE_EXTENSIONS[contentType]}`;
  return signedUploadUrl(objectPath, contentType);
}

/// The object path if the uri names one of this project's own uploads, null
/// otherwise. The browser PUTs the bytes and then tells us where they landed,
/// so the uri is client input: anything outside this project's prefix is a
/// forged locator, not an upload.
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

/// Removing the row is what takes an image out of the gallery; this is what
/// stops us paying to store its bytes afterwards. Scoped to the project's own
/// upload prefix, so a row pointing anywhere else — a seeded object, an
/// artifact a later agent shares with a crop — is left where it is, and
/// answers false rather than deleting it.
export async function deleteProjectUpload(projectId: string, gcsUri: string) {
  const objectPath = uploadObjectPath(projectId, gcsUri);
  if (!objectPath) return false;

  await bucket().file(objectPath).delete({ ignoreNotFound: true });
  return true;
}
