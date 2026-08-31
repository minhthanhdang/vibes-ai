import "server-only";
import { canvasBackgroundColour } from "@/lib/boards/board-background";
import { deckSlides, type DeckSlide } from "@/lib/decks/deck-plan";
import { boardPages, pageElements, type BoardPage } from "@/lib/pages/board-pages";
import { orderedPages } from "@/lib/pages/page-order";
import {
  persistableElements,
  referenceIdFromFileId,
  type SceneElement,
} from "@/lib/scene/moodboard-scene";
import { normalizeAnalysis, type AnalysisProperties } from "@/lib/analysis/analysis";
import {
  deckNotesRequests,
  deckStructureRequests,
  slidesWebViewLink,
  type SlidesApi,
} from "@/server/decks/slides-api";
import type { DeckCredential } from "@/server/decks/credential";
import type { PrismaClient } from "@/generated/prisma/client";

export type PageRenderRef = {
  projectId: string;
  boardId: string;
  pageId: string;
  revision: number;
};

export type DeckRenders = {
  present(page: PageRenderRef): Promise<boolean>;
  readUrl(page: PageRenderRef): Promise<string>;
};

export type DeckExportDb = {
  moodboard: Pick<PrismaClient["moodboard"], "findFirst">;
  analysis: Pick<PrismaClient["analysis"], "findMany">;
  deck: Pick<PrismaClient["deck"], "create">;
};

export type DeckExportDeps = {
  db: DeckExportDb;
  credential: (userId: string) => Promise<DeckCredential>;
  slides: (accessToken: string) => SlidesApi;
  renders: DeckRenders;
  onNotesFailure?: (cause: unknown) => void;
};

export type DeckExportResult =
  | { status: "needsConsent" }
  | { status: "missingRenders"; pageIds: string[] }
  | {
      status: "exported";
      deckId: string;
      slidesFileId: string;
      webViewLink: string;
      slideCount: number;
      notesWritten: boolean;
    };

export class DeckExportError extends Error {
  override readonly name = "DeckExportError";
}

export async function exportBoardToSlides(
  deps: DeckExportDeps,
  { userId, boardId }: { userId: string; boardId: string },
): Promise<DeckExportResult> {
  const board = await deps.db.moodboard.findFirst({
    where: { id: boardId, project: { userId } },
    select: {
      id: true,
      projectId: true,
      title: true,
      revision: true,
      elements: true,
      appState: true,
      previewOrder: true,
    },
  });
  if (!board) throw new DeckExportError("that board is not one of yours");

  const elements = persistableElements(board.elements);
  const pages = orderedPages(boardPages(elements), board.previewOrder);
  if (pages.length === 0) throw new DeckExportError("this board has no pages to put in a deck");

  const credential = await deps.credential(userId);
  if (credential.status === "needsConsent") return { status: "needsConsent" };

  const refOf = (pageId: string): PageRenderRef => ({
    projectId: board.projectId,
    boardId: board.id,
    pageId,
    revision: board.revision,
  });

  const drawn = await Promise.all(pages.map((page) => deps.renders.present(refOf(page.id))));
  const missing = pages.filter((_, at) => !drawn[at]).map((page) => page.id);
  if (missing.length > 0) return { status: "missingRenders", pageIds: missing };

  const slides = deckSlides(
    pages,
    canvasBackgroundColour(board.appState),
    await analysesByPage(deps.db, elements, pages),
  );

  const imageUrls = new Map(
    await Promise.all(
      pages.map(
        async (page) => [page.id, await deps.renders.readUrl(refOf(page.id))] as const,
      ),
    ),
  );

  const api = deps.slides(credential.accessToken);
  const made = await api.create(board.title);
  await api.batchUpdate(
    made.presentationId,
    deckStructureRequests(slides, imageUrls, made.firstSlideId),
  );

  const webViewLink = slidesWebViewLink(made.presentationId);
  const deck = await deps.db.deck.create({
    data: {
      projectId: board.projectId,
      moodboardId: board.id,
      slidesFileId: made.presentationId,
      webViewLink,
    },
    select: { id: true },
  });

  return {
    status: "exported",
    deckId: deck.id,
    slidesFileId: made.presentationId,
    webViewLink,
    slideCount: slides.length,
    notesWritten: await writeNotes(deps, api, made.presentationId, slides),
  };
}

async function writeNotes(
  deps: DeckExportDeps,
  api: SlidesApi,
  presentationId: string,
  slides: readonly DeckSlide[],
): Promise<boolean> {
  if (slides.every((slide) => !slide.notes)) return true;
  try {
    const shapes = await api.notesShapes(presentationId);
    await api.batchUpdate(presentationId, deckNotesRequests(slides, shapes));
    return true;
  } catch (cause) {
    (deps.onNotesFailure ?? defaultOnNotesFailure)(cause);
    return false;
  }
}

function defaultOnNotesFailure(cause: unknown) {
  console.error("deck built, speaker notes not written:", cause);
}

async function analysesByPage(
  db: DeckExportDb,
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
): Promise<(pageId: string) => readonly AnalysisProperties[]> {
  const referencesOnPage = new Map<string, string[]>();
  const wanted = new Set<string>();

  for (const page of pages) {
    const onPage: string[] = [];
    for (const element of pageElements(elements, pages, page)) {
      const referenceId = referenceIdFromFileId(element.fileId);
      if (!referenceId || onPage.includes(referenceId)) continue;
      onPage.push(referenceId);
      wanted.add(referenceId);
    }
    referencesOnPage.set(page.id, onPage);
  }

  if (wanted.size === 0) return () => [];

  const rows = await db.analysis.findMany({ where: { referenceId: { in: [...wanted] } } });
  const byReference = new Map(rows.map((row) => [row.referenceId, normalizeAnalysis(row)]));

  return (pageId) =>
    (referencesOnPage.get(pageId) ?? []).flatMap((referenceId) => {
      const analysis = byReference.get(referenceId);
      return analysis ? [analysis] : [];
    });
}
