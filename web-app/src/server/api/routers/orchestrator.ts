import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { orchestrate } from "@/server/agents/orchestrator";
import { referenceToolset } from "@/server/agents/tools";

const turn = z.object({ role: z.enum(["user", "model"]), text: z.string() });

export const orchestratorRouter = createTRPCRouter({
  /// One director message in, one assistant reply out — plus whatever the tools
  /// put in front of them. The toolset is built per call and closed over this
  /// project, so the ids the model can reach are the ones the caller owns.
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

      const tools = referenceToolset({ db: ctx.db, projectId: project.id });
      const { reply, attachments } = await orchestrate({
        message: input.message,
        history: input.history,
        tools: tools.declarations,
        execute: tools.execute,
      });
      return { reply, attachments };
    }),
});
