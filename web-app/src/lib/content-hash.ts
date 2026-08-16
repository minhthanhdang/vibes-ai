import type { UploadableFile } from "./drag-drop";

export type HashedFile = UploadableFile & { contentHash: string };

export type DropPartition = { fresh: HashedFile[]; duplicates: HashedFile[] };

/// How many hashes one duplicate check may carry. Shared by the query's
/// validator and the caller that chunks a big drop to fit it, so a scout
/// dropping a folder of six hundred stills cannot make the two disagree.
export const HASH_LOOKUP_LIMIT = 500;

/// What identifies an image to this project. Nothing else does: a scout's drop
/// carries the same photo under three names out of three folders, and a
/// director recovering a half-failed batch re-drops the whole folder, so file
/// name, size and mtime all say "different file" about identical bytes.
export async function hashFileContent(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/// Which of a drop's files are worth uploading. Two things make a file a
/// duplicate and both have to be caught here: the project already holds those
/// bytes, and an earlier file in this same drop already claimed them — a folder
/// re-dropped after a partial failure is the first case, a folder holding the
/// same photo twice is the second, and checking only against the server would
/// let the second pair race each other into two rows.
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
