import "server-only";
import { createHash } from "node:crypto";
import { bucketName, developing, devStagingBucket } from "@/env";
import { gcsObjectStore, objectStore, parseGcsUri, readObject } from "@/server/google/storage";
import type { Content, GeneratePart } from "./vertex";

export const PICTURE_BYTE_LIMIT = 25_000_000;

export const STAGING_PREFIX = "dev-staging/";

export type PictureSource = {
  generation(gcsUri: string): Promise<string | null>;
  bytes(gcsUri: string): Promise<Uint8Array<ArrayBuffer>>;
};

export type PictureSink = {
  staged(objectPath: string): Promise<boolean>;
  stage(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void>;
};

export type Staging = { source: PictureSource; sink: PictureSink; from: string; to: string };

export type StagedCache = Map<string, Promise<string>>;

const globalForStaging = globalThis as unknown as { devStagedPictures?: StagedCache };

export function stagedCache(): StagedCache {
  return (globalForStaging.devStagedPictures ??= new Map());
}

export function stagedObjectPath(gcsUri: string, generation: string | null) {
  const digest = createHash("sha256").update(`${gcsUri}#${generation ?? "unknown"}`).digest("hex");
  const extension = /\.[a-z0-9]+$/i.exec(gcsUri)?.[0] ?? "";
  return `${STAGING_PREFIX}${digest.slice(0, 32)}${extension.toLowerCase()}`;
}

function localPicture(part: GeneratePart, from: string) {
  const fileUri = part.fileData?.fileUri;
  if (!fileUri?.startsWith("gs://")) return null;
  try {
    return parseGcsUri(fileUri).bucket === from ? fileUri : null;
  } catch {
    return null;
  }
}

function carriesPicture(content: Content, from: string) {
  return content.parts.some((part) => localPicture(part, from) !== null);
}

async function stage(staging: Staging, gcsUri: string, mimeType: string, generation: string | null) {
  const objectPath = stagedObjectPath(gcsUri, generation);
  const uri = `gs://${staging.to}/${objectPath}`;
  if (await staging.sink.staged(objectPath)) return uri;

  await staging.sink.stage(objectPath, await staging.source.bytes(gcsUri), mimeType);
  return uri;
}

async function stagedUri(staging: Staging, gcsUri: string, mimeType: string) {
  const cache = stagedCache();
  const generation = await staging.source.generation(gcsUri);
  const key = `${gcsUri}#${generation ?? "unknown"}`;

  const standing = cache.get(key);
  if (standing) {
    const uri = await standing.catch(() => null);
    if (uri) return uri;
    cache.delete(key);
  }

  const pending = stage(staging, gcsUri, mimeType, generation);
  cache.set(key, pending);
  try {
    return await pending;
  } catch (cause) {
    cache.delete(key);
    throw cause;
  }
}

export async function stageContents(contents: Content[], staging: Staging): Promise<Content[]> {
  if (!contents.some((content) => carriesPicture(content, staging.from))) return contents;

  return Promise.all(
    contents.map(async (content) => {
      if (!carriesPicture(content, staging.from)) return content;
      const parts = await Promise.all(
        content.parts.map(async (part) => {
          const gcsUri = localPicture(part, staging.from);
          if (!gcsUri) return part;
          const mimeType = part.fileData?.mimeType ?? "application/octet-stream";
          const fileUri = await stagedUri(staging, gcsUri, mimeType);
          return { ...part, fileData: { ...part.fileData, fileUri } };
        }),
      );
      return { ...content, parts };
    }),
  );
}

export const localPictures: PictureSource = {
  generation: async (gcsUri) => {
    const { bucket, object } = parseGcsUri(gcsUri);
    return (await objectStore().headIn(bucket, object))?.generation ?? null;
  },
  bytes: async (gcsUri) => new Uint8Array(await readObject(gcsUri, PICTURE_BYTE_LIMIT)),
};

export function stagingBucketSink(): PictureSink {
  const store = gcsObjectStore(devStagingBucket);
  return {
    staged: async (objectPath) => (await store.head(objectPath)) !== null,
    stage: (objectPath, bytes, contentType) => store.save(objectPath, bytes, { contentType }),
  };
}

export type PictureResolver = (contents: Content[]) => Promise<Content[]>;

export function stagedPictures(
  source: PictureSource = localPictures,
  sink: () => PictureSink = stagingBucketSink,
): PictureResolver {
  return async (contents) =>
    developing()
      ? stageContents(contents, { source, sink: sink(), from: bucketName(), to: devStagingBucket() })
      : contents;
}
