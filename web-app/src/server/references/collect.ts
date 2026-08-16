import "server-only";
import { db } from "@/server/db";
import { searchImages } from "./index";
import { creditLine } from "./types";
import { signedReadUrl } from "@/server/google/storage";
import type { SearchInput } from "./types";
import type { ReferenceModel } from "@/generated/prisma/models";

/// Agent 1's one effect on the world: search, then persist. Shared by the
/// reference router (user typed a query) and the orchestrator (a model decided
/// to search) so both paths produce identical rows.
export async function collectReferences(projectId: string, search: SearchInput) {
  const candidates = await searchImages(search);

  // Re-running a search on the same project is idempotent — the unique on
  // (projectId, provider, providerId) makes the repeats no-ops.
  await db.reference.createMany({
    data: candidates.map((candidate) => ({ ...candidate, projectId })),
    skipDuplicates: true,
  });

  if (!candidates.length) return { found: 0, references: [] };

  const saved = await db.reference.findMany({
    where: {
      projectId,
      OR: candidates.map(({ provider, providerId }) => ({ provider, providerId })),
    },
  });

  return { found: candidates.length, references: await Promise.all(saved.map(forDisplay)) };
}

/// Provider images are hotlinked, as their terms require. Only an upload —
/// which lives in our bucket and nowhere else — needs a signed URL.
export async function forDisplay(reference: ReferenceModel) {
  return {
    ...reference,
    credit: creditLine(reference),
    displayUrl: reference.imageUrl ?? (reference.gcsUri ? await signedReadUrl(reference.gcsUri) : null),
    thumbnailUrl: reference.thumbUrl ?? reference.imageUrl ?? null,
  };
}
