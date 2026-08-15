import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { query } from "@/server/google/agent-runtime";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { Context } from "@/server/api/trpc";

/// Every entry point takes an id straight from the client, so each one
/// re-derives ownership through the run's project rather than trusting it.
async function ownedRun(ctx: Context & { user: { id: string } }, id: string) {
  const run = await ctx.db.agentRun.findFirst({
    where: { id, project: { userId: ctx.user.id } },
  });
  if (!run) throw new TRPCError({ code: "NOT_FOUND" });
  return run;
}

/// Agent 1 browses 50-200 candidates and outlives a Vercel function, so the UI
/// starts a run, gets a row id back, and polls `status`. infra.md §VII.
export const agentRouter = createTRPCRouter({
  start: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        agent: z.enum(AgentKind),
        input: z.record(z.string(), z.json()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.agentRun.create({
        data: { projectId: project.id, agent: input.agent, input: input.input },
        select: { id: true, status: true },
      });
    }),

  status: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => ownedRun(ctx, input.id)),

  /// Blocking call — only for agents that finish inside the function timeout.
  run: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ownedRun(ctx, input.runId);

      const run = await ctx.db.agentRun.update({
        where: { id: owned.id },
        data: { status: RunStatus.RUNNING },
      });

      try {
        const { output } = await query({ agent: run.agent, ...(run.input as object) });
        return ctx.db.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.SUCCEEDED,
            output: output as never,
            finishedAt: new Date(),
          },
        });
      } catch (cause) {
        await ctx.db.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.FAILED,
            error: cause instanceof Error ? cause.message : String(cause),
            finishedAt: new Date(),
          },
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "agent run failed", cause });
      }
    }),
});
