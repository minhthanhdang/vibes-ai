import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { forDisplay } from "@/server/references/display";
import { forDisplaySigned, manyForDisplaySigned } from "@/server/references/display-signed";
import { kickReferenceThumbnail } from "@/server/references/thumbnail-queue";
import { fileVersion } from "@/server/references/file-version";
import {
  deleteProjectUpload,
  discardableUploads,
  isProjectUpload,
  referenceUploadUrl,
  storeProjectUpload,
} from "@/server/references/upload";
import { fetchRemoteImage, RemoteImageError } from "@/server/references/remote-image";
import { galleryRoom, refuseOverQuota } from "@/server/limits/quota";
import { enqueueAnalysis, kickAnalyzerWorker } from "@/server/agents/analyzer/analysis-queue";
import { shouldEnqueueAnalysis } from "@/lib/analysis/analyzer-queue";
import { HASH_LOOKUP_LIMIT, hashFileContent } from "@/lib/intake/content-hash";
import { derivedWrite } from "@/lib/intake/reference-derived";
import { cropReference, CropperError } from "@/server/agents/cropper/cropper";
import { spentColumns, spentThrown } from "@/lib/agent/shared/model-cost";
import {
  cropShapeOf,
  looseShapeOf,
  shapeAsked,
  cropBoxAtAspect,
  cropBoxColumns,
  cropBoxOf,
  cropPlan,
  EDIT_INTENT_LIMIT,
  EDIT_RATIONALE_LIMIT,
  relabeledIntent,
  type VersionLinkSource,
} from "@/lib/references/reference-version";
import { REFERENCE_LOCATE_LIMIT } from "@/lib/canvas/moodboard-images";
import {
  IMPORTED_IMAGE_TITLE,
  importableUrl,
  REMOTE_IMAGE_URL_LIMIT,
} from "@/lib/intake/remote-image";
import { UPLOAD_CONTENT_TYPES } from "@/lib/intake/image-types";
import { AgentKind, ReferenceOrigin, RunStatus } from "@/generated/prisma/enums";
import type { AnalysisSource } from "@/lib/analysis/analysis-view";
import type { GalleryAnalysisSource } from "@/lib/analysis/gallery-analysis";
import type { Context } from "@/server/api/trpc";

const GALLERY_RUN_LIMIT = 500;

const cropShape = z.string().refine((value) => cropShapeOf(value) !== null, "not a shape");

const looseShape = z.string().refine((value) => looseShapeOf(value) !== null, "not a shape");

const askedShape = z.string().refine((value) => shapeAsked(value) !== null, "not a shape");

const ANALYSIS_PROPERTIES = {
  title: true,
  colorPalette: true,
  lighting: true,
  texture: true,
  composition: true,
  subject: true,
  contrastDepth: true,
  rationale: true,
} as const;

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

async function descendantUploads(ctx: Context, rootId: string) {
  const uploads: string[] = [];
  let sources = [rootId];

  while (sources.length > 0) {
    const versions = await ctx.db.reference.findMany({
      where: { sourceReferenceId: { in: sources } },
      select: { id: true, gcsUri: true, thumbGcsUri: true },
    });
    for (const version of versions) {
      uploads.push(version.gcsUri);
      if (version.thumbGcsUri) uploads.push(version.thumbGcsUri);
    }
    sources = versions.map((version) => version.id);
  }

  return uploads;
}

const ORIGINALS_ONLY = { sourceReferenceId: null } as const;

