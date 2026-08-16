import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { orchestrate } from "@/server/agents/orchestrator";
import { referenceToolset } from "@/server/agents/tools";
import { spentColumns } from "@/lib/model-cost";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";

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
      const { reply, attachments, calls, model, usage } = await orchestrate({
        message: input.message,
        history: input.history,
        tools: tools.declarations,
        execute: tools.execute,
      });

      /// The turn's own row, written after rather than around it: the
      /// orchestrator answers inside this request, so there is nothing to poll
      /// and no status to show — the row exists to be summed. Its tokens are the
      /// routing only; the agents it called through tools wrote rows of their
      /// own, and counting theirs here would bill one crop twice.
      await ctx.db.agentRun.create({
        data: {
          projectId: project.id,
          agent: AgentKind.ORCHESTRATOR,
          status: RunStatus.SUCCEEDED,
          input: { message: input.message, history: input.history.length },
          output: { calls: calls.map((call) => call.name), attachments: attachments.length },
          finishedAt: new Date(),
          ...spentColumns(model, usage),
        },
      });

      return { reply, attachments };
    }),
});
