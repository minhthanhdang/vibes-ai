import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolReference } from "@/lib/agent/shared/reference";
import { REWORD_LIMIT, SWAP_LIMIT } from "@/lib/agent/orchestrator/board-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { swapOnBoard, type SwapRequest } from "@/lib/boards/board-swap";
import { rewordOnBoard, type RewordRequest } from "@/lib/boards/board-text";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageDigests } from "@/lib/pages/page-contents";
import { pagedLooseFits } from "@/lib/pages/page-fit";
import { persistableElements, type SceneElement } from "@/lib/scene/moodboard-scene";
import { sceneWrite } from "@/server/moodboards/scene-write";
import { pageSaid } from "@/server/pages/tool-pages";

/// The two board edits both agents call, written once (compositor-v2.md §IV.2).
///
/// The third file of its kind, after `@/server/canvas/tool-canvas` and
/// `@/server/pages/tool-pages`, and lifted out of agent 6's tool closure on
/// exactly their terms: nothing about what a swap or a reword does to a scene
/// changed on the way here. Both write the same `elements` column the canvas
/// tools write, under the same revision guard, so a second implementation of
/// either would be a second account of what the board holds afterwards.
///
/// Why they moved at all: object-level editing is agent 8's (compositor-v2.md
/// §III). A swap replaces one picture object and a reword rewrites one text
/// object — neither is a board or a page, which is the whole of what agent 6
/// interacts with now. `reword_on_board` is the one agent 8 most plainly needed:
/// `restyle_on_canvas` has no `text` field, so its only route to changing a word
/// was remove-and-replace, which loses the object's stacking and re-wraps the
/// block.
///
/// What the callers still own is what is not about the scene: the queue an edit
/// runs in, the tile a chat puts under a message — nothing agent 8 does is ever
/// shown to a user (§III) — and the clauses in `BoardToolNotes`, which are the
/// sentences that name a tool to call next and cannot be shared by two agents
/// holding different sets.

/// The board a swap or a reword would show, in the shape `boardShown` takes.
/// Built by whoever has a chat to put it in.
export type BoardEditShown = {
  board: BoardEditRow;
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  pageId?: string;
};

export type BoardEditOutcome = {
  result: Record<string, unknown>;
  shown?: BoardEditShown;
};

/// The columns both edits read. `layout`/`layoutSlots` are what say a board is
/// standing as its template composed it — the swap reads them to measure what is
/// still loose in a slot, and the tile reads them to decide what to call the
/// board — and the two sizes are the board's own rectangle.
export const BOARD_EDIT_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  layout: true,
  layoutSlots: true,
  widthPx: true,
  heightPx: true,
} as const;

export type BoardEditRow = {
  id: string;
  title: string;
  revision: number;
  elements: unknown;
  layout: string | null;
  layoutSlots: unknown;
  widthPx: number;
  heightPx: number;
};

/// The project's pictures as either agent's loader hands them over — the same
/// shape `PageToolReferences` and `CanvasReferences` take, so one loader serves
/// all three toolsets and the ids in one answer are the ids in the next.
export type BoardToolReferences = () => Promise<{ all: ToolReference[] }>;

/// The sentences that name a tool, taken from the caller — `PageToolNotes`'
/// rule, for its reason. Everything else in these answers is a fact about the
/// scene and reads the same to either agent.
export type BoardToolNotes = {
  /// How this caller reads what one page carries, said when a picture or a line
  /// the call named is not on the page it named. Agent 6 reads a board with
  /// `inspect_board`; agent 8 reads a page with `get_page`.
  readThePage: string;
  /// The same for the whole board.
  readTheBoard: string;
  /// The call that takes a line *off*, which is not what a reword is for: a
  /// blank `to` is refused rather than treated as a deletion, so the refusal has
  /// to name the door that does it. A tool name on its own — the sentences it
  /// goes into are written here.
  removeALine: string;
  /// What this caller does about a picture standing in a template's slot with
  /// page showing around it. Agent 6 cuts the picture to the slot's shape and
  /// puts the cut in its place in one `crop_reference`; agent 8 has no slots and
  /// draws its own boxes, so it is left off and nothing is said.
  looseInSlot?: string;
};

