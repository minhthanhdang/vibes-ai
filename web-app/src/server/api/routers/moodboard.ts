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
import { BOARD_TITLE_LIMIT, duplicateBoardTitle } from "@/lib/scene/moodboard-boards";
import { swapOnBoard } from "@/lib/boards/board-swap";
import { boardShown } from "@/lib/boards/board-shown";
import { layoutById } from "@/lib/layout/moodboard-layouts";
import { forDisplay } from "@/server/references/display";
import type { BoardAttachment } from "@/lib/agent/agent-tools";
import {
  boardRenderGcsUri,
  boardRenderUploadUrl,
  copyBoardRender,
  deleteBoardRender,
} from "@/server/moodboards/render";
import { boardRenderPath } from "@/server/moodboards/display";
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

/// The board's picture, or nothing. Both columns are checked because a render
/// that never landed leaves neither, and one taken by an older build could leave
/// the uri without the revision it was of — and a preview nothing can date is a
/// preview that eventually lies about the board.
function renderUrl(board: { id: string; renderUri: string | null; renderRevision: number | null }) {
  if (!board.renderUri || board.renderRevision === null) return null;
  return boardRenderPath(board.id, board.renderRevision);
}

/// The excalidraw files map for a set of reference pointers, scoped to the
/// project allowed to see them. A `fileId` is stored client input, so one naming
/// a reference from another project must resolve to nothing rather than to that
/// project's image.
async function filesForReferences(
  ctx: OwnedContext,
  projectId: string,
  referenceIds: string[],
  variants: ReadonlyMap<string, BoardImageVariant>,
): Promise<SceneFile[]> {
  if (referenceIds.length === 0) return [];
  const references = await ctx.db.reference.findMany({
    where: { id: { in: referenceIds }, projectId },
    /// `thumbGcsUri` is read for its type, not its path: the URL names the
    /// variant either way, but a row with no thumbnail is served its original
    /// and the file entry has to say so.
    select: { id: true, gcsUri: true, thumbGcsUri: true, createdAt: true },
  });
  return sceneFiles(references, variants);
}

export type MoodboardScene = {
  id: string;
  title: string;
  revision: number;
  /// The revision the board's stored picture was drawn from. The canvas takes a
  /// new one when this is behind — including when it is null, which is a board
  /// that has never been looked at from outside.
  renderedRevision: number | null;
  elements: SceneElement[];
  files: SceneFile[];
  appState: Record<string, unknown>;
};

export type MoodboardLibrary = {
  items: LibraryItem[];
  files: SceneFile[];
};

