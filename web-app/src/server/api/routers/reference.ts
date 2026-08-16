import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { searchImages, trackDownload } from "@/server/references";
import { collectReferences, forDisplay } from "@/server/references/collect";
import { creditLine, imageCandidate, searchInput } from "@/server/references/types";
import type { Context } from "@/server/api/trpc";

async function ownedProject(ctx: Context & { user: { id: string } }, projectId: string) {
  const project = await ctx.db.project.findFirst({
    where: { id: projectId, userId: ctx.user.id },
    select: { id: true },
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
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
      return { query: search.query, ...(await collectReferences(projectId, search)) };
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