export function boardToolset({
  db,
  projectId,
  references,
  notes,
}: {
  db: PrismaClient;
  projectId: string;
  references: BoardToolReferences;
  notes: BoardToolNotes;
}) {
  /// The last step of the crop→board loop, and the one that had been going
  /// through a rebuild.
  ///
  /// The caller's `looseInSlot` note sends the orchestrator to a crop and then
  /// back to the board with the cut, and until now "back to the board" meant
  /// `compose_moodboard` with add/remove — which pays the compositor to reassign
  /// every slot and hands back an arrangement nobody asked for. A replacement has
  /// no assignment left to decide: the cut goes where the frame was. So this is a
  /// scene edit, with no model call, no run row and nothing on the board moved
  /// except the box that had to.
  ///
  /// The same is true of two pictures already on the board changing places: the
  /// user has named both ends of the move, so a rebuild would be buying an
  /// assignment they just made themselves.
  async function swapPictures(args: Record<string, unknown>): Promise<BoardEditOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project: the id is a model argument, so it is checked
    /// rather than trusted, exactly as the rebuild's read is.
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: BOARD_EDIT_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    /// The ceiling is a legibility one, so it truncates rather than refusing —
    /// but what it cut off is named. A call asking for six exchanges used to make
    /// four and answer with a list of four under a status reading "done", so two
    /// cuts the user had taken never reached the board and the reply said they
    /// had. A bound nobody is told about is indistinguishable from work that was
    /// never asked for.
    const parsed = swapRequests(args.swaps);
    const asked = parsed.swaps.slice(0, SWAP_LIMIT);
    const overLimit = parsed.swaps.slice(SWAP_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notMade: overLimit,
        notMadeNote: `only ${SWAP_LIMIT} exchanges are made in one call — these were not, so call again with them rather than telling the user they were done`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote:
          "exchanges that named only one end of the pair, so they were not made — each one needs both takeOff and putOn",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error: "say which picture to take off the board and which to put in its place",
          ...dropped,
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const notFound = [...new Set(asked.map((swap) => swap.putOn))].filter((id) => !byId.has(id));
    const runnable = asked.filter((swap) => byId.has(swap.putOn));

    const elements = persistableElements(board.elements);
    const layout = boardLayout(board);

    /// Scoped to one page when the call names one (§V). A reference can be on two
    /// pages of a spread, so "take the stairwell off" without a page is answered
    /// by whichever copy the array carries first — a picture on a page the
    /// user was not talking about.
    const standing = pagesInReadingOrder(boardPages(elements));
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const onPage = askedPage ? pageById(standing, askedPage) : null;
    if (askedPage && !onPage) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so call this again without a pageId",
              }),
          ...dropped,
        },
      };
    }

    const swap = swapOnBoard({
      elements,
      layout,
      swaps: runnable,
      sizeOf: (id) => byId.get(id),
      onPage,
    });

    /// A picture the *page* has not got, when the call named one: said as that
    /// rather than as "not on the board", because the board may well hold it a
    /// page away and the next call is then a pageId rather than another id.
    const missing = swap.notOnBoard.length && {
      notOnBoard: swap.notOnBoard,
      ...(onPage && {
        notOnBoardNote: `the read was against ${pageSaid(onPage)} alone — those pictures are not on it, though the board may hold them on another of its pages, so ${notes.readThePage} before naming one again`,
      }),
    };

    if (!swap.swapped.length && !swap.traded.length) {
      return {
        result: {
          error: onPage ? `nothing on ${pageSaid(onPage)} changed` : "nothing on that board changed",
          ...(notFound.length && { notInThisProject: notFound }),
          ...missing,
          ...(swap.alreadyOnBoard.length && { alreadyOnBoard: swap.alreadyOnBoard }),
          ...dropped,
        },
      };
    }

    /// Guarded on the revision that was read, as every server-side write to a
    /// board is: the user may have the tab open, and the tab that loses gets
    /// its own reload rather than its work silently overwritten. The stored
    /// render is disowned because it is a picture of the board as it was.
    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(swap.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was editing it — the user has it open, so tell them and ask again",
        },
      };
    }

    const items = boardItems(swap.elements);
    /// Whether the exchange actually closed the gap, measured the same way the
    /// compose and the read measure it — page by page, so a swap on page 2 is
    /// answered rather than silently reported as nothing left loose. A cut taken
    /// at the shape the note asked for drops off this list, which is how the loop
    /// is seen to have ended.
    const paged = layout ? pagedLooseFits(items, boardPages(swap.elements), layout) : [];
    /// Scoped to the page the exchange was, the way the read scopes it: gaps on
    /// the board's other pages are not what this call is about, and naming them
    /// hands the user a list of work they did not ask for.
    /// Only a board of more than one page tags its fits with the page they are
    /// on, so on a one-page board every fit is already the named page's.
    const loose =
      onPage && standing.length > 1 ? paged.filter((fit) => fit.pageId === onPage.id) : paged;

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(onPage && { page: { pageId: onPage.id, name: onPage.name } }),
        ...(swap.swapped.length && { swapped: swap.swapped }),
        /// Reported apart from `swapped` because it is a different sentence to
        /// the user: nothing joined the board and nothing left it, two
        /// pictures they were already looking at are in each other's places.
        ...(swap.traded.length && { tradedPlaces: swap.traded }),
        status: onPage
          ? `done as a scene edit on ${pageSaid(onPage)} — every other picture on that page is exactly where it was and nothing was laid out again${standing.length > 1 ? `, and the board's other ${standing.length === 2 ? "page is" : "pages are"} untouched` : ", so say the board is otherwise untouched"}`
          : "done as a scene edit — every other picture on that board is exactly where it was and nothing was laid out again, so say that the board is otherwise untouched",
        ...(notFound.length && { notInThisProject: notFound }),
        ...missing,
        ...(swap.alreadyOnBoard.length && { alreadyOnBoard: swap.alreadyOnBoard }),
        ...dropped,
        ...(loose.length && notes.looseInSlot
          ? { looseInSlot: loose, looseInSlotNote: notes.looseInSlot }
          : {}),
      },
      /// What a tile would be made of, for the caller that has a chat to put one
      /// in. The rule it is drawn by is the read door's: a swap that
      /// refit the cut to its slot leaves the board standing as its template, so
      /// it keeps the name it had; a swap onto a picture the user had moved
      /// does not.
      shown: {
        board,
        elements: swap.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        ...(onPage && { pageId: onPage.id }),
      },
    };
  }


  /// The text half of the same argument `swapPictures` makes about pictures.
  ///
  /// Rewriting a line used to go through `compose_moodboard`'s
  /// addCaptions/removeCaptions, which is a rebuild — the compositor reassigns
  /// every block, so fixing a typo came back with the photographs in different
  /// slots. On a board with no template of its own that is not even a reshuffle:
  /// the rebuild picks a template by block count and writes it over an
  /// arrangement the user made by hand. Nothing about the wording of a line
  /// is open to judgement, so nothing is asked.
  async function rewordLines(args: Record<string, unknown>): Promise<BoardEditOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project: the id is a model argument, so it is checked
    /// rather than trusted, exactly as the swap's read is.
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: BOARD_EDIT_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    /// Truncated and said, on the same argument the swap makes. Here the silence
    /// is if anything worse: the words the board carries are what the user
    /// reads, so a rewording that was dropped is a typo they were told was fixed
    /// and will find themselves.
    const parsed = rewordRequests(args.rewordings);
    const asked = parsed.rewordings.slice(0, REWORD_LIMIT);
    const overLimit = parsed.rewordings.slice(REWORD_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notReworded: overLimit,
        notRewordedNote: `only ${REWORD_LIMIT} lines are rewritten in one call — these were not, so call again with them rather than telling the user the board says them`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote: `rewordings that named only one end of the pair, so nothing was written — each one needs the line as the board carries it now and what it should say instead, and a line is taken off with ${notes.removeALine} rather than with a blank`,
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error: `say which line on the board to rewrite and what it should say instead — to take a line off, use ${notes.removeALine}`,
          ...dropped,
        },
      };
    }

    const elements = persistableElements(board.elements);

    /// Scoped to one page when the call names one (§V), on the same argument the
    /// swap is: the pages of a spread carry the same words as often as not — a
    /// heading per page in the same template slot — and a flat match rewrites
    /// whichever the array carries first.
    const standing = pagesInReadingOrder(boardPages(elements));
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const onPage = askedPage ? pageById(standing, askedPage) : null;
    if (askedPage && !onPage) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so call this again without a pageId",
              }),
          ...dropped,
        },
      };
    }

    const edit = rewordOnBoard({ elements, rewordings: asked, onPage });

    const missing = edit.notOnBoard.length && {
      notOnBoard: edit.notOnBoard,
      notOnBoardNote: onPage
        ? `that wording is not on ${pageSaid(onPage)} — the board may say it on another of its pages, so ${notes.readThePage} and quote the line as that page carries it, or leave the pageId out to reword wherever it is`
        : `that wording is not on the board — ${notes.readTheBoard} and quote the line as the board carries it`,
    };

    if (!edit.reworded.length) {
      return {
        result: {
          error: onPage ? `nothing on ${pageSaid(onPage)} changed` : "nothing on that board changed",
          ...missing,
          ...(edit.unchanged.length && { alreadySaysThat: edit.unchanged }),
          ...dropped,
        },
      };
    }

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is. The stored render is disowned because it is a picture of
    /// the board with the old words on it — the one difference from a rename,
    /// which touches the title column and leaves the document alone.
    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(edit.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was editing it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(onPage && { page: { pageId: onPage.id, name: onPage.name } }),
        reworded: edit.reworded,
        status: onPage
          ? `done as a scene edit on ${pageSaid(onPage)} — no model call was made, the line kept its place and every picture on that page is exactly where it was${standing.length > 1 ? `, and the board's other ${standing.length === 2 ? "page is" : "pages are"} untouched` : ", so say the board is otherwise untouched"}`
          : "done as a scene edit — no model call was made, the line kept its place and every picture on that board is exactly where it was, so say the board is otherwise untouched",
        ...missing,
        ...(edit.unchanged.length && { alreadySaysThat: edit.unchanged }),
        ...dropped,
      },
      /// What that same tile is made of here, by the same rule: a reword
      /// moves no picture, so a board standing in its template still is.
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        ...(onPage && { pageId: onPage.id }),
      },
    };
  }
  return { swapPictures, rewordLines };
}


