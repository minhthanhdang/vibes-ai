import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { signedReadUrl } from "@/server/google/storage";

export const projectRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.project.findMany({
        where: { userId: ctx.user.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
        select: { id: true, title: true, brief: true, createdAt: true },
      });

      const hasNextPage = items.length > input.limit;
      if (hasNextPage) items.pop();

      return { items, nextCursor: hasNextPage ? items[items.length - 1].id : null };
    }),

  /// Someone else's id is a 404, not a 403 — the existence of a project is
  /// itself private.
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const project = await ctx.db.project.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      include: {
        references: { include: { analysis: true }, orderBy: { createdAt: "asc" } },
        moodboards: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });

    return {
      ...project,
      references: await Promise.all(
        project.references.map(async (reference) => ({
          ...reference,
          previewUrl: await signedReadUrl(reference.gcsUri),
        })),
      ),
    };
  }),

  create: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(200), brief: z.string().max(5000).default("") }))
    .mutation(({ ctx, input }) => ctx.db.project.create({ data: { ...input, userId: ctx.user.id } })),
});
