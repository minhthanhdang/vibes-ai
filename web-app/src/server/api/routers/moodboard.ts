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
  type BoardImageVariant,
  type SceneElement,
  type SceneFile,
} from "@/lib/scene/moodboard-scene";
import { sceneImageVariants } from "@/lib/scene/moodboard-resolution";
import {
  LIBRARY_ITEM_LIMIT,
  exceedsLibraryByteLimit,
  libraryReferenceIds,
  persistableLibraryItems,
  type LibraryItem,
} from "@/lib/scene/moodboard-library";
import { BOARD_RENDER_CONTENT_TYPE, boardRenderIsCurrent } from "@/lib/scene/moodboard-render";
import { boardReferenceUsage, type ReferenceUsageEntry } from "@/lib/references/reference-usage";
import { pageDigests } from "@/lib/pages/page-contents";
import { boardPages, pageById } from "@/lib/pages/board-pages";
import { pageRemoval } from "@/lib/pages/page-remove";
import { BOARD_TITLE_LIMIT, duplicateBoardTitle } from "@/lib/scene/moodboard-boards";
import {
  boardRenderGcsUri,
  boardRenderUploadUrl,
  copyBoardRender,
  deleteBoardRender,
  pageRenderGcsUri,
  pageRenderUploadUrl,
} from "@/server/moodboards/render";
import { boardRenderPath } from "@/server/moodboards/display";
import type { Context } from "@/server/api/trpc";
import type { Prisma } from "@/generated/prisma/client";
import { sceneWrite } from "@/server/moodboards/scene-write";

type OwnedContext = Context & { user: { id: string } };

