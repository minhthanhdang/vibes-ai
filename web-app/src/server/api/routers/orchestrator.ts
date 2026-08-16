import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { orchestrate } from "@/server/agents/orchestrator";

const turn = z.object({ role: z.enum(["user", "model"]), text: z.string() });

export const orchestratorRouter = createTRPCRouter({
  /// One director message in, one assistant reply out. No tools are registered
  /// yet — agents 2–5 hang off `orchestrate`'s executor seam.
  send: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        message: z.string().min(1).max(2000),
        history: z.array(turn).max(20).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const { reply } = await orchestrate({ message: input.message, history: input.history });
      return { reply };
    }),
});
