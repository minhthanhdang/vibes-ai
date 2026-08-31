import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { googleSignInOpen } from "@/server/auth/google";
import { deckCredential } from "@/server/decks/credential";
import {
  exportBoardToSlides,
  DeckExportError,
  type DeckExportResult,
  type PageRenderRef,
} from "@/server/decks/deck-export";
import { slidesApi } from "@/server/decks/slides-api";
import { pageRenderGcsUri, pageRenderPresent } from "@/server/moodboards/render";
import { signedReadUrl } from "@/server/google/storage";
import type { Context } from "@/server/api/trpc";

type OwnedContext = Context & { user: { id: string } };

async function ownedBoard(ctx: OwnedContext, id: string) {
  const board = await ctx.db.moodboard.findFirst({
    where: { id, project: { userId: ctx.user.id } },
    select: { id: true, projectId: true },
  });
  if (!board) throw new TRPCError({ code: "NOT_FOUND" });
  return board;
}

function connectPath(projectId: string, boardId: string) {
  const next = `/projects/${projectId}?deck=${boardId}#preview`;
  return `/api/auth/google?intent=deck&next=${encodeURIComponent(next)}`;
}

const renders = {
  present: (page: PageRenderRef) =>
    pageRenderPresent(page.projectId, page.boardId, page.pageId, page.revision),
  readUrl: (page: PageRenderRef) =>
    signedReadUrl(pageRenderGcsUri(page.projectId, page.boardId, page.pageId, page.revision)),
};

export type DeckExportOutcome =
  | { status: "needsConsent"; authorizeUrl: string }
  | { status: "missingRenders"; pageIds: string[] }
  | {
      status: "exported";
      deckId: string;
      slidesFileId: string;
      webViewLink: string;
      slideCount: number;
      notesWritten: boolean;
    };

export const deckRouter = createTRPCRouter({
  slidesOpen: protectedProcedure.query(() => ({ open: googleSignInOpen() })),

  exportToSlides: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .mutation(async ({ ctx, input }): Promise<DeckExportOutcome> => {
      const board = await ownedBoard(ctx, input.boardId);
      if (!googleSignInOpen()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Google sign-in is off in this environment.",
        });
      }

      let result: DeckExportResult;
      try {
        result = await exportBoardToSlides(
          {
            db: ctx.db,
            credential: (userId) => deckCredential(ctx.db, userId),
            slides: slidesApi,
            renders,
          },
          { userId: ctx.user.id, boardId: board.id },
        );
      } catch (cause) {
        if (cause instanceof DeckExportError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: cause.message, cause });
        }
        throw cause;
      }

      if (result.status === "needsConsent") {
        return { status: "needsConsent", authorizeUrl: connectPath(board.projectId, board.id) };
      }
      return result;
    }),

  latestForBoard: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(async ({ ctx, input }) => {
      const board = await ownedBoard(ctx, input.boardId);
      return ctx.db.deck.findFirst({
        where: { moodboardId: board.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, slidesFileId: true, webViewLink: true, createdAt: true },
      });
    }),
});