export const moodboardRouter = createTRPCRouter({
  /// Oldest first: a project's first board is the one the director keeps
  /// returning to, so it should not move when a second is added.
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
      /// The bucket path is dropped the same way a reference's is: what the
      /// browser gets is an app URL behind the same ownership check.
      return boards.map((board) => ({
        id: board.id,
        title: board.title,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        renderUrl: renderUrl(board),
      }));
    }),

  /// Which of the project's boards each reference is on. Read by the gallery
  /// before a removal: deleting a reference deletes its bucket objects, and the
  /// boards holding it are on the other side of a view switch where nothing can
  /// be seen from here.
  ///
  /// Every board's scene is scanned rather than an index maintained: a board is
  /// rewritten by an autosave every second while it is being arranged, so an
  /// index would be a second copy of the scene kept current by every write. What
  /// crosses the wire is ids and titles, never the elements.
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

  /// A second board holding this one's scene. Composing a board is exploring a
  /// direction, and the way a director explores a second one is from the first:
  /// without this, the alternative is either overwriting the version that works
  /// or rebuilding it photo by photo.
  ///
  /// The copy is a plain new board — its own row, its own revision, its own
  /// autosave — and the scene is copied by value. Nothing in it is shared with
  /// the source: an image element names `ref:<Reference.id>`, and a reference
  /// belongs to the project both boards are in, so the copy resolves the same
  /// photos without owning or duplicating any bytes.
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
          revision: true,
          renderUri: true,
          renderRevision: true,
          elements: true,
          appState: true,
        },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      /// Named by the client for the same reason a new board is: only the tab
      /// row can see what the sibling titles are. The fallback is here so the
      /// copy is never nameless when it is made by something that is not the UI.
      const title = input.title ?? duplicateBoardTitle([], source.title);

      const copy = await ctx.db.moodboard.create({
        data: {
          projectId: source.projectId,
          title,
          widthPx: source.widthPx,
          heightPx: source.heightPx,
          /// The template it was composed at travels with the scene: without it
          /// the copy is a board nobody composed, so nothing can say which of its
          /// pictures sit loosely in their slot and a rebuild of it picks a shape
          /// by block count instead of keeping the one being varied.
          layout: source.layout,
          /// Filtered on the way out of the source row exactly as `scene` does:
          /// a row written by an older build is input too.
          elements: persistableElements(source.elements) as unknown as Prisma.InputJsonValue,
          appState: persistedAppState(source.appState) as Prisma.InputJsonValue,
        },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      });

      /// The copy is at revision 0 holding exactly the scene the source's
      /// picture was taken of, so that picture is a true picture of it — and
      /// copying the object is the only way it can have one, since a board is
      /// drawn by the tab showing it and the copy is not open yet.
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
          renderUri: true,
          renderRevision: true,
          elements: true,
          appState: true,
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
        files: await filesForReferences(
          ctx,
          board.projectId,
          sceneReferenceIds(elements),
          sceneImageVariants(elements),
        ),
      };
    }),

  /// The board's pages, for the picker the director attaches one from (§V.5).
  ///
  /// A second read of the same scene rather than a field on `scene`, because the
  /// two are pinned on opposite terms: the editor's copy is fetched once and never
  /// refetched — excalidraw owns the scene from the moment it mounts, so a
  /// background refetch would silently revert whatever has been drawn since — and
  /// a picker showing pages that were deleted ten minutes ago is a message
  /// attaching a rectangle that is not there. Behind its own key, this is free to
  /// be as fresh as the chat needs.
  ///
  /// It is also the honest list to pick from: what goes up is built from the
  /// stored scene, so the pages this names are exactly the pages the model can be
  /// handed — a page drawn on the canvas a second ago and not yet saved is not one
  /// of them.
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
        /// What the pages were read at. The attachment carries it back up, so a
        /// picture taken of a page can be held against the scene it was of.
        revision: board.revision,
        pages: pageDigests(persistableElements(board.elements)),
      };
    }),

  /// The project's element library, in the shape excalidraw is initialised with.
  /// Its items are groups of the same elements a board holds, so an item made
  /// from a photo names a reference — and the panel draws its previews from the
  /// same files map the canvas does, so those come back with it.
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
        /// A library item's elements carry the size they had on the board they
        /// were made from, so the panel's previews are decided by the same rule
        /// the canvas uses rather than by how small the panel draws them.
        files: await filesForReferences(
          ctx,
          project.id,
          libraryReferenceIds(items),
          sceneImageVariants(items.flatMap((item) => item.elements)),
        ),
      };
    }),

  /// Excalidraw hands back the whole library after every change, so this is a
  /// replace rather than an append — which is also what makes removing an item
  /// work. Deliberately not revision-guarded like the scene: the list is written
  /// by a deliberate, occasional action rather than by an autosave, and a
  /// conflict dialog over adding a sticker would cost more than the rare loss of
  /// one item added in another tab in the same minute.
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

  /// One picture put in the place of another, from the browser rather than from
  /// the orchestrator.
  ///
  /// The same edit `swap_on_board` makes, reached by the other door: a cut the
  /// assistant offered *for a board* carries that board on the offer, so the
  /// moment the director accepts the cut in the properties panel it takes the
  /// frame's place. Without this the loop needs a third turn of conversation — a
  /// paid round of routing to make a free edit the director has already asked
  /// for by accepting.
  ///
  /// Nothing here is a judgement, which is why it is a procedure and not an
  /// agent: which picture goes where was answered by the crop that was asked for.
  swapReference: protectedProcedure
    .input(z.object({ boardId: z.string(), takeOff: z.string(), putOn: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ attachment: BoardAttachment }> => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: {
          id: true,
          projectId: true,
          title: true,
          revision: true,
          elements: true,
          layout: true,
          widthPx: true,
          heightPx: true,
        },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      /// Both ends read from the board's own project: a reference id crossing the
      /// wire is client input, and one naming another project's picture must not
      /// be able to land on this board.
      const references = await ctx.db.reference.findMany({
        where: { projectId: board.projectId },
        select: { id: true, width: true, height: true, gcsUri: true, thumbGcsUri: true },
      });
      const byId = new Map(references.map((reference) => [reference.id, reference]));
      if (!byId.has(input.putOn)) throw new TRPCError({ code: "NOT_FOUND" });

      const elements = persistableElements(board.elements);
      const swap = swapOnBoard({
        elements,
        layout: layoutById(board.layout),
        swaps: [{ takeOff: input.takeOff, putOn: input.putOn }],
        sizeOf: (id) => byId.get(id),
      });
      if (!swap.swapped.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "that picture is not on the board" });
      }

      /// Guarded exactly as the autosave and the agent's own swap are: the
      /// director may have this board open in another tab, and the loser reloads
      /// rather than being overwritten. The stored render is disowned because it
      /// is a picture of the board as it was.
      const written = await ctx.db.moodboard.updateMany({
        where: { id: board.id, revision: board.revision },
        data: {
          elements: swap.elements as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          renderRevision: null,
        },
      });
      if (written.count === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "board changed elsewhere" });
      }

      return {
        /// The board as the chat draws it, built here because the thumbnails are
        /// signed URLs and the arrangement is the scene this call just wrote —
        /// the browser has neither.
        attachment: boardShown({
          board,
          elements: swap.elements,
          thumbUrlOf: (id) => {
            const reference = byId.get(id);
            return reference ? forDisplay(reference).thumbUrl : null;
          },
        }),
      };
    }),

  /// A picture of the board, taken by the browser that is showing it — drawing
  /// an excalidraw scene needs a canvas, and the only place there is one is the
  /// tab the director is composing in.
  ///
  /// The bytes go browser → GCS like a reference's: a full-size PNG of a board
  /// is past what a function may accept as a body, and there is nothing the
  /// server would do with it on the way past. The object path is the server's,
  /// derived from ids it has already checked, so unlike an upload the locator
  /// never has to be verified on the way back.
  renderUploadUrl: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);
      const { url } = await boardRenderUploadUrl(board.projectId, board.id);
      return { url, contentType: BOARD_RENDER_CONTENT_TYPE };
    }),

  /// Called once the PUT has landed. `revision` is the scene the picture is of,
  /// not necessarily the one the board is on by now — a save that landed while
  /// the canvas was drawing leaves the render behind, and saying so here is what
  /// makes the next quiet period take another one rather than the board keeping
  /// a preview of a scene it has moved past.
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

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.id);
      await ctx.db.moodboard.delete({ where: { id: board.id } });

      /// The row is what makes the picture reachable, so it goes first and the
      /// object after: a failed delete is an orphan we pay for, where the other
      /// order would be a board whose preview 404s.
      try {
        await deleteBoardRender(board.projectId, board.id);
      } catch (cause) {
        console.error(`board ${board.id} removed, its render orphaned:`, cause);
      }

      return { id: board.id };
    }),
});
