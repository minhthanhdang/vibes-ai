import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { limitsFor } from "@/lib/limits/account-tier";
import { ORIGINAL_GALLERY_IMAGES } from "@/server/limits/quota";

export const accountRouter = createTRPCRouter({
  usage: protectedProcedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const owned = input.projectId
        ? await ctx.db.project.findFirst({
            where: { id: input.projectId, userId },
            select: { id: true },
          })
        : null;

      const [projects, galleryImages, holder, conversations] = await Promise.all([
        ctx.db.project.count({ where: { userId } }),
        ctx.db.reference.count({ where: { project: { userId }, ...ORIGINAL_GALLERY_IMAGES } }),
        ctx.db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { vibesBoardsUsed: true },
        }),
        owned ? ctx.db.conversation.count({ where: { projectId: owned.id } }) : null,
      ]);

      return {
        tier: ctx.user.tier,
        limits: limitsFor(ctx.user.tier),
        used: {
          projects,
          galleryImages,
          vibesBoards: holder.vibesBoardsUsed,
          ...(conversations === null ? {} : { conversations }),
        },
      };
    }),
});
