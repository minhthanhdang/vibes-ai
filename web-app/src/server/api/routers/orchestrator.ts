import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { runOrchestratorTurn } from "@/server/agents/turn";

const turn = z.object({ role: z.enum(["user", "model"]), text: z.string() });

export const orchestratorRouter = createTRPCRouter({
  /// One director message in, one assistant reply out — plus whatever the tools
  /// put in front of them. Ownership is the only thing decided here; the turn
  /// itself is `runOrchestratorTurn`, so the command-line harness runs it too.
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

      const { reply, attachments } = await runOrchestratorTurn({
        db: ctx.db,
        projectId: project.id,
        message: input.message,
        history: input.history,
      });

      return { reply, attachments };
    }),
});
