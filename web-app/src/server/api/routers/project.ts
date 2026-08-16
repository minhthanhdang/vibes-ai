import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { forDisplay } from "@/server/references/display";

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
        // Gallery order — favorites first, newest first within each group.
        references: {
          include: { analysis: true },
          orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
        },
        moodboards: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });

    return { ...project, references: project.references.map(forDisplay) };
  }),

  create: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(200), brief: z.string().max(5000).default("") }))
    .mutation(({ ctx, input }) => ctx.db.project.create({ data: { ...input, userId: ctx.user.id } })),

  /// The brief the column has always had and nothing could write. It is the
  /// director's own statement of what the project is for, it is primed into
  /// every turn the assistant takes (`directorBrief`), and until now the only
  /// value it could hold was the empty string the create form sent.
  ///
  /// `updateMany` with the ownership in the `where`, so someone else's id writes
  /// nothing and reads as a 404 — the same rule `byId` follows: the existence of
  /// a project is itself private.
  setBrief: protectedProcedure
    .input(z.object({ id: z.string(), brief: z.string().max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.project.updateMany({
        where: { id: input.id, userId: ctx.user.id },
        data: { brief: input.brief },
      });
      if (!count) throw new TRPCError({ code: "NOT_FOUND" });
      return { brief: input.brief };
    }),
});
