import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { orchestrate, SEARCH_REFERENCES } from "@/server/agents/orchestrator";
import { collectReferences } from "@/server/references/collect";
import { searchInput } from "@/server/references/types";

const turn = z.object({ role: z.enum(["user", "model"]), text: z.string() });

/// The model's arguments are untrusted input like any other client's — a
/// hallucinated limit of 500 gets rejected here, not sent to a provider.
const searchArgs = searchInput.partial({ limit: true });

export const orchestratorRouter = createTRPCRouter({
  /// One director message in, one assistant reply out, with any references the
  /// orchestrator decided to collect already written to the project.
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

      let collected = 0;

      const { reply, calls } = await orchestrate({
        message: input.message,
        history: input.history,
        execute: async ({ name, args }) => {
          if (name !== SEARCH_REFERENCES.name) throw new Error(`unknown tool ${name}`);

          const parsed = searchArgs.safeParse(args);
          if (!parsed.success) return { error: `bad arguments: ${parsed.error.issues[0].message}` };

          const { found, references } = await collectReferences(project.id, {
            ...parsed.data,
            limit: parsed.data.limit ?? 12,
          });
          collected += found;

          // The model only needs to know the search worked and who took the
          // photos; the browser reads the rows themselves out of the gallery.
          return {
            query: parsed.data.query,
            found,
            credits: references.map((reference) => reference.credit),
          };
        },
      });

      return { reply, collected, searches: calls.map((call) => call.args.query as string) };
    }),
});