/// A swap is the one argument here that is a *pair*, and the pairing is
/// why it is an object rather than two arrays: two lists the model has to keep
/// aligned is the mistake `layoutBlocks` already had to name caption ids around,
/// and a misaligned pair here would put the wrong cut in the wrong place silently.
/// Half a pair is dropped rather than guessed at — and counted, because a pair
/// dropped without a word is an exchange the user asked for, did not get, and
/// was told was done.
function swapRequests(value: unknown): { swaps: SwapRequest[]; unreadable: number } {
  if (!Array.isArray(value)) return { swaps: [], unreadable: 0 };
  const swaps: SwapRequest[] = [];
  let unreadable = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      unreadable += 1;
      continue;
    }
    const { takeOff, putOn } = entry as Record<string, unknown>;
    if (typeof takeOff !== "string" || typeof putOn !== "string") {
      unreadable += 1;
      continue;
    }
    if (!takeOff.trim() || !putOn.trim()) {
      unreadable += 1;
      continue;
    }
    swaps.push({ takeOff: takeOff.trim(), putOn: putOn.trim() });
  }
  return { swaps, unreadable };
}

/// A rewording is a pair for the same reason a swap is: two parallel arrays of
/// wordings would misalign into a line that reads as correct whichever way it was
/// meant, and here the mistake is written onto the board in words the user
/// then has to spot.
///
/// A blank `to` is dropped rather than treated as a deletion — this tool
/// rewrites words in place, and what takes a line off is the caller's own
/// `removeALine` note.
/// Counted for the same reason a half swap is: the only thing worse
/// than not rewriting a line is not rewriting it and saying nothing.
function rewordRequests(value: unknown): { rewordings: RewordRequest[]; unreadable: number } {
  if (!Array.isArray(value)) return { rewordings: [], unreadable: 0 };
  const rewordings: RewordRequest[] = [];
  let unreadable = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      unreadable += 1;
      continue;
    }
    const { from, to } = entry as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string") {
      unreadable += 1;
      continue;
    }
    if (!from.trim() || !to.trim()) {
      unreadable += 1;
      continue;
    }
    rewordings.push({ from, to });
  }
  return { rewordings, unreadable };
}
