import type { UploadableFile } from "@/lib/intake/drag-drop";

export type HashedFile = UploadableFile & { contentHash: string };

export type DropPartition = { fresh: HashedFile[]; duplicates: HashedFile[] };

export const HASH_LOOKUP_LIMIT = 500;

export async function hashFileContent(file: Blob): Promise<string> {
  return hashBytes(new Uint8Array(await file.arrayBuffer()));
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function partitionDrop(
  hashed: readonly HashedFile[],
  alreadyInProject: ReadonlySet<string>,
): DropPartition {
  const partition: DropPartition = { fresh: [], duplicates: [] };
  const claimed = new Set(alreadyInProject);

  for (const file of hashed) {
    if (claimed.has(file.contentHash)) partition.duplicates.push(file);
    else {
      claimed.add(file.contentHash);
      partition.fresh.push(file);
    }
  }

  return partition;
}
