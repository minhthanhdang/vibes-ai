import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import {
  MOODBOARD_ELEMENT_LIMIT,
  exceedsSceneByteLimit,
  persistableElements,
  persistedAppState,
  sceneFiles,
  sceneReferenceIds,
  type SceneElement,
  type SceneFile,
} from "@/lib/moodboard-scene";
import type { Context } from "@/server/api/trpc";
import type { Prisma } from "@/generated/prisma/client";

type OwnedContext = Context & { user: { id: string } };

async function ownedProject(ctx: OwnedContext, projectId: string) {
  const project = await ctx.db.project.findFirst({
    where: { id: projectId, userId: ctx.user.id },
    select: { id: true },
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

/// Someone else's board is a 404 the same way someone else's reference is —
/// the existence of a row is private.
async function ownedBoard(ctx: OwnedContext, id: string) {
  const moodboard = await ctx.db.moodboard.findFirst({
    where: { id, project: { userId: ctx.user.id } },
    select: { id: true, projectId: true, title: true, revision: true },
  });
  if (!moodboard) throw new TRPCError({ code: "NOT_FOUND" });
  return moodboard;
}

export type MoodboardScene = {
  id: string;
  title: string;
  revision: number;
  elements: SceneElement[];
  files: SceneFile[];
  appState: Record<string, unknown>;
};

export const moodboardRouter = createTRPCRouter({
  /// Oldest first: a project's first board is the one the director keeps
  /// returning to, so it should not move when a second is added.
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      return ctx.db.moodboard.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      });
    }),

  create: protectedProcedure
    .input(z.object({ projectId: z.string(), title: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      return ctx.db.moodboard.create({
        data: { projectId: input.projectId, ...(input.title ? { title: input.title } : {}) },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      });
    }),

  /// The whole scene, in the shape excalidraw is initialised with. The stored
  /// elements are re-run through `persistableElements` on the way out because a
  /// row written by an older build — or by an agent — is input too.
  scene: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<MoodboardScene> => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
        select: {
          id: true,
          projectId: true,
          title: true,
          revision: true,
          elements: true,
          appState: true,
        },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const elements = persistableElements(board.elements);
      const referenceIds = sceneReferenceIds(elements);
      /// Scoped to the board's own project: a `fileId` is stored client input,
      /// so an element naming a reference from another project must resolve to
      /// nothing rather than to a signed URL for it.
      const references = referenceIds.length
        ? await ctx.db.reference.findMany({
            where: { id: { in: referenceIds }, projectId: board.projectId },
            select: { id: true, gcsUri: true, createdAt: true },
          })
        : [];

      return {
        id: board.id,
        title: board.title,
        revision: board.revision,
        elements,
        appState: persistedAppState(board.appState),
        files: sceneFiles(references),
      };
    }),

  /// The autosave. `revision` is what the client last saw; a mismatch means
  /// another tab has written since, and refusing is the difference between that
  /// tab's board reloading and its work being overwritten.
  save: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        revision: z.number().int().nonnegative(),
        /// Elements are validated by shape rather than by schema: excalidraw
        /// adds fields every release and this document is round-tripped back to
        /// it verbatim, so a per-field schema would quietly strip a director's
        /// work the first time we lagged a version behind.
        elements: z.array(z.unknown()).max(MOODBOARD_ELEMENT_LIMIT),
        appState: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);

      const elements = persistableElements(input.elements);
      const appState = persistedAppState(input.appState);
      if (exceedsSceneByteLimit(elements, appState)) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "board is too large to save" });
      }

      /// Guarded update rather than read-then-write: two autosaves landing at
      /// once are two transactions, and only one of them may win.
      const written = await ctx.db.moodboard.updateMany({
        where: { id: board.id, revision: input.revision },
        data: {
          elements: elements as unknown as Prisma.InputJsonValue,
          appState: appState as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (written.count === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "board changed elsewhere",
        });
      }

      return { revision: input.revision + 1 };
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), title: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);
      return ctx.db.moodboard.update({
        where: { id: board.id },
        data: { title: input.title },
        select: { id: true, title: true },
      });
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);
      await ctx.db.moodboard.delete({ where: { id: board.id } });
      return { id: board.id };
    }),
});