async function ownedProject(ctx: OwnedContext, projectId: string) {
  const project = await ctx.db.project.findFirst({
    where: { id: projectId, userId: ctx.user.id },
    select: { id: true },
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

async function ownedBoard(ctx: OwnedContext, id: string) {
  const moodboard = await ctx.db.moodboard.findFirst({
    where: { id, project: { userId: ctx.user.id } },
    select: { id: true, projectId: true, title: true, revision: true },
  });
  if (!moodboard) throw new TRPCError({ code: "NOT_FOUND" });
  return moodboard;
}

function renderUrl(board: { id: string; renderUri: string | null; renderRevision: number | null }) {
  if (!board.renderUri || board.renderRevision === null) return null;
  return boardRenderPath(board.id, board.renderRevision);
}

async function filesForReferences(
  ctx: OwnedContext,
  projectId: string,
  referenceIds: string[],
  variants: ReadonlyMap<string, BoardImageVariant>,
): Promise<SceneFile[]> {
  if (referenceIds.length === 0) return [];
  const references = await ctx.db.reference.findMany({
    where: { id: { in: referenceIds }, projectId },
    select: { id: true, gcsUri: true, thumbGcsUri: true, createdAt: true },
  });
  return sceneFiles(references, variants);
}

export type MoodboardScene = {
  id: string;
  title: string;
  revision: number;
  renderedRevision: number | null;
  elements: SceneElement[];
  files: SceneFile[];
  appState: Record<string, unknown>;
  previewOrder: string[];
  defaultPage: { width: number; height: number };
};

export type MoodboardLibrary = {
  items: LibraryItem[];
  files: SceneFile[];
};

export const moodboardRouter = createTRPCRouter({
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ownedProject(ctx, input.projectId);
      const boards = await ctx.db.moodboard.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          renderUri: true,
          renderRevision: true,
        },
      });
      return boards.map((board) => ({
        id: board.id,
        title: board.title,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        renderUrl: renderUrl(board),
      }));
    }),

  referenceUsage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }): Promise<ReferenceUsageEntry[]> => {
      await ownedProject(ctx, input.projectId);
      const boards = await ctx.db.moodboard.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, elements: true },
      });
      return boardReferenceUsage(boards);
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

  duplicate: protectedProcedure
    .input(
      z.object({ id: z.string(), title: z.string().trim().min(1).max(BOARD_TITLE_LIMIT).optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.moodboard.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
        select: {
          id: true,
          projectId: true,
          title: true,
          widthPx: true,
          heightPx: true,
          layout: true,
          layoutSlots: true,
          revision: true,
          renderUri: true,
          renderRevision: true,
          elements: true,
          appState: true,
        },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const title = input.title ?? duplicateBoardTitle([], source.title);

      const copy = await ctx.db.moodboard.create({
        data: {
          projectId: source.projectId,
          title,
          widthPx: source.widthPx,
          heightPx: source.heightPx,
          layout: source.layout,
          ...(source.layoutSlots !== null && {
            layoutSlots: source.layoutSlots as Prisma.InputJsonValue,
          }),
          ...sceneWrite(persistableElements(source.elements)),
          appState: persistedAppState(source.appState) as Prisma.InputJsonValue,
        },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      });

      if (boardRenderIsCurrent(source)) {
        try {
          await copyBoardRender(source.projectId, source.id, copy.id);
          await ctx.db.moodboard.update({
            where: { id: copy.id },
            data: { renderUri: boardRenderGcsUri(source.projectId, copy.id), renderRevision: 0 },
          });
        } catch (cause) {
          console.error(`board ${copy.id} duplicated without its picture:`, cause);
        }
      }

      return copy;
    }),

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
          renderUri: true,
          renderRevision: true,
          elements: true,
          appState: true,
          widthPx: true,
          heightPx: true,
          previewOrder: true,
        },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const elements = persistableElements(board.elements);

      return {
        id: board.id,
        title: board.title,
        revision: board.revision,
        renderedRevision: board.renderUri ? board.renderRevision : null,
        elements,
        appState: persistedAppState(board.appState),
        previewOrder: board.previewOrder,
        defaultPage: { width: board.widthPx, height: board.heightPx },
        files: await filesForReferences(
          ctx,
          board.projectId,
          sceneReferenceIds(elements),
          sceneImageVariants(elements),
        ),
      };
    }),

  setPreviewOrder: protectedProcedure
    .input(
      z.object({ id: z.string(), order: z.array(z.string()).max(MOODBOARD_ELEMENT_LIMIT) }),
    )
    .mutation(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
        select: { id: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const pages = new Set(boardPages(persistableElements(board.elements)).map(({ id }) => id));
      if (!input.order.every((id) => pages.has(id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "order names a page that is not on this board",
        });
      }

      await ctx.db.moodboard.update({
        where: { id: board.id },
        data: { previewOrder: input.order },
      });
      return { order: input.order };
    }),

  pages: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
        select: { id: true, title: true, revision: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        boardId: board.id,
        title: board.title,
        revision: board.revision,
        pages: pageDigests(persistableElements(board.elements)),
      };
    }),

  library: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }): Promise<MoodboardLibrary> => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true, libraryItems: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const items = persistableLibraryItems(project.libraryItems);
      return {
        items,
        files: await filesForReferences(
          ctx,
          project.id,
          libraryReferenceIds(items),
          sceneImageVariants(items.flatMap((item) => item.elements)),
        ),
      };
    }),

  saveLibrary: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        items: z.array(z.unknown()).max(LIBRARY_ITEM_LIMIT),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ownedProject(ctx, input.projectId);

      const items = persistableLibraryItems(input.items);
      if (exceedsLibraryByteLimit(items)) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "library is too large to save",
        });
      }

      await ctx.db.project.update({
        where: { id: project.id },
        data: { libraryItems: items as unknown as Prisma.InputJsonValue },
      });
      return { count: items.length };
    }),

  save: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        revision: z.number().int().nonnegative(),
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

      const written = await ctx.db.moodboard.updateMany({
        where: { id: board.id, revision: input.revision },
        data: {
          ...sceneWrite(elements),
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

  renderUploadUrl: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);
      const { url } = await boardRenderUploadUrl(board.projectId, board.id);
      return { url, contentType: BOARD_RENDER_CONTENT_TYPE };
    }),

  pageRenderUploadUrl: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        pageId: z.string(),
        revision: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
        select: { id: true, projectId: true, revision: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });
      if (board.revision !== input.revision) throw new TRPCError({ code: "CONFLICT" });

      const page = pageById(boardPages(persistableElements(board.elements)), input.pageId);
      if (!page) throw new TRPCError({ code: "NOT_FOUND" });

      const { url } = await pageRenderUploadUrl(
        board.projectId,
        board.id,
        page.id,
        board.revision,
      );
      return {
        url,
        contentType: BOARD_RENDER_CONTENT_TYPE,
        uri: pageRenderGcsUri(board.projectId, board.id, page.id, board.revision),
      };
    }),

  saveRender: protectedProcedure
    .input(z.object({ id: z.string(), revision: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);
      await ctx.db.moodboard.update({
        where: { id: board.id },
        data: {
          renderUri: boardRenderGcsUri(board.projectId, board.id),
          renderRevision: input.revision,
        },
      });
      return { renderedRevision: input.revision };
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

  removePage: protectedProcedure
    .input(z.object({ id: z.string(), pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.id, project: { userId: ctx.user.id } },
        select: { id: true, title: true, revision: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const removed = pageRemoval(persistableElements(board.elements), input.pageId);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "no such page on that board" });

      const written = await ctx.db.moodboard.updateMany({
        where: { id: board.id, revision: board.revision },
        data: {
          ...sceneWrite(removed.elements),
          revision: { increment: 1 },
          renderRevision: null,
        },
      });
      if (written.count === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "board changed elsewhere" });
      }

      return {
        boardId: board.id,
        pageId: removed.page.id,
        boardTitle: board.title,
        title: removed.page.name,
        pictures: removed.pictures.length,
        pagesLeft: boardPages(removed.elements).length,
      };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);
      await ctx.db.moodboard.delete({ where: { id: board.id } });

      try {
        await deleteBoardRender(board.projectId, board.id);
      } catch (cause) {
        console.error(`board ${board.id} removed, its render orphaned:`, cause);
      }

      return { id: board.id };
    }),
});
