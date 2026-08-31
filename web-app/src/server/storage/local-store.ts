import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { grantUrl, type Grant } from "./dev-signing";
import type { ObjectMetadata, ObjectStore } from "./object-store";

export type Sidecar = {
  contentType?: string;
  cacheControl?: string;
  metadata: Record<string, string>;
};

const BUCKET = /^[a-z0-9][a-z0-9._-]{1,221}$/;

const SIDECAR_SUFFIX = ".meta.json";

export class UnsafeObjectPathError extends Error {
  override readonly name = "UnsafeObjectPathError";
}

export function objectLocation(root: string, bucket: string, object: string) {
  if (!BUCKET.test(bucket)) throw new UnsafeObjectPathError(`not a bucket name: ${bucket}`);
  if (!object || object.startsWith("/") || object.includes("\0")) {
    throw new UnsafeObjectPathError(`not an object path: ${object}`);
  }
  const segments = object.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new UnsafeObjectPathError(`not an object path: ${object}`);
  }

  const under = resolve(root, bucket);
  const file = resolve(under, ...segments);
  if (file !== under && !file.startsWith(under + sep)) {
    throw new UnsafeObjectPathError(`${object} climbs out of ${bucket}`);
  }
  return { file, sidecar: `${file}${SIDECAR_SUFFIX}` };
}

function missing(cause: unknown) {
  return (cause as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

async function sidecarAt(path: string): Promise<Sidecar> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<Sidecar>;
    return {
      ...(parsed.contentType && { contentType: parsed.contentType }),
      ...(parsed.cacheControl && { cacheControl: parsed.cacheControl }),
      metadata: parsed.metadata ?? {},
    };
  } catch {
    return { metadata: {} };
  }
}

export async function writeObjectAt(
  root: string,
  bucket: string,
  object: string,
  bytes: Uint8Array,
  sidecar: Sidecar,
) {
  const at = objectLocation(root, bucket, object);
  await mkdir(dirname(at.file), { recursive: true });
  await writeFile(at.sidecar, JSON.stringify(sidecar));

  const staged = `${at.file}.tmp-${randomBytes(8).toString("hex")}`;
  await writeFile(staged, bytes);
  await rename(staged, at.file);
}

export async function readObjectAt(root: string, bucket: string, object: string) {
  const at = objectLocation(root, bucket, object);
  try {
    const bytes = await readFile(at.file);
    return { bytes, sidecar: await sidecarAt(at.sidecar) };
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
}

export async function headObjectAt(
  root: string,
  bucket: string,
  object: string,
): Promise<ObjectMetadata | null> {
  const at = objectLocation(root, bucket, object);
  try {
    const stats = await stat(at.file);
    return {
      size: stats.size,
      generation: `${stats.size}:${stats.mtimeMs}`,
      ...(await sidecarAt(at.sidecar)),
    };
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
}

export async function removeObjectAt(root: string, bucket: string, object: string) {
  const at = objectLocation(root, bucket, object);
  await rm(at.file, { force: true });
  await rm(at.sidecar, { force: true });
}

export function localObjectStore(
  root: string,
  bucket: string,
  origin: string,
  secret: string,
): ObjectStore {
  const granted = (grant: Grant) => grantUrl(origin, grant, secret);

  return {
    save: (objectPath, bytes, { contentType, cacheControl, metadata }) =>
      writeObjectAt(root, bucket, objectPath, bytes, {
        contentType,
        ...(cacheControl && { cacheControl }),
        metadata: metadata ?? {},
      }),

    remove: (objectPath) => removeObjectAt(root, bucket, objectPath),

    async copy(fromObjectPath, toObjectPath) {
      const source = await readObjectAt(root, bucket, fromObjectPath);
      if (!source) throw new Error(`no such object: gs://${bucket}/${fromObjectPath}`);
      await writeObjectAt(root, bucket, toObjectPath, source.bytes, source.sidecar);
    },

    head: (objectPath) => headObjectAt(root, bucket, objectPath),

    async setCacheControl(objectPath, cacheControl) {
      const at = objectLocation(root, bucket, objectPath);
      await writeFile(at.sidecar, JSON.stringify({ ...(await sidecarAt(at.sidecar)), cacheControl }));
    },

    headIn: (readBucket, objectPath) => headObjectAt(root, readBucket, objectPath),

    async download(readBucket, objectPath) {
      const found = await readObjectAt(root, readBucket, objectPath);
      if (!found) throw new Error(`no such object: gs://${readBucket}/${objectPath}`);
      return found.bytes;
    },

    async readUrl(readBucket, objectPath, expiresAt) {
      return granted({
        bucket: readBucket,
        object: objectPath,
        method: "GET",
        accessibleAt: 0,
        expires: expiresAt,
      });
    },

    async windowedReadUrl(readBucket, objectPath, { accessibleAt, expires }) {
      return granted({
        bucket: readBucket,
        object: objectPath,
        method: "GET",
        accessibleAt,
        expires,
      });
    },

    async writeUrl(objectPath, { contentType, cacheControl, expiresAt }) {
      return granted({
        bucket,
        object: objectPath,
        method: "PUT",
        contentType,
        ...(cacheControl && { cacheControl }),
        accessibleAt: 0,
        expires: expiresAt,
      });
    },
  };
}
