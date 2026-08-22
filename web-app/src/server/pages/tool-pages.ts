import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolReference } from "@/lib/agent/agent-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { boardLayout } from "@/lib/layout/custom-layout";
import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";
import {
  boardPages,
  pageById,
  pagePresetSize,
  pagesInReadingOrder,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { pageDigests } from "@/lib/pages/page-contents";
import { pageDuplication } from "@/lib/pages/page-duplicate";
import { pageStandsAsComposed } from "@/lib/pages/page-fit";
import { resizePage } from "@/lib/pages/page-resize";
import { persistableElements, type SceneElement } from "@/lib/scene/moodboard-scene";
import { sceneWrite } from "@/server/moodboards/scene-write";

/// The page tools both agents call, written once (compositor-v2.md §IV.2).
///
/// Lifted out of agent 6's tool closure with nothing changed on the way, on the
/// same terms as the five canvas tools in `@/server/canvas/tool-canvas`: a page
/// is a rectangle on the same scene the canvas tools write, so two
/// implementations of "reshape it" is two accounts of what a page holds
/// afterwards. Agent 8 needs these and cannot spell them any other way —
/// `transform_on_canvas` refuses a page's shape outright and says so, because a
/// page's rectangle has always been this call's to change.
///
/// What the callers still own is what is not about the scene: the queue an edit
/// runs in, the tile a chat puts under a message (nothing agent 8 does is ever
/// shown to a user — §III), and the clauses in `PageToolNotes` — the sentences
/// that tell the model what to *call* next, which are the one part of an answer
/// that cannot be shared by two agents holding different tools.

/// The board a page edit would show, in the shape `boardShown` takes. Built by
/// whoever has a chat to put it in.
export type PageBoardShown = {
  board: PageBoardRow;
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  pageId?: string;
};

export type PageOutcome = {
  result: Record<string, unknown>;
  shown?: PageBoardShown;
};

/// The columns a page edit reads. The same set agent 6's own read has had:
/// `elements` is the scene, `layout`/`layoutSlots` are what tells a page standing
/// as its template composed it from one the user has pulled apart, and the two
/// sizes are the board's default page shape (§V.1).
export const PAGE_EDIT_BOARD_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  layout: true,
  layoutSlots: true,
  widthPx: true,
  heightPx: true,
} as const;

export type PageBoardRow = {
  id: string;
  title: string;
  revision: number;
  elements: unknown;
  layout: string | null;
  layoutSlots: unknown;
  widthPx: number;
  heightPx: number;
};

/// The project's pictures as either agent's loader hands them over, read here for
/// the thumbnails a tile is made of. The canvas tools take the same shape and
/// both agents pass the same loader to both, so one call reads them once.
export type PageToolReferences = () => Promise<{ all: ToolReference[] }>;

/// The sentences that name a tool, taken from the caller.
///
/// Everything else in these answers is a fact about the scene and reads the same
/// to either agent. These are advice about what to do next, and the two
/// agents hold different tools: agent 6 draws a first page with `add_page` and
/// offers to lay a page out again with `compose_moodboard`, and agent 8 has
/// neither — it makes a page with `put_on_canvas` and arranges by hand, which is
/// what it is for. A shared string here would be one agent told to call a tool it
/// was never given, which costs a round and reads to the user as the assistant
/// forgetting what it can do.
export type PageToolNotes = {
  /// How this caller makes a board's first page, said when there is no page to
  /// work on.
  noPage: string;
  /// The same, for a board with no page to *copy* — where the caller's other
  /// answer is a copy of the whole board rather than a first page of it.
  noPageToCopy: string;
  /// What to do about what a smaller page left standing beside it.
  fellOffPage: string;
  /// What to do about an arrangement whose slots were cut for the old rectangle.
  composedAtOldShape: string;
};

/// A page as the answers that make or change one report it: which page of how
/// many, and the rectangle it now stands at with the label that rectangle earns.
/// The position is read off the pages *in reading order*, so a page is numbered
/// the way the user counts it rather than by where its frame sits in the array.
export function pageSized(page: BoardPage, inReadingOrder: readonly BoardPage[]) {
  return {
    pageId: page.id,
    name: page.name,
    position: inReadingOrder.findIndex((other) => other.id === page.id) + 1,
    of: inReadingOrder.length,
    size: `${page.width}×${page.height}`,
    preset: page.preset,
  };
}

/// A page as it is named in a sentence to the model. Quoted when it has a name,
/// because the user's own word for a page is what they will hear it called
/// back — and a page frame carries no name at all until one is set on it.
export function pageSaid(page: BoardPage) {
  return page.name ? `“${page.name}”` : "that page";
}

