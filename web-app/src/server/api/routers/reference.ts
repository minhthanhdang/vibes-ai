import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { searchImages, trackDownload } from "@/server/references";
import { creditLine, imageCandidate, searchInput } from "@/server/references/types";
import { signedReadUrl } from "@/server/google/storage";
import type { ReferenceModel } from "@/generated/prisma/models";
import type { Context } from "@/server/api/trpc";

async function ownedProject(ctx: Context & { user: { id: string } }, projectId: string) {
  const project = await ctx.db.project.findFirst({
    where: { id: projectId, userId: ctx.user.id },
    select: { id: true },
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

/// Provider images are hotlinked, as their terms require. Only an upload —
/// which lives in our bucket and nowhere else — needs a signed URL.
async function forDisplay(reference: ReferenceModel) {
  return {
    ...reference,
    credit: creditLine(reference),
    displayUrl: reference.imageUrl ?? (reference.gcsUri ? await signedReadUrl(reference.gcsUri) : null),
    thumbnailUrl: reference.thumbUrl ?? reference.imageUrl ?? null,
  };
}

export const referenceRouter = createTRPCRouter({
  /// Agent 1's tool. The orchestrator hands over a phrase like "gloomy
  /// historical mansion" and gets rows back — search and persist are one call
  /// so a result the user can see is never left only in the model's context.
  collect: protectedProcedure
    .input(searchInput.extend({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, ...search } = input;
      await ownedProject(ctx, projectId);

      const candidates = await searchImages(search);

      // Re-running a search on the same project is idempotent — the unique on
      // (projectId, provider, providerId) makes the repeats no-ops.
      await ctx.db.reference.createMany({
        data: candidates.map((candidate) => ({ ...candidate, projectId })),
        skipDuplicates: true,
      });

      const saved = await ctx.db.reference.findMany({
        where: {
          projectId,
          OR: candidates.map(({ provider, providerId }) => ({ provider, providerId })),
        },
      });

      return { query: search.query, found: candidates.length, references: await Promise.all(saved.map(forDisplay)) };
    }),

  /// Search without touching the project, for a preview-before-import flow.
  search: protectedProcedure.input(searchInput).query(async ({ input }) => {
    const candidates = await searchImages(input);
    return candidates.map((candidate) => ({ ...candidate, credit: creditLine(candidate) }));
  }),

  /// Gallery order: favorites first, newest first within each group.
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const references = await ctx.db.reference.findMany({
        where: { projectId: input.projectId },
        orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
      });
      return Promise.all(references.map(forDisplay));
    }),

  setFavorite: protectedProcedure
    .input(z.object({ id: z.string(), isFavorite: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });

      // Unsplash counts a favorite as the user taking the photo, which is the
      // moment their guidelines want reported.
      if (input.isFavorite && reference.downloadTrackUrl) {
        await trackDownload(reference.downloadTrackUrl);
      }

      return ctx.db.reference.update({
        where: { id: reference.id },
        data: { isFavorite: input.isFavorite },
      });
    }),

  add: protectedProcedure
    .input(z.object({ projectId: z.string(), candidates: z.array(imageCandidate).min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      return ctx.db.reference.createMany({
        data: input.candidates.map((candidate) => ({ ...candidate, projectId: input.projectId })),
        skipDuplicates: true,
      });
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { count } = await ctx.db.reference.deleteMany({
      where: { id: input.id, project: { userId: ctx.user.id } },
    });
    if (!count) throw new TRPCError({ code: "NOT_FOUND" });
    return { id: input.id };
  }),
});
