import "server-only";
import { Storage } from "@google-cloud/storage";
import { env } from "@/env";

let cached: Storage | undefined;

function storage() {
  cached ??= new Storage({
    projectId: env().GOOGLE_CLOUD_PROJECT,
    credentials: env().GOOGLE_SERVICE_ACCOUNT_JSON,
  });
  return cached;
}

export function bucket() {
  return storage().bucket(env().GCS_BUCKET);
}

const GS_URI = /^gs:\/\/([^/]+)\/(.+)$/;

export function parseGcsUri(uri: string) {
  const match = GS_URI.exec(uri);
  if (!match) throw new Error(`not a gs:// uri: ${uri}`);
  return { bucket: match[1], object: match[2] };
}

export async function signedReadUrl(gcsUri: string) {
  const { bucket: name, object } = parseGcsUri(gcsUri);
  const [url] = await storage()
    .bucket(name)
    .file(object)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + env().SIGNED_URL_TTL_SECONDS * 1000,
    });
  return url;
}

export async function signedUploadUrl(objectPath: string, contentType: string) {
  const [url] = await bucket()
    .file(objectPath)
    .getSignedUrl({
      version: "v4",
      action: "write",
      contentType,
      expires: Date.now() + env().SIGNED_URL_TTL_SECONDS * 1000,
    });
  return { url, gcsUri: `gs://${env().GCS_BUCKET}/${objectPath}` };
}

export class ObjectTooLargeError extends Error {
  override readonly name = "ObjectTooLargeError";
}

export function isObjectTooLarge(cause: unknown): cause is ObjectTooLargeError {
  return cause instanceof Error && cause.name === "ObjectTooLargeError";
}

export function fitsInOneFunction(recordedSize: string | number | undefined, maxBytes: number) {
  return Number(recordedSize ?? NaN) <= maxBytes;
}

export async function readObject(gcsUri: string, maxBytes: number) {
  const { bucket: name, object } = parseGcsUri(gcsUri);
  const file = storage().bucket(name).file(object);

  const [metadata] = await file.getMetadata();
  if (!fitsInOneFunction(metadata.size, maxBytes)) {
    const ceiling = Math.round(maxBytes / 1_000_000);
    throw new ObjectTooLargeError(
      metadata.size === undefined
        ? `${gcsUri} has no recorded size, so it cannot be held to the ${ceiling} MB this can read into one function`
        : `${gcsUri} is ${Math.round(Number(metadata.size) / 1_000_000)} MB, past the ${ceiling} MB this can read into one function`,
    );
  }

  const [bytes] = await file.download();
  return bytes;
}