export function pageToolset({
  db,
  projectId,
  references,
  notes,
}: {
  db: PrismaClient;
  projectId: string;
  references: PageToolReferences;
  notes: PageToolNotes;
}) {
  /// One page of a board given another shape, with nothing laid out again (§V.1).
  ///
  /// "Resizing a page is allowed and changes nothing else" is the entity's own
  /// sentence and the user has always had it — they drag a frame handle. The
  /// model's nearest call was `compose_moodboard` naming a template of another
  /// shape, which does resize the page and lays it out again on the way past: so
  /// "make that page portrait" came back as a page agent 4 had rearranged, and the
  /// arrangement the user was happy with was the price of the shape.
  ///
  /// The rectangle is the whole of the write. What it costs is a page's membership
  /// changing under it — smaller leaves pictures beside the page, larger takes in
  /// what it covers — so both are counted by the same code that makes the change
  /// and both are said in the answer.
  ///
  /// No model call and no `AgentRun` row: a shape the user named is not a
  /// judgement.
  async function resizeBoardPage(args: Record<string, unknown>): Promise<PageOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project like every other board read here: the id is a model
    /// argument, so it is checked rather than trusted.
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_EDIT_BOARD_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const standing = pagesInReadingOrder(boardPages(elements));
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const page = asked ? pageById(standing, asked) : null;

    /// Refused with the ids that would have worked, as every page refusal in this
    /// file is: a page id the model guessed at costs one round, and two if the
    /// refusal sends it guessing again.
    if (!page) {
      return {
        result: {
          error: asked
            ? `no page called ${asked} on that board`
            : "say which page to reshape, by pageId — there is no default page",
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote: `that board has no pages on it — it is a canvas the user arranged, so there is no page to reshape. ${notes.noPage}`,
              }),
        },
      };
    }

    const preset = typeof args.preset === "string" ? args.preset.trim() : "";
    const size = pagePresetSize(preset);
    if (!size) {
      return {
        result: {
          error: `${preset || "that"} is not a page shape — name one of ${PAGE_PRESET_IDS.join(", ")}`,
          presetsNote:
            "any other rectangle is the user's own to drag on the canvas: these are the shapes the layout templates are cut for",
        },
      };
    }

    /// Answered without a write, because there is nothing to write: the page is
    /// already that shape, and a revision spent on it would disown the board's
    /// render and put a scene the user has open one version behind for nothing.
    if (page.width === size.width && page.height === size.height) {
      return {
        result: {
          boardId: board.id,
          title: board.title,
          page: pageSized(page, standing),
          status: `nothing changed — ${pageSaid(page)} is already ${size.width}×${size.height}. Tell the user it is the shape they asked for rather than that it was resized`,
        },
      };
    }

    const resized = resizePage({ elements, pageId: page.id, size })!;
    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    /// The board row's `widthPx`/`heightPx` are its *default* page size (§V.1) and
    /// they describe its first page — the same rule a compose writes them by, and
    /// the reason a compose about page 2 leaves them alone. So a first page given
    /// another shape takes the row with it, and any other page does not.
    const setsBoardDefault = standing[0]?.id === page.id;

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is. The stored render is disowned: the board has a page on it
    /// that is not the shape the picture in the tab row shows.
    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(resized.elements),
        ...(setsBoardDefault && { widthPx: size.width, heightPx: size.height }),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was reshaping a page of it — the user has it open, so tell them and ask again",
        },
      };
    }

    /// Said only for a page that *was* standing exactly as its template composed
    /// it: the slots were cut against the old rectangle, so the arrangement is now
    /// a shape's worth off the page it is on and laying it out again is an offer.
    /// A page the user had already pulled apart has nothing to be offered back.
    const layout = boardLayout(board);
    const wasComposed = pageStandsAsComposed(boardItems(elements), standing, page, layout);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: pageSized(resized.page, pagesInReadingOrder(boardPages(resized.elements))),
        was: `${resized.was.width}×${resized.was.height}`,
        /// Nothing was moved, deleted or laid out: what changed is which page
        /// describes what. The model has to say that rather than "I moved them",
        /// which is the sentence the counts alone read as.
        ...(resized.fellOff.pictures.length || resized.fellOff.lines.length
          ? {
              fellOffPage: resized.fellOff.pictures,
              ...(resized.fellOff.lines.length && { linesOffPage: resized.fellOff.lines }),
              fellOffPageNote: `the page is smaller than it was and those were outside it, so they are on no page now — still on the board exactly where they were, and no longer part of ${pageSaid(resized.page)}. Say that rather than that they were moved or removed, and ${notes.fellOffPage}`,
            }
          : {}),
        ...(resized.joined.pictures.length || resized.joined.lines.length
          ? {
              joinedPage: resized.joined.pictures,
              ...(resized.joined.lines.length && { linesJoinedPage: resized.joined.lines }),
              joinedPageNote:
                "the page is bigger than it was and now covers those, so they are on it where they already were — nothing moved, and a page read from now on describes them as this page's",
            }
          : {}),
        ...(resized.clipped.length && {
          clippedOnPage: resized.clipped,
          clippedOnPageNote:
            "those cross the new edge and are drawn cut off there — that is an overflow rather than a crop, so say they are hanging off the page",
        }),
        ...(resized.overlaps.length && {
          overlapsPages: resized.overlaps.map((other) => ({ pageId: other.id, name: other.name })),
          overlapsPagesNote:
            "the page now runs into those pages, and a picture where two pages overlap is read as being on the topmost of them alone — tell the user the pages are touching and ask them to drag one apart, or reshape it again",
        }),
        ...(wasComposed && {
          layoutNote: `${pageSaid(resized.page)} was standing exactly as ${layout?.id ?? "its template"} composed it, and the slots were cut for the old rectangle — so the arrangement is the old shape's on the new page. ${notes.composedAtOldShape}`,
        }),
        status: `done as a scene edit — no model call was made. ${pageSaid(resized.page)} is ${size.width}×${size.height} now and nothing on it moved${standing.length > 1 ? ", with the board's other pages untouched" : ""}`,
      },
      /// The page that changed shape, not a miniature of the whole spread: the
      /// answer is about that page, and its new shape is the thing to look at.
      shown: {
        board,
        elements: resized.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: resized.page.id,
      },
    };
  }

  /// One page of a board, copied onto a page of its own beside it (§V).
  ///
  /// A board copy is written for one sentence — "keep that one and try it with
  /// the tall shot" — because every other board tool changes the board the user
  /// is looking at. A board is pages now, and the same sentence is said about a
  /// page at least as often: "try that page with the tall shot" is a variation of
  /// one page of a spread, and the calls either agent could otherwise reach for
  /// get it wrong. A board copy carries the pages they were *not* talking about
  /// into a second tab, so the next edit has to say which of the two copies of
  /// those it is about; a fresh page laid out again is not a copy of anything.
  ///
  /// No model call and no `AgentRun` row: copying is not a judgement.
  async function duplicateBoardPage(args: Record<string, unknown>): Promise<PageOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project like every other board read here: the id is a model
    /// argument, so it is checked rather than trusted.
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_EDIT_BOARD_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const copy = asked
      ? pageDuplication({
          elements,
          pageId: asked,
          name: typeof args.name === "string" ? args.name : null,
        })
      : null;

    /// Refused with the ids that would have worked, as every page refusal in this
    /// file is: a page id the model guessed at costs one round, and two if the
    /// refusal sends it guessing again.
    if (!copy) {
      const standing = boardPages(elements);
      return {
        result: {
          error: asked
            ? `no page called ${asked} on that board`
            : "say which page to copy, by pageId — there is no default page",
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote: `that board has no pages on it — it is a canvas the user arranged, so there is no page to copy. ${notes.noPageToCopy}`,
              }),
        },
      };
    }

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is. The stored render is disowned: the board has a page on it
    /// that the picture in the tab row does not show.
    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(copy.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was copying a page of it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const pages = pagesInReadingOrder(boardPages(copy.elements));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: pageSized(copy.page, pages),

        copyOfPage: { pageId: copy.source.id, name: copy.source.name },
        pictures: copy.pictures,
        ...(copy.lines.length && { lines: copy.lines }),
        /// Only on a board the user sectioned themselves — every board this
        /// assistant composes has pages and no sections. Said because those
        /// photographs read as being on the page that was copied and are not on
        /// the copy: they are a section's, and taking the user's own grouping
        /// apart is not what "copy that page" asks for.
        ...(copy.sections
          ? {
              notCopied: copy.keptInSections,
              notCopiedNote:
                "the page was drawn over sections (plain frames) the user made, and what a section holds is the section's rather than the page's — so those pictures read as on the page that was copied and are not on the copy. Say so rather than letting them find it",
            }
          : {}),
        status: `done as a scene edit — no model call was made. This is a new page holding exactly what ${pageSaid(copy.source)} holds, in the same places, and nothing on the board changed: that board is now ${pages.length} page${pages.length === 1 ? "" : "s"}. Make the change they asked for on this page, by this pageId, and tell them ${pageSaid(copy.source)} is still there as it was`,
      },
      /// The page that was made, not a miniature of the whole spread: the answer
      /// is about the copy, and it is the copy they are about to work on.
      shown: {
        board,
        elements: copy.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: copy.page.id,
      },
    };
  }

  return { resizeBoardPage, duplicateBoardPage };
}