async function ownedProject(ctx: Context & { user: { id: string } }, projectId: string) {
  const project = await ctx.db.project.findFirst({
    where: { id: projectId, userId: ctx.user.id },
    select: { id: true },
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

export const referenceRouter = createTRPCRouter({
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const references = await ctx.db.reference.findMany({
        where: { projectId: input.projectId, ...ORIGINALS_ONLY },
        orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
      });
      return manyForDisplaySigned(references);
    }),

  locateForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        ids: z.array(z.string()).min(1).max(REFERENCE_LOCATE_LIMIT),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);

      const found = await ctx.db.reference.findMany({
        where: { id: { in: input.ids }, project: { userId: ctx.user.id } },
        select: { id: true, projectId: true, title: true },
      });

      return {
        inProject: found
          .filter((reference) => reference.projectId === input.projectId)
          .map((reference) => reference.id),
        elsewhere: found
          .filter((reference) => reference.projectId !== input.projectId)
          .map(({ id, title }) => ({ id, title })),
      };
    }),

  summary: protectedProcedure
    .input(z.object({ referenceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        select: {
          id: true,
          projectId: true,
          title: true,
          editIntent: true,
          editRationale: true,
          cropBox: true,
          editAspect: true,
          width: true,
          height: true,
          generationPrompt: true,
          gcsUri: true,
          thumbGcsUri: true,
          source: { select: { id: true, title: true } },
        },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });
      return forDisplaySigned(reference);
    }),

  properties: protectedProcedure
    .input(z.object({ referenceId: z.string() }))
    .query(async ({ ctx, input }): Promise<AnalysisSource> => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        select: { projectId: true, analysis: { select: ANALYSIS_PROPERTIES } },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });
      if (reference.analysis) return { properties: reference.analysis, run: null };

      const run = await latestAnalyzerRun(ctx, {
        projectId: reference.projectId,
        referenceId: input.referenceId,
      });

      return { properties: null, run };
    }),

  versions: protectedProcedure
    .input(z.object({ referenceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        select: { id: true },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });

      const versions = await ctx.db.reference.findMany({
        where: { sourceReferenceId: reference.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          editIntent: true,
          editRationale: true,
          cropBox: true,
          editAspect: true,
          origin: true,
          width: true,
          height: true,
          createdAt: true,
          gcsUri: true,
          thumbGcsUri: true,
        },
      });
      return manyForDisplaySigned(versions);
    }),

  versionLinksByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }): Promise<VersionLinkSource> => {
      await ownedProject(ctx, input.projectId);

      const versions = await ctx.db.reference.findMany({
        where: { projectId: input.projectId, sourceReferenceId: { not: null } },
        select: { id: true, sourceReferenceId: true },
      });

      return versions.flatMap(({ id, sourceReferenceId }) =>
        sourceReferenceId ? [{ id, sourceReferenceId }] : [],
      );
    }),

  analysisByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }): Promise<GalleryAnalysisSource> => {
      await ownedProject(ctx, input.projectId);

      const [analyses, runs] = await Promise.all([
        ctx.db.analysis.findMany({
          where: { reference: { projectId: input.projectId } },
          select: { referenceId: true, ...ANALYSIS_PROPERTIES },
        }),
        ctx.db.agentRun.findMany({
          where: { projectId: input.projectId, agent: AgentKind.ANALYZER },
          orderBy: { startedAt: "desc" },
          take: GALLERY_RUN_LIMIT,
          select: { input: true, status: true, error: true },
        }),
      ]);

      return { analyses, runs };
    }),

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

      kickAnalyzerWorker();
      return { queued };
    }),

  existingHashes: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        contentHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(HASH_LOOKUP_LIMIT),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const matches = await ctx.db.reference.findMany({
        where: {
          projectId: input.projectId,
          ...ORIGINALS_ONLY,
          contentHash: { in: input.contentHashes },
        },
        select: { contentHash: true },
      });
      return matches.map((match) => match.contentHash!);
    }),

  uploadUrl: protectedProcedure
    .input(z.object({ projectId: z.string(), contentType: z.enum(UPLOAD_CONTENT_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const said = await galleryRoom(ctx.db, { userId: ctx.user.id, tier: ctx.user.tier });
      if (said) refuseOverQuota(said);
      return referenceUploadUrl(input.projectId, input.contentType);
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        gcsUri: z.string(),
        thumbGcsUri: z.string().optional(),
        title: z.string().max(200).default(""),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const said = await galleryRoom(ctx.db, { userId: ctx.user.id, tier: ctx.user.tier });
      if (said) refuseOverQuota(said);
      const uris = [input.gcsUri, input.thumbGcsUri].filter((uri) => uri !== undefined);
      if (uris.some((uri) => !isProjectUpload(input.projectId, uri))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not an upload of this project" });
      }
      const reference = await ctx.db.$transaction(async (tx) => {
        const created = await tx.reference.create({ data: input });
        await enqueueAnalysis(tx, { projectId: created.projectId, referenceId: created.id });
        return created;
      });

      kickAnalyzerWorker();
      return forDisplay(reference);
    }),

  planCrop: protectedProcedure
    .input(
      z.object({
        referenceId: z.string(),
        prompt: z.string().min(1).max(EDIT_INTENT_LIMIT),
        previous: z
          .object({
            cropBox: z.array(z.number().int()).length(4),
            editIntent: z.string().max(EDIT_INTENT_LIMIT).default(""),
          })
          .optional(),
        aspect: cropShape.optional(),
        loose: looseShape.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        select: {
          id: true,
          projectId: true,
          gcsUri: true,
          title: true,
          width: true,
          height: true,
        },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });

      const asked = shapeAsked(input.aspect ?? input.loose);
      const ratio = asked?.shape?.ratio ?? null;
      const framed = asked?.loose ?? null;
      if (ratio && !(reference.width && reference.height)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `this frame's pixel size was never recorded, so a crop of it cannot be held to ${input.aspect} — ask without a shape`,
        });
      }

      const run = await ctx.db.agentRun.create({
        data: {
          projectId: reference.projectId,
          agent: AgentKind.CROPPER,
          status: RunStatus.RUNNING,
          input: {
            referenceId: reference.id,
            prompt: input.prompt,
            ...(input.previous && { previous: input.previous }),
            ...(asked && { aspect: asked.shape?.label ?? asked.loose?.id }),
          },
        },
        select: { id: true },
      });

      let spent: ReturnType<typeof spentColumns> | undefined;

      try {
        const answer = await cropReference({
          gcsUri: reference.gcsUri,
          prompt: input.prompt,
          title: reference.title,
          previous: input.previous,
          ...(asked?.shape && { aspect: asked.shape.label }),
          ...(framed && { loose: framed, frame: reference }),
        });
        spent = spentColumns(answer.model, answer.usage);

        const box = ratio
          ? cropBoxAtAspect(cropBoxColumns(answer.box), reference, ratio)
          : answer.box;
        if (!box) {
          throw new CropperError(`the cropper's box could not be held to ${input.aspect}`);
        }

        const plan = cropPlan({
          box,
          intent: answer.intent,
          rationale: answer.rationale,
          sourceTitle: reference.title,
        });
        if (!plan) {
          throw new CropperError("the whole frame is the shot — there is nothing to crop out of it");
        }

        await ctx.db.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.SUCCEEDED,
            output: { ...plan, model: answer.model, attempts: answer.attempts },
            finishedAt: new Date(),
            ...spent,
          },
        });

        return { runId: run.id, ...plan, loose: framed?.id ?? null };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        spent ??= spentThrown(cause) ?? undefined;
        await ctx.db.agentRun.update({
          where: { id: run.id },
          data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
        });

        throw new TRPCError({
          code: cause instanceof CropperError ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
          message: cause instanceof CropperError ? message : "the cropper could not be reached",
          cause,
        });
      }
    }),

  addVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        sourceReferenceId: z.string(),
        gcsUri: z.string(),
        thumbGcsUri: z.string().optional(),
        editIntent: z.string().max(EDIT_INTENT_LIMIT).default(""),
        editRationale: z.string().max(EDIT_RATIONALE_LIMIT).default(""),
        cropBox: z.array(z.number().int()).length(4),
        editAspect: askedShape.optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);

      const uris = [input.gcsUri, input.thumbGcsUri].filter((uri) => uri !== undefined);
      if (uris.some((uri) => !isProjectUpload(input.projectId, uri))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not an upload of this project" });
      }

      const source = await ctx.db.reference.findFirst({
        where: { id: input.sourceReferenceId, projectId: input.projectId },
        select: { id: true, title: true, origin: true },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const box = cropBoxOf(input.cropBox);
      if (!box) throw new TRPCError({ code: "BAD_REQUEST", message: "not a box of this reference" });

      const reference = await ctx.db.$transaction((tx) =>
        fileVersion(tx, {
          projectId: input.projectId,
          source,
          gcsUri: input.gcsUri,
          thumbGcsUri: input.thumbGcsUri,
          editIntent: input.editIntent,
          editRationale: input.editRationale,
          cropBox: box,
          editAspect: input.editAspect,
          width: input.width,
          height: input.height,
          contentHash: input.contentHash,
        }),
      );

      kickAnalyzerWorker();
      return forDisplay(reference);
    }),

  relabelVersion: protectedProcedure
    .input(
      z.object({ referenceId: z.string(), editIntent: z.string().max(EDIT_INTENT_LIMIT) }),
    )
    .mutation(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        select: { id: true, sourceReferenceId: true, editIntent: true },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });
      if (!reference.sourceReferenceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "an original is named by its title" });
      }

      const relabeled = relabeledIntent(input.editIntent, reference);
      if (relabeled) {
        await ctx.db.reference.update({
          where: { id: reference.id },
          data: { editIntent: relabeled },
        });
      }

      return { id: reference.id, editIntent: relabeled ?? reference.editIntent };
    }),

  importFromUrl: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        url: z.string().max(REMOTE_IMAGE_URL_LIMIT),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const said = await galleryRoom(ctx.db, { userId: ctx.user.id, tier: ctx.user.tier });
      if (said) refuseOverQuota(said);

      const target = importableUrl(input.url);
      if (!target) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "blocked" });
      }

      let image;
      try {
        image = await fetchRemoteImage(target);
      } catch (cause) {
        if (cause instanceof RemoteImageError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: cause.reason });
        }
        throw cause;
      }

      const contentHash = await hashFileContent(new Blob([image.bytes]));
      const existing = await ctx.db.reference.findFirst({
        where: { projectId: input.projectId, ...ORIGINALS_ONLY, contentHash },
      });
      if (existing) return forDisplaySigned(existing);

      const gcsUri = await storeProjectUpload(input.projectId, image.contentType, image.bytes);
      const reference = await ctx.db.$transaction(async (tx) => {
        const created = await tx.reference.create({
          data: {
            projectId: input.projectId,
            gcsUri,
            title: IMPORTED_IMAGE_TITLE,
            origin: ReferenceOrigin.IMPORTED,
            width: input.width,
            height: input.height,
            contentHash,
          },
        });
        await enqueueAnalysis(tx, { projectId: created.projectId, referenceId: created.id });
        return created;
      });

      kickAnalyzerWorker();
      kickReferenceThumbnail({
        projectId: input.projectId,
        referenceId: reference.id,
        bytes: image.bytes,
      });
      return forDisplaySigned(reference);
    }),

  attachDerived: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        referenceId: z.string(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        thumbGcsUri: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);

      if (input.thumbGcsUri && !isProjectUpload(input.projectId, input.thumbGcsUri)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not an upload of this project" });
      }

      const stored = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, projectId: input.projectId },
      });
      if (!stored) throw new TRPCError({ code: "NOT_FOUND" });

      const { update, discard } = derivedWrite(
        { width: stored.width, height: stored.height, hasThumbnail: stored.thumbGcsUri != null },
        input,
      );

      let reference = stored;
      if (Object.keys(update).length > 0) {
        const written = await ctx.db.reference.updateMany({
          where: {
            id: stored.id,
            projectId: input.projectId,
            ...(update.thumbGcsUri ? { thumbGcsUri: null } : {}),
          },
          data: update,
        });
        if (written.count === 0 && update.thumbGcsUri) {
          await deleteProjectUpload(input.projectId, update.thumbGcsUri).catch(() => false);
        }
        reference = (await ctx.db.reference.findFirst({ where: { id: stored.id } })) ?? stored;
      }

      if (discard) await deleteProjectUpload(input.projectId, discard).catch(() => false);
      return forDisplaySigned(reference);
    }),

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

    const versions = await descendantUploads(ctx, reference.id);

    await ctx.db.reference.delete({ where: { id: reference.id } });
    for (const gcsUri of [reference.gcsUri, reference.thumbGcsUri, ...versions]) {
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
