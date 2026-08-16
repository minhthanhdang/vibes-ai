import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { forDisplay } from "@/server/references/display";
import {
  deleteProjectUpload,
  discardableUploads,
  isProjectUpload,
  referenceUploadUrl,
  storeProjectUpload,
} from "@/server/references/upload";
import { fetchRemoteImage, RemoteImageError } from "@/server/references/remote-image";
import { enqueueAnalysis, kickAnalyzerWorker } from "@/server/agents/analysis-queue";
import { shouldEnqueueAnalysis } from "@/lib/analysis/analyzer-queue";
import { HASH_LOOKUP_LIMIT, hashFileContent } from "@/lib/intake/content-hash";
import { derivedWrite } from "@/lib/intake/reference-derived";
import { cropReference, CropperError } from "@/server/agents/cropper";
import { spentColumns, usageThrown } from "@/lib/agent/model-cost";
import { MODELS } from "@/server/google/vertex";
import {
  cropShapeOf,
  looseShapeOf,
  shapeAsked,
  cropBoxAtAspect,
  cropBoxColumns,
  cropBoxOf,
  cropPlan,
  editIntent as asEditIntent,
  editRationale as asEditRationale,
  EDIT_INTENT_LIMIT,
  EDIT_RATIONALE_LIMIT,
  relabeledIntent,
  type VersionLinkSource,
} from "@/lib/references/reference-version";
import { croppedReferenceTitle } from "@/lib/canvas/moodboard-crop";
import { REFERENCE_LOCATE_LIMIT } from "@/lib/canvas/moodboard-images";
import {
  IMPORTED_IMAGE_TITLE,
  importableUrl,
  REMOTE_IMAGE_URL_LIMIT,
} from "@/lib/intake/remote-image";
import { UPLOAD_CONTENT_TYPES } from "@/lib/intake/image-types";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { AnalysisSource } from "@/lib/analysis/analysis-view";
import type { GalleryAnalysisSource } from "@/lib/analysis/gallery-analysis";
import type { Context } from "@/server/api/trpc";

/// How far back the gallery read looks for analyzer runs. Deep enough that a
/// project's whole backlog of queued uploads is visible, shallow enough that a
/// project re-analyzed for months does not ship its entire run history.
const GALLERY_RUN_LIMIT = 500;

/// A shape a cut may be held to, as it arrives over the wire.
///
/// Not the six-name enum any more: a cut made to fill a slot on a board is held
/// to that opening's own ratio (§V), which is whatever the template made it, and
/// the browser nudging such a cut has to be able to ask at the same shape. Still
/// validated rather than taken — `cropShapeOf` is what decides whether a string
/// is a shape at all, so the column can only ever hold something readable.
const cropShape = z.string().refine((value) => cropShapeOf(value) !== null, "not a shape");

/// The other vocabulary a shape is said in: one of the four loose words. Kept as
/// its own argument rather than folded into `cropShape` because the two do
/// different things to the box — a ratio is arithmetic on the answer, a word is a
/// band the answer has to land inside — so a caller that cannot tell them apart
/// is a caller that would open a loosely-framed cut out to a ratio nobody named.
const looseShape = z.string().refine((value) => looseShapeOf(value) !== null, "not a shape");

/// Either vocabulary, for the column a filed cut records its shape in. One
/// column because a row only ever has to say what it was asked at, and the two
/// spellings cannot collide: `shapeAsked` is what decides whether a string is a
/// shape at all, so the column still cannot hold anything unreadable.
const askedShape = z.string().refine((value) => shapeAsked(value) !== null, "not a shape");

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

/// Every object belonging to the versions of a reference, and to the versions of
/// those — a cut of a cut is one crop the director made of another, and it is
/// bytes in the bucket like any other. Walked a generation at a time rather than
/// recursively so the whole chain costs one query per level, and the chain is
/// short: it is as deep as a director has cropped into one photograph.
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

