import "server-only";
import { developing } from "@/env";
import { objectGeneration, readObject } from "@/server/google/storage";
import type { Content, GeneratePart } from "./vertex";

export const PICTURE_BYTE_LIMIT = 25_000_000;

export const PROCESSING_POLL_MS = 500;

export const PROCESSING_POLL_ATTEMPTS = 60;

export const EXPIRY_MARGIN_MS = 5 * 60_000;

export const UNKNOWN_EXPIRY_MS = 30 * 60_000;

export type RemoteFile = {
  name?: string;
  uri?: string;
  state?: string;
  expirationTime?: string;
  error?: { message?: string };
};

export type FilesApi = {
  upload(bytes: Uint8Array<ArrayBuffer>, mimeType: string): Promise<RemoteFile>;
  get(name: string): Promise<RemoteFile>;
};

export type PictureSource = {
  generation(gcsUri: string): Promise<string | null>;
  bytes(gcsUri: string): Promise<Uint8Array<ArrayBuffer>>;
};

export type Pictures = { files: FilesApi; source: PictureSource };

export const storedPictures: PictureSource = {
  generation: objectGeneration,
  bytes: async (gcsUri) => new Uint8Array(await readObject(gcsUri, PICTURE_BYTE_LIMIT)),
};

export type ResolvedPicture = { uri: string; expiresAt: number };

export type PictureCache = Map<string, Promise<ResolvedPicture>>;

const globalForPictures = globalThis as unknown as { devPictures?: PictureCache };

export function pictureCache(): PictureCache {
  return (globalForPictures.devPictures ??= new Map());
}

export function pictureKey(gcsUri: string, generation: string | null) {
  return `${gcsUri}#${generation ?? "unknown"}`;
}

function gcsPicture(part: GeneratePart) {
  const fileUri = part.fileData?.fileUri;
  return fileUri?.startsWith("gs://") ? fileUri : null;
}

function carriesPicture(content: Content) {
  return content.parts.some((part) => gcsPicture(part) !== null);
}

function expiryOf(file: RemoteFile, now: number) {
  const at = file.expirationTime ? Date.parse(file.expirationTime) : NaN;
  return Number.isNaN(at) ? now + UNKNOWN_EXPIRY_MS : at;
}

async function activeFile(api: FilesApi, uploaded: RemoteFile): Promise<RemoteFile> {
  let file = uploaded;
  for (let attempt = 0; file.state === "PROCESSING"; attempt++) {
    if (!file.name) throw new Error("the Files API is still processing a file it did not name");
    if (attempt >= PROCESSING_POLL_ATTEMPTS) {
      throw new Error(`the Files API is still processing ${file.name}`);
    }
    await new Promise((resolve) => setTimeout(resolve, PROCESSING_POLL_MS));
    file = await api.get(file.name);
  }
  if (file.state === "FAILED") {
    throw new Error(file.error?.message ?? "the Files API failed to process that picture");
  }
  return file;
}

async function uploaded(
  { files, source }: Pictures,
  gcsUri: string,
  mimeType: string,
  now: number,
): Promise<ResolvedPicture> {
  const bytes = await source.bytes(gcsUri);
  const file = await activeFile(files, await files.upload(bytes, mimeType));
  if (!file.uri) throw new Error(`the Files API returned no uri for ${gcsUri}`);
  return { uri: file.uri, expiresAt: expiryOf(file, now) };
}

async function pictureUri(pictures: Pictures, gcsUri: string, mimeType: string, now: number) {
  const cache = pictureCache();
  const key = pictureKey(gcsUri, await pictures.source.generation(gcsUri));

  const standing = cache.get(key);
  if (standing) {
    const picture = await standing.catch(() => null);
    if (picture && now < picture.expiresAt - EXPIRY_MARGIN_MS) return picture.uri;
    cache.delete(key);
  }

  const pending = uploaded(pictures, gcsUri, mimeType, now);
  cache.set(key, pending);
  try {
    return (await pending).uri;
  } catch (cause) {
    cache.delete(key);
    throw cause;
  }
}

export async function resolveContents(
  contents: Content[],
  pictures: Pictures,
  now = Date.now(),
): Promise<Content[]> {
  if (!contents.some(carriesPicture)) return contents;

  return Promise.all(
    contents.map(async (content) => {
      if (!carriesPicture(content)) return content;
      const parts = await Promise.all(
        content.parts.map(async (part) => {
          const gcsUri = gcsPicture(part);
          if (!gcsUri) return part;
          const mimeType = part.fileData?.mimeType ?? "application/octet-stream";
          const fileUri = await pictureUri(pictures, gcsUri, mimeType, now);
          return { ...part, fileData: { ...part.fileData, fileUri } };
        }),
      );
      return { ...content, parts };
    }),
  );
}

export type PictureResolver = (contents: Content[]) => Promise<Content[]>;

export function filesApiPictures(
  files: () => FilesApi,
  source: PictureSource = storedPictures,
): PictureResolver {
  return async (contents) =>
    developing() ? resolveContents(contents, { files: files(), source }) : contents;
}
