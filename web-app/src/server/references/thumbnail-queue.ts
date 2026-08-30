import "server-only";
import { after } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { derivedWrite } from "@/lib/intake/reference-derived";
import { db } from "@/server/db";
import { thumbnailOf } from "@/server/references/cut";
import { deleteProjectUpload, storeProjectUpload } from "@/server/references/upload";

export type ThumbnailQueueDeps = {
  db: PrismaClient;
  thumbnailOf: typeof thumbnailOf;
  storeUpload: typeof storeProjectUpload;
  deleteUpload: typeof deleteProjectUpload;
};

export type ThumbnailKick = { projectId: string; referenceId: string; bytes: Uint8Array };

export async function attachReferenceThumbnail(
  deps: ThumbnailQueueDeps,
  { projectId, referenceId, bytes }: ThumbnailKick,
): Promise<"attached" | "unneeded" | "lost"> {
  const stored = await deps.db.reference.findFirst({
    where: { id: referenceId, projectId },
    select: { width: true, height: true, thumbGcsUri: true },
  });
  if (!stored) return "lost";
  if (stored.thumbGcsUri) return "unneeded";

  const made = await deps.thumbnailOf(bytes);
  const thumbGcsUri = made.thumbnail
    ? await deps.storeUpload(projectId, made.thumbnail.contentType, made.thumbnail.bytes)
    : undefined;

  const { update } = derivedWrite(
    { width: stored.width, height: stored.height, hasThumbnail: false },
    { width: made.width, height: made.height, ...(thumbGcsUri && { thumbGcsUri }) },
  );
  if (Object.keys(update).length === 0) return "unneeded";

  const written = await deps.db.reference.updateMany({
    where: { id: referenceId, projectId, ...(update.thumbGcsUri ? { thumbGcsUri: null } : {}) },
    data: update,
  });
  if (written.count === 0) {
    if (update.thumbGcsUri) {
      await deps.deleteUpload(projectId, update.thumbGcsUri).catch(() => false);
    }
    return "unneeded";
  }
  return "attached";
}

const deps: ThumbnailQueueDeps = {
  db,
  thumbnailOf,
  storeUpload: storeProjectUpload,
  deleteUpload: deleteProjectUpload,
};

export function kickReferenceThumbnail(input: ThumbnailKick): boolean {
  try {
    after(async () => {
      try {
        await attachReferenceThumbnail(deps, input);
      } catch (cause) {
        console.error("thumbnail kick failed:", cause);
      }
    });
    return true;
  } catch (cause) {
    console.error("thumbnail kick could not be scheduled:", cause);
    return false;
  }
}
