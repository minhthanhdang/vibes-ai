import "server-only";
import { Storage } from "@google-cloud/storage";
import { bucketName, cloudEnv, developing, devBlobDir, devSigningSecret, env } from "@/env";
import { localObjectStore } from "@/server/storage/local-store";
import type { ObjectMetadata, ObjectStore } from "@/server/storage/object-store";

let cached: Storage | undefined;

function storage() {
  cached ??= new Storage({
    projectId: cloudEnv().GOOGLE_CLOUD_PROJECT,
    credentials: cloudEnv().GOOGLE_SERVICE_ACCOUNT_JSON,
  });
  return cached;
}

function fileIn(bucket: string, objectPath: string) {
  return storage().bucket(bucket).file(objectPath);
}

function ownFile(objectPath: string) {
  return fileIn(bucketName(), objectPath);
}

function isMissing(cause: unknown) {
  return (cause as { code?: unknown } | null)?.code === 404;
}

async function headOf(bucket: string, objectPath: string): Promise<ObjectMetadata | null> {
  try {
    const [metadata] = await fileIn(bucket, objectPath).getMetadata();
    return {
      size: metadata.size,
      generation: String(metadata.generation ?? ""),
      contentType: metadata.contentType,
      cacheControl: metadata.cacheControl,
      metadata: (metadata.metadata ?? {}) as Record<string, string>,
    };
  } catch (cause) {
    if (isMissing(cause)) return null;
    throw cause;
  }
}

export function gcsObjectStore(): ObjectStore {
  return {
    async save(objectPath, bytes, { contentType, cacheControl, metadata }) {
      await ownFile(objectPath).save(Buffer.from(bytes), {
        contentType,
        resumable: false,
        metadata: {
          ...(cacheControl && { cacheControl }),
          ...(metadata && { metadata }),
        },
      });
    },
    async remove(objectPath) {
      await ownFile(objectPath).delete({ ignoreNotFound: true });
    },
    async copy(fromObjectPath, toObjectPath) {
      await ownFile(fromObjectPath).copy(ownFile(toObjectPath));
    },
    head: (objectPath) => headOf(bucketName(), objectPath),
    async setCacheControl(objectPath, cacheControl) {
      await ownFile(objectPath).setMetadata({ cacheControl });
    },
    headIn: headOf,
    async download(bucket, objectPath) {
      const [bytes] = await fileIn(bucket, objectPath).download();
      return bytes;
    },
    async readUrl(bucket, objectPath, expiresAt) {
      const [url] = await fileIn(bucket, objectPath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAt,
      });
      return url;
    },
    async windowedReadUrl(bucket, objectPath, { accessibleAt, expires }) {
      const [url] = await fileIn(bucket, objectPath).getSignedUrl({
        version: "v4",
        action: "read",
        accessibleAt,
        expires,
      });
      return url;
    },
    async writeUrl(objectPath, { contentType, cacheControl, expiresAt }) {
      const [url] = await ownFile(objectPath).getSignedUrl({
        version: "v4",
        action: "write",
        contentType,
        ...(cacheControl && { extensionHeaders: { "cache-control": cacheControl } }),
        expires: expiresAt,
      });
      return url;
    },
  };
}

let store: ObjectStore | undefined;

export function objectStore(): ObjectStore {
  store ??= developing()
    ? localObjectStore(devBlobDir(), bucketName(), env().APP_URL, devSigningSecret())
    : gcsObjectStore();
  return store;
}

const GS_URI = /^gs:\/\/([^/]+)\/(.+)$/;

export function parseGcsUri(uri: string) {
  const match = GS_URI.exec(uri);
  if (!match) throw new Error(`not a gs:// uri: ${uri}`);
  return { bucket: match[1], object: match[2] };
}

export async function signedReadUrl(gcsUri: string) {
  const { bucket: name, object } = parseGcsUri(gcsUri);
  return objectStore().readUrl(name, object, Date.now() + env().SIGNED_URL_TTL_SECONDS * 1000);
}

export const READ_URL_BUCKET_MS = 3_600_000;
export const READ_URL_TTL_MS = 25 * 3_600_000;

export function readUrlWindow(now = Date.now()) {
  const accessibleAt = Math.floor(now / READ_URL_BUCKET_MS) * READ_URL_BUCKET_MS;
  return { accessibleAt, expires: accessibleAt + READ_URL_TTL_MS };
}

export async function deterministicReadUrl(gcsUri: string, now = Date.now()) {
  const { bucket: name, object } = parseGcsUri(gcsUri);
  return objectStore().windowedReadUrl(name, object, readUrlWindow(now));
}

export async function signedUploadUrl(
  objectPath: string,
  contentType: string,
  cacheControl?: string,
) {
  const url = await objectStore().writeUrl(objectPath, {
    contentType,
    cacheControl,
    expiresAt: Date.now() + env().SIGNED_URL_TTL_SECONDS * 1000,
  });
  return { url, gcsUri: `gs://${bucketName()}/${objectPath}` };
}

export function saveObject(
  objectPath: string,
  bytes: Uint8Array,
  options: { contentType: string; cacheControl?: string; metadata?: Record<string, string> },
) {
  return objectStore().save(objectPath, bytes, options);
}

export function deleteObject(objectPath: string) {
  return objectStore().remove(objectPath);
}

export function copyObject(fromObjectPath: string, toObjectPath: string) {
  return objectStore().copy(fromObjectPath, toObjectPath);
}

export function objectHead(objectPath: string) {
  return objectStore().head(objectPath);
}

export function setObjectCacheControl(objectPath: string, cacheControl: string) {
  return objectStore().setCacheControl(objectPath, cacheControl);
}

export async function objectGeneration(gcsUri: string) {
  const { bucket: name, object } = parseGcsUri(gcsUri);
  return (await objectStore().headIn(name, object))?.generation ?? null;
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

  const metadata = await objectStore().headIn(name, object);
  if (!metadata) throw new Error(`no such object: ${gcsUri}`);

  if (!fitsInOneFunction(metadata.size, maxBytes)) {
    const ceiling = Math.round(maxBytes / 1_000_000);
    throw new ObjectTooLargeError(
      metadata.size === undefined
        ? `${gcsUri} has no recorded size, so it cannot be held to the ${ceiling} MB this can read into one function`
        : `${gcsUri} is ${Math.round(Number(metadata.size) / 1_000_000)} MB, past the ${ceiling} MB this can read into one function`,
    );
  }

  return objectStore().download(name, object);
}