/// The rows that are photos of the project rather than cuts made out of one.
///
/// Anything answering "does this project already hold this picture?" has to ask
/// it of these alone: a version is deliberately absent from the gallery, so a
/// row matched against a version is a row the director is told about in a grid
/// that does not contain it.
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
  /// Gallery order: favorites first, newest first within each group.
  ///
  /// Originals only. A modified version — agent 3's crop — is a reference in
  /// every way that matters to the board and to the analyzer, but it is not a
  /// photo of the project: it belongs under the properties of the frame it came
  /// out of, and a grid that showed both would show the same picture twice.
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const references = await ctx.db.reference.findMany({
        where: { projectId: input.projectId, ...ORIGINALS_ONLY },
        orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
      });
      return references.map(forDisplay);
    }),

  /// Where the references a board's elements name actually live. A board image
  /// is a `ref:` pointer, and the scene load resolves those against the board's
  /// own project — so an element copied from a board in another project draws
  /// this session and reloads as an empty box. This is what tells the board the
  /// difference between a pointer it can keep and one it has to bring the photo
  /// in for.
  ///
  /// Three answers, not two. `inProject` needs nothing done; `elsewhere` is one
  /// of the director's own photos in another of their projects, which is a copy
  /// the board can make; an id in neither is a reference that has been deleted —
  /// or was never theirs — and there is nothing to fetch. The last case is
  /// silence rather than an error for the same reason `sceneFiles` leaves the
  /// element as a placeholder: the gallery's own delete already decided that.
  locateForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        ids: z.array(z.string()).min(1).max(REFERENCE_LOCATE_LIMIT),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);

      /// Scoped to the user's own projects throughout: an id belonging to
      /// somebody else is absent from both lists rather than reported as
      /// existing, which is the same 404-not-403 rule the rest of this router
      /// holds to.
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

  /// What one reference is, asked by id — for the places holding a reference id
  /// and nothing else.
  ///
  /// The board is exactly that. `listByProject` cannot answer it: that list is
  /// the gallery's, originals only, so an element pointing at a modified version
  /// is missing from it — and missing from that list is indistinguishable, to a
  /// lookup that scans it, from a reference that has been deleted. A cut is
  /// dragged onto a board like any photo, so the board has to be able to say
  /// what one is instead of calling it gone.
  ///
  /// The frame it came out of rides along: a cut's own title is the frame's plus
  /// "(crop N)", which says which photograph this is a piece of only to someone
  /// who already knows the photograph. On a board, nothing else on screen does.
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
          gcsUri: true,
          thumbGcsUri: true,
          source: { select: { id: true, title: true } },
        },
      });
      if (!reference) throw new TRPCError({ code: "NOT_FOUND" });
      return forDisplay(reference);
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

  /// The cuts of one frame — what the gallery deliberately does not show.
  ///
  /// A version is not a photo of the project, so it has no tile; it is a way
  /// this photograph has been used, and that belongs beside the properties of
  /// the frame it came out of. One level deep: a cut of a cut is listed under
  /// the cut it was made from, which is where a director went to make it.
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
          /// The format it was cut at, so a nudge about this row is asked at the
          /// shape it already is rather than silently giving it up.
          editAspect: true,
          width: true,
          height: true,
          createdAt: true,
          gcsUri: true,
          thumbGcsUri: true,
        },
      });
      return versions.map(forDisplay);
    }),

  /// Every cut in the project and the frame it was cut from — what the gallery
  /// is allowed to know about the versions it deliberately does not show.
  ///
  /// Two questions are asked of it, and both are about rows with no tile. A tile
  /// says how many cuts were made of it (`versionCountIndex`), because otherwise
  /// the grid looks exactly as it did before the crop was made and the panel
  /// holding it is a place the director has to already know to go. And a removal
  /// says which boards it would break (`versionDescendants`), because deleting a
  /// frame deletes its cuts with it and a cut is on a board like any photograph.
  ///
  /// The links rather than a `groupBy` count: the count answers the first
  /// question and cannot answer the second, and one project-wide read serving
  /// both is the same trade `analysisByProject` makes — the grid renders every
  /// tile, so a per-tile query is a round trip per photo.
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

  /// The same answer as `properties`, for every reference in the project at
  /// once — the grid renders every tile, so a per-tile query would be a round
  /// trip per image on every poll. Merged into per-reference views client side
  /// by `galleryAnalysisIndex`, which is also where the client-written `input`
  /// Json is parsed.
  analysisByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }): Promise<GalleryAnalysisSource> => {
      await ownedProject(ctx, input.projectId);

      const [analyses, runs] = await Promise.all([
        ctx.db.analysis.findMany({
          where: { reference: { projectId: input.projectId } },
          select: { referenceId: true, ...ANALYSIS_PROPERTIES },
        }),
        /// Newest first and capped: runs accumulate per re-analysis, and only
        /// the newest per reference is read. Past the cap a reference with no
        /// `Analysis` row reads as still-pending rather than as ready — the tile
        /// keeps its spinner, the panel is still the place with the real answer.
        ctx.db.agentRun.findMany({
          where: { projectId: input.projectId, agent: AgentKind.ANALYZER },
          orderBy: { startedAt: "desc" },
          take: GALLERY_RUN_LIMIT,
          select: { input: true, status: true, error: true },
        }),
      ]);

      return { analyses, runs };
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

  /// Which of a drop's images this project already holds, asked before any
  /// bytes leave the browser — the difference between a re-dropped folder
  /// costing one round trip and it costing a second copy of every photo in it.
  /// Rows added before content hashing have none and never match, so they keep
  /// behaving exactly as they did.
  ///
  /// Asked of originals only. A crop carries the digest of the bytes the browser
  /// cut, so a director who exported a crop and dropped it back would have the
  /// drop skipped as "already in this project" while the gallery it names shows
  /// nothing — the drop would read as ignored. What the dropzone is asking is
  /// whether uploading buys a second copy of a photo the project holds, and a
  /// version is not that photo.
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
      /// The `in` filter never matches a null, so every row here has one.
      return matches.map((match) => match.contentHash!);
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
        contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
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
      /// The row and its analyzer job land together, which is what lets the
      /// panel read a reference with no run as never-analyzed and offer to
      /// analyze it, rather than having to wait out a job that may be coming.
      const reference = await ctx.db.$transaction(async (tx) => {
        const created = await tx.reference.create({ data: input });
        await enqueueAnalysis(tx, { projectId: created.projectId, referenceId: created.id });
        return created;
      });

      kickAnalyzerWorker();
      return reference;
    }),

  /// Agent 3, asked. "Just the hands", "the sign over the door" — the director
  /// says what they want out of a frame and this answers with the region of it
  /// that is that, as fractions, plus the name and the label the version will be
  /// filed under.
  ///
  /// It stops one step short of a version existing, because the cut cannot
  /// happen here: there is no server-side image pipeline in this app (§II.6).
  /// The browser reads the original back same-origin, cuts these fractions out
  /// of it exactly as a hand-made crop is cut, and comes back to `addVersion`.
  /// So one vision call is one plan, and a plan the director does not take costs
  /// nothing but the call.
  ///
  /// A plan they do not take is also the commonest way the *next* one is asked
  /// for: the box is on the frame and what is wrong with it is a nudge about
  /// that box — tighter, more headroom, take in the lamp — rather than a fresh
  /// description of the photograph. `previous` is that box, handed back so the
  /// second call adjusts the first answer instead of reading the frame again
  /// from nothing and returning a different shot.
  ///
  /// An ask can also name the *shape* the cut is to be — scope, widescreen, a
  /// square. The model is told the format so it frames for it, and the box it
  /// answers with is held to it here rather than in the prompt: a ratio is a
  /// ratio of the frame's pixels, the box is a share of each of the frame's
  /// edges, and the size of the frame is a thing this row knows and the model is
  /// never given.
  planCrop: protectedProcedure
    .input(
      z.object({
        referenceId: z.string(),
        prompt: z.string().min(1).max(EDIT_INTENT_LIMIT),
        /// The offer on screen, not a row: an adjustment happens while the plan
        /// is still a plan, so there is no version id to name here.
        previous: z
          .object({
            cropBox: z.array(z.number().int()).length(4),
            editIntent: z.string().max(EDIT_INTENT_LIMIT).default(""),
          })
          .optional(),
        /// The shape the cut is to be held to, when the director asked for one.
        /// Absent is "whatever shape this part of the frame is", which is the
        /// right answer for a reference nobody is composing to a format.
        aspect: cropShape.optional(),
        /// The shape the cut is to be *framed* as, when they named a shape
        /// without naming a number. Nothing is opened out afterwards — the box
        /// the cropper answers with is the cut — so this is passed to the model
        /// rather than applied to its answer, and the loop checks the band.
        ///
        /// Its own argument beside `aspect` because the two are different
        /// promises. Both together is not a state a caller should reach; the
        /// exact one wins, which is the rule `cropOffer` already resolves them
        /// by, so the two doors agree.
        loose: looseShape.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const reference = await ctx.db.reference.findFirst({
        where: { id: input.referenceId, project: { userId: ctx.user.id } },
        /// The frame's pixels, because a ratio is a ratio of them: 0-1000 is a
        /// share of each edge of a picture that is not square.
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

      /// One reading of "what shape was asked for", exact and loose together, so
      /// everything below carries whichever arrived without a second branch. The
      /// exact one wins by being read first, which is the rule `cropOffer` uses
      /// on the other door.
      const asked = shapeAsked(input.aspect ?? input.loose);
      const ratio = asked?.shape?.ratio ?? null;
      /// The band, when a word was said. No arithmetic follows it — that is what
      /// makes it loose — so it goes to the model with the frame's pixels and the
      /// loop checks what comes back against it.
      const framed = asked?.loose ?? null;
      /// Refused before the call rather than after it: a frame with no recorded
      /// size cannot be cut to a shape, and asking the model first would spend a
      /// vision call to arrive at the same answer. Said as what it is, since the
      /// same frame crops perfectly well when no shape is asked for.
      ///
      /// Only for an exact shape. A loose ask on a frame with no recorded size is
      /// answered rather than refused: the band is the one thing that cannot be
      /// checked there, and refusing the whole cut over an unmeasurable check
      /// would turn an ask that works into a refusal made after the read.
      if (ratio && !(reference.width && reference.height)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `this frame's pixel size was never recorded, so a crop of it cannot be held to ${input.aspect} — ask without a shape`,
        });
      }

      /// Started RUNNING rather than queued: this is a single call inside the
      /// request, unlike agent 2's backlog. The row is here so that what the
      /// cropper could not answer is readable afterwards instead of being a
      /// toast that has gone.
      const run = await ctx.db.agentRun.create({
        data: {
          projectId: reference.projectId,
          agent: AgentKind.CROPPER,
          status: RunStatus.RUNNING,
          /// The box that was on screen is part of what was asked, so the run
          /// row says which answer this one was an adjustment of — a chain of
          /// runs over one frame is otherwise a list of unrelated prompts.
          input: {
            referenceId: reference.id,
            prompt: input.prompt,
            ...(input.previous && { previous: input.previous }),
            /// Whichever way the shape was said, under one key: what the ledger
            /// is read for is which asks cost what, and a loose ask is one of
            /// them.
            ...(asked && { aspect: asked.shape?.label ?? asked.loose?.id }),
          },
        },
        select: { id: true },
      });

      /// Held outside the try so the refusals below — which are thrown *after*
      /// the model answered — still record what the answer cost. A crop refused
      /// because the whole frame is the shot read the photograph all the same.
      let spent: ReturnType<typeof spentColumns> | undefined;

      try {
        const answer = await cropReference({
          gcsUri: reference.gcsUri,
          prompt: input.prompt,
          title: reference.title,
          previous: input.previous,
          ...(asked?.shape && { aspect: asked.shape.label }),
          /// The frame rides with the band and only with it: it is what makes a
          /// loose ask checkable, since the box is a share of each edge and the
          /// shape it lands at is a shape of the frame's pixels.
          ...(framed && { loose: framed, frame: reference }),
        });
        spent = spentColumns(answer.model, answer.usage);

        /// The shape is arithmetic on the answer, not a thing the model is
        /// trusted with: it is told the format so it frames for it, and the box
        /// it returns is then opened out about its own centre until its pixels
        /// are exactly that ratio. Told the shape and left to count, it would
        /// have to know the frame's size, which it is never given.
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
        /// Not a failure of the model: it read the frame and the frame is the
        /// shot. Told as a refusal all the same, because the alternative is a
        /// second copy of a photograph filed as a crop of it.
        if (!plan) {
          throw new CropperError("the whole frame is the shot — there is nothing to crop out of it");
        }

        await ctx.db.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.SUCCEEDED,
            /// The attempt count rides on the row because it is what the ask
            /// actually cost: a box the model got right first time and one it
            /// reached on the third read are the same crop and not the same
            /// bill (§III.3).
            output: { ...plan, model: answer.model, attempts: answer.attempts },
            finishedAt: new Date(),
            ...spent,
          },
        });

        /// The rationale rides on the plan rather than beside it: the run row
        /// records no version id, so what the browser does not carry back to
        /// `addVersion` is reasoning no filed cut can ever be matched to.
        ///
        /// The band rides back too, for the same reason the format does on the
        /// other door: the pixels cannot say afterwards what the cut was framed
        /// *for*, and a nudge about this box has to be asked at the same shape or
        /// "a little tighter" comes back as a rectangle.
        return { runId: run.id, ...plan, loose: framed?.id ?? null };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        /// A cropper that gave up carries its own reads out with it; a refusal
        /// reached after it answered already has them.
        const carried = usageThrown(cause);
        spent ??= carried ? spentColumns(MODELS.PRO, carried) : undefined;
        await ctx.db.agentRun.update({
          where: { id: run.id },
          data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
        });

        /// What the cropper answered is the director's to read; what went wrong
        /// reaching it is ours, and says so.
        throw new TRPCError({
          code: cause instanceof CropperError ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
          message: cause instanceof CropperError ? message : "the cropper could not be reached",
          cause,
        });
      }
    }),

  /// The other half of `planCrop`: the bytes the browser cut are in the bucket,
  /// and this is the row that makes them a *version* of the frame they came out
  /// of rather than a photo of the project.
  ///
  /// A version is a reference in every respect the board and the analyzer care
  /// about — its own bytes, its own id, its own analysis — which is what lets
  /// agent 4 place an original or any cut of it without knowing which it has.
  /// The edit columns below are the whole difference, and the title is derived
  /// here rather than taken from the client: what a cut of a frame is called
  /// follows from the frame.
  addVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        sourceReferenceId: z.string(),
        gcsUri: z.string(),
        thumbGcsUri: z.string().optional(),
        editIntent: z.string().max(EDIT_INTENT_LIMIT).default(""),
        /// The cropper's own line on why this box, handed back from the plan.
        /// Absent on a crop the director drew: nobody reasoned about it in
        /// words.
        editRationale: z.string().max(EDIT_RATIONALE_LIMIT).default(""),
        cropBox: z.array(z.number().int()).length(4),
        /// The shape the box was held to before it was cut, when one was asked
        /// for. Recorded because the pixels cannot answer it afterwards: the box
        /// is a share of each edge of the frame and the ratio survives the round
        /// trip only to within the rounding, so a cut that measures 1.78 and one
        /// asked for at 16:9 are the same row without this.
        ///
        /// Or the loose word it was framed as, in the same column. A cut framed
        /// roughly square lands at some exact ratio like any other, so the pixels
        /// answer "what shape is it" and cannot answer "what was asked" — which
        /// is the question a nudge of this row, and the badge beside it, are both
        /// about.
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

      /// The source is read out of this project rather than out of the user's
      /// projects at large: a version lives with the frame it is a cut of, and
      /// a row pointing across projects would be a photo the gallery of neither
      /// one shows.
      const source = await ctx.db.reference.findFirst({
        where: { id: input.sourceReferenceId, projectId: input.projectId },
        select: { id: true, title: true },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const box = cropBoxOf(input.cropBox);
      if (!box) throw new TRPCError({ code: "BAD_REQUEST", message: "not a box of this reference" });

      const reference = await ctx.db.$transaction(async (tx) => {
        const created = await tx.reference.create({
          data: {
            projectId: input.projectId,
            gcsUri: input.gcsUri,
            thumbGcsUri: input.thumbGcsUri,
            title: croppedReferenceTitle(source.title),
            width: input.width,
            height: input.height,
            contentHash: input.contentHash,
            sourceReferenceId: source.id,
            editIntent: asEditIntent(input.editIntent),
            editRationale: asEditRationale(input.editRationale),
            cropBox: cropBoxColumns(box),
            editAspect: input.editAspect ?? "",
          },
        });
        /// Analyzed like any other reference. A crop is what the director means
        /// to put on the board, so its palette and its composition are the ones
        /// worth having — reading them off the frame it was cut out of is
        /// reading the parts they cut away.
        await enqueueAnalysis(tx, { projectId: created.projectId, referenceId: created.id });
        return created;
      });

      kickAnalyzerWorker();
      return forDisplay(reference);
    }),

  /// What a cut is called, in the director's own words rather than in the words
  /// of whatever wrote the label.
  ///
  /// Nothing else tells the cuts of one frame apart: they all carry that frame's
  /// title plus "(crop N)", so the label is the row. And it is written by the
  /// cropper's reading of the frame, by the chain of nudges an adjustment
  /// composes, or by the single fixed line a crop drawn on the board gets — none
  /// of which is the director. It is also what a version is captioned with on the
  /// board, so a row filed under the wrong words writes those words onto the
  /// moodboard. Until now the only remedy for either was deleting the cut, which
  /// may be the thing a board is standing on.
  ///
  /// Versions only. An original is named by its title — the file the director
  /// brought in — and an `editIntent` on one would be the label of an edit that
  /// never happened.
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
      /// Nothing to file — an emptied field is a cancel, and a name re-typed as
      /// it stands is the name it has. Answered with the row rather than refused:
      /// what was asked for is the state the row is already in.
      if (relabeled) {
        await ctx.db.reference.update({
          where: { id: reference.id },
          data: { editIntent: relabeled },
        });
      }

      return { id: reference.id, editIntent: relabeled ?? reference.editIntent };
    }),

  /// An image dragged onto the board from another page — Pinterest, Are.na, a
  /// search result. The browser hands over a URL and no bytes, and it cannot
  /// fetch them either: a cross-origin image is renderable but not *readable*,
  /// so the only place those pixels can be turned into a project reference is
  /// here.
  ///
  /// Which URLs may be fetched at all is `importableUrl`'s answer, applied again
  /// on every redirect hop — this is the one request in the app whose address a
  /// user chooses, and the network it is made from has things in it that answer
  /// to nobody outside.
  importFromUrl: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        url: z.string().max(REMOTE_IMAGE_URL_LIMIT),
        /// Measured by the browser off the same image, when it could load it.
        /// A hotlink-protected origin renders nothing there and still serves our
        /// server, so these are optional and the board lands the image square.
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);

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

      /// The same digest the dropzone and adoption store, so the same photo
      /// saved from a page and later dropped as a file is one row — and so
      /// dragging the same image in twice does not buy a second copy of it.
      ///
      /// Matched against originals only, for a stronger reason than the
      /// dropzone's: this returns the row, and returning a version would file an
      /// image the director brought in from the web as a cut of some other
      /// frame — titled after it, carrying its edit intent, and absent from the
      /// gallery the import was meant to fill.
      const contentHash = await hashFileContent(new Blob([image.bytes]));
      const existing = await ctx.db.reference.findFirst({
        where: { projectId: input.projectId, ...ORIGINALS_ONLY, contentHash },
      });
      if (existing) return forDisplay(existing);

      const gcsUri = await storeProjectUpload(input.projectId, image.contentType, image.bytes);
      /// The row and its analyzer job land together, exactly as in `add`: the
      /// difference between the two paths is where the bytes came from, not what
      /// a reference is once it exists.
      const reference = await ctx.db.$transaction(async (tx) => {
        const created = await tx.reference.create({
          data: {
            projectId: input.projectId,
            gcsUri,
            title: IMPORTED_IMAGE_TITLE,
            width: input.width,
            height: input.height,
            contentHash,
          },
        });
        await enqueueAnalysis(tx, { projectId: created.projectId, referenceId: created.id });
        return created;
      });

      kickAnalyzerWorker();
      return forDisplay(reference);
    }),

  /// What the browser could work out about a reference it did not upload.
  ///
  /// `importFromUrl` stores bytes the server fetched, and a server has no canvas
  /// — so those rows land with no thumbnail, and with no pixel size at all when
  /// the origin blocks hotlinking. The browser can read our *own* copy of the
  /// image (it is same-origin, which is the whole point of the streaming route),
  /// decode it and produce both. This is where they are written back.
  ///
  /// It only ever fills in: `derivedWrite` decides what is still absent, and the
  /// thumbnail is guarded on the row still having none, so two tabs deriving the
  /// same reference cannot leave one of the objects orphaned in the bucket.
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

      /// Client input, and served afterwards under this reference's own
      /// ownership check — so it has to be inside the project's prefix, exactly
      /// as in `add`.
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
        /// Guarded on the thumbnail still being absent rather than read-then-
        /// write: the read above is a second tab's window, and the loser must
        /// find out so it can throw its object away instead of overwriting a
        /// locator the gallery is already serving.
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
      return forDisplay(reference);
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

    /// Deleting a frame deletes the cuts of it — that is the schema's cascade —
    /// and a cascade deletes rows, not objects. Their bytes have to be collected
    /// before the delete, because afterwards there is nothing left that knows
    /// they exist.
    const versions = await descendantUploads(ctx, reference.id);

    /// Row first, bytes second. Both orders can half-fail; this one leaves an
    /// orphan blob, the other leaves a tile whose image 404s.
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
