import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { bucket, signedUploadUrl } from "@/server/google/storage";
import { IMAGE_EXTENSIONS, type UploadContentType } from "@/lib/image-types";

/// Every object a project owns lives under one prefix, which is what makes the
/// locator the client hands back verifiable.
const prefixOf = (projectId: string) => `projects/${projectId}/references/`;

/// Named with the extension of the type it was signed for — `contentTypeOfUri`
/// reads the mime type back out of the locator, so the object's name is the
/// only record of it we need.
function newObjectPath(projectId: string, contentType: UploadContentType) {
  return `${prefixOf(projectId)}${randomUUID()}.${IMAGE_EXTENSIONS[contentType]}`;
}

export function referenceUploadUrl(projectId: string, contentType: UploadContentType) {
  return signedUploadUrl(newObjectPath(projectId, contentType), contentType);
}

/// The upload that does not come from a browser: an image dragged in from a web
/// page is fetched by the server, so its bytes are already here and a signed URL
/// handed back to the client would only send them out and in again.
export async function storeProjectUpload(
  projectId: string,
  contentType: UploadContentType,
  bytes: Uint8Array,
) {
  const objectPath = newObjectPath(projectId, contentType);
  await bucket().file(objectPath).save(Buffer.from(bytes), { contentType, resumable: false });
  return `gs://${env().GCS_BUCKET}/${objectPath}`;
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

/// The bytes land before the row does, so a failed `add` leaves an object
/// nothing points at — invisible in the gallery and paid for forever. This is
/// which of the uris the browser hands back may be thrown away: inside the
/// project's own prefix, and not claimed by a row, so a stale or replayed
/// discard cannot delete a tile's image out from under it.
export function discardableUploads(
  projectId: string,
  gcsUris: string[],
  stillReferenced: ReadonlySet<string>,
) {
  return [...new Set(gcsUris)].filter(
    (gcsUri) => uploadObjectPath(projectId, gcsUri) !== null && !stillReferenced.has(gcsUri),
  );
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
