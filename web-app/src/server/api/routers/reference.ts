import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { forDisplay } from "@/server/references/display";
import {
  deleteProjectUpload,
  discardableUploads,
  isProjectUpload,
  referenceUploadUrl,
} from "@/server/references/upload";
import { enqueueAnalysis, kickAnalyzerWorker } from "@/server/agents/analysis-queue";
import { shouldEnqueueAnalysis } from "@/lib/analyzer-queue";
import { UPLOAD_CONTENT_TYPES } from "@/lib/image-types";
import { AgentKind } from "@/generated/prisma/enums";
import type { AnalysisSource } from "@/lib/analysis-view";
import type { Context } from "@/server/api/trpc";

/// The `Analysis` columns that are the properties themselves — the row's id,
/// its model and its timestamp are bookkeeping the panel has no use for.
const ANALYSIS_PROPERTIES = {
  colorPalette: true,
  lighting: true,
  texture: true,
  composition: true,
  subject: true,
  contrastDepth: true,
  rationale: true,
} as const;

/// The link from a reference to its analyzer run only exists inside the run's
/// `input` Json — `AgentRun` has no reference column. That Json is client
/// written, so every lookup through it is scoped to the reference's own project.
function latestAnalyzerRun(
  ctx: Context,
  { projectId, referenceId }: { projectId: string; referenceId: string },
) {
  return ctx.db.agentRun.findFirst({
    where: {
      projectId,
      agent: AgentKind.ANALYZER,
      input: { path: ["referenceId"], equals: referenceId },
    },
    orderBy: { startedAt: "desc" },
    select: { status: true, error: true },
  });
}

async function ownedProject(ctx: Context & { user: { id: string } }, projectId: string) {
  const project = await ctx.db.project.findFirst({
    where: { id: projectId, userId: ctx.user.id },
    select: { id: true },
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

export const referenceRouter = createTRPCRouter({
  /// Gallery order: favorites first, newest first within each group.
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const references = await ctx.db.reference.findMany({
        where: { projectId: input.projectId },
        orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
      });
      return references.map(forDisplay);
    }),

  /// What agent 2 made of one reference. Fetched per open reference rather than
  /// joined into `listByProject`: the gallery renders every tile, the panel is
  /// open on one, and this is the query the panel polls while the job is still
  /// in the queue.
  properties: protectedProcedure
    .input(z.object({ referenceId: z.string() }))
    .query(async ({ ctx, input }): Promise<AnalysisSource> => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        select: { projectId: true, analysis: { select: ANALYSIS_PROPERTIES } },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });
      if (reference.analysis) return { properties: reference.analysis, run: null };

      /// No row yet, so the answer is "how far along is it" — which lives on the
      /// run the queue created.
      const run = await latestAnalyzerRun(ctx, {
        projectId: reference.projectId,
        referenceId: input.referenceId,
      });

      return { properties: null, run };
    }),

  /// The way out of every dead end the panel can settle on: a run that failed,
  /// a run that found nothing, and a reference that predates the queue and so
  /// has no run at all. Idempotent by design — a director clicking twice while
  /// the first job waits its turn does not buy a second vision call.
  requestAnalysis: protectedProcedure
    .input(z.object({ referenceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        select: { id: true, projectId: true },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });

      const run = await latestAnalyzerRun(ctx, {
        projectId: reference.projectId,
        referenceId: reference.id,
      });
      const queued = shouldEnqueueAnalysis(run);
      if (queued) {
        await enqueueAnalysis(ctx.db, {
          projectId: reference.projectId,
          referenceId: reference.id,
        });
      }

      /// Kicked either way. When nothing was queued the existing job is the
      /// thing that needs a worker — including a RUNNING row whose worker died,
      /// which the claim reclaims once its lease is up.
      kickAnalyzerWorker();
      return { queued };
    }),

  /// Bytes go browser → GCS and never through a function: Vercel's 4.5 MB
  /// request body limit is under a single phone photo. See context/infra.md §VII.
  uploadUrl: protectedProcedure
    .input(z.object({ projectId: z.string(), contentType: z.enum(UPLOAD_CONTENT_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      return referenceUploadUrl(input.projectId, input.contentType);
    }),

  /// Called after the PUT succeeds — the row is what makes an object visible,
  /// so an abandoned upload leaves an orphan blob rather than a broken tile.
  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        gcsUri: z.string(),
        thumbGcsUri: z.string().optional(),
        title: z.string().max(200).default(""),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      /// Both locators are client input, and the thumbnail is served under the
      /// same ownership check as the original, so both have to be inside the
      /// project's own prefix.
      const uris = [input.gcsUri, input.thumbGcsUri].filter((uri) => uri !== undefined);
      if (uris.some((uri) => !isProjectUpload(input.projectId, uri))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not an upload of this project" });
      }
      /// The row and its analyzer job land together: a reference with no job
      /// waits on a spinner nothing will ever end, since the panel reads a
      /// missing run as "queued".
      const reference = await ctx.db.$transaction(async (tx) => {
        const created = await tx.reference.create({ data: input });
        await enqueueAnalysis(tx, { projectId: created.projectId, referenceId: created.id });
        return created;
      });

      kickAnalyzerWorker();
      return reference;
    }),

  /// The other half of `add`: the browser calls this when the PUT landed but the
  /// row never did, so the bytes it just paid to store do not sit in the bucket
  /// forever with nothing pointing at them.
  discardUpload: protectedProcedure
    .input(z.object({ projectId: z.string(), gcsUris: z.array(z.string()).max(2) }))
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);

      const claimed = await ctx.db.reference.findMany({
        where: {
          projectId: input.projectId,
          OR: [{ gcsUri: { in: input.gcsUris } }, { thumbGcsUri: { in: input.gcsUris } }],
        },
        select: { gcsUri: true, thumbGcsUri: true },
      });
      const stillReferenced = new Set(
        claimed
          .flatMap((reference) => [reference.gcsUri, reference.thumbGcsUri])
          .filter((gcsUri) => gcsUri !== null),
      );

      let discarded = 0;
      for (const gcsUri of discardableUploads(input.projectId, input.gcsUris, stillReferenced)) {
        try {
          await deleteProjectUpload(input.projectId, gcsUri);
          discarded += 1;
        } catch (cause) {
          console.error(`${gcsUri} orphaned — discard failed:`, cause);
        }
      }
      return { discarded };
    }),

  setFavorite: protectedProcedure
    .input(z.object({ id: z.string(), isFavorite: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.reference.update({
        where: { id: reference.id },
        data: { isFavorite: input.isFavorite },
      });
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const reference = await ctx.db.reference.findFirst({
      where: { id: input.id, project: { userId: ctx.user.id } },
      select: { id: true, projectId: true, gcsUri: true, thumbGcsUri: true },
    });
    if (!reference) throw new TRPCError({ code: "NOT_FOUND" });

    /// Row first, bytes second. Both orders can half-fail; this one leaves an
    /// orphan blob, the other leaves a tile whose image 404s.
    await ctx.db.reference.delete({ where: { id: reference.id } });
    for (const gcsUri of [reference.gcsUri, reference.thumbGcsUri]) {
      if (!gcsUri) continue;
      try {
        await deleteProjectUpload(reference.projectId, gcsUri);
      } catch (cause) {
        console.error(`reference ${reference.id} removed, ${gcsUri} orphaned:`, cause);
      }
    }

    return { id: input.id };
  }),
});
