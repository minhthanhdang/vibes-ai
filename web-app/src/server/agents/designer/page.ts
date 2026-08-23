import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { SET_PAGE_BACKGROUND } from "@/lib/agent/shared/canvas-tools";
import {
  DESIGNER_DISCARD_PAGE,
  DESIGNER_DUPLICATE_PAGE,
  DESIGNER_MOVE_TO_PAGE,
  DESIGNER_RESIZE_PAGE,
  GET_PAGE,
} from "@/lib/agent/designer-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { readableTarget } from "@/lib/canvas-objects/object-read";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, itemsOnPage, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageBlocks } from "@/lib/pages/page-blocks";
import { pageBriefText } from "@/lib/pages/page-brief";
import { pageStandsAsComposed } from "@/lib/pages/page-fit";
import { contrastNote } from "@/lib/render/contrast";
import { occupancyNote } from "@/lib/render/occupancy";
import { undrawnNote } from "@/lib/render/render-plan";
import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import { keyedQueue } from "@/lib/util/keyed-queue";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import type { DesignerBoardEdits } from "@/server/agents/designer/canvas";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import { pageToolset } from "@/server/pages/tool-pages";
import { renderForModel } from "@/server/render/for-model";

/// Agent 8's page toolset (compositor-v2.md §IV.2). `get_page` is the new one
/// and the one the whole stage is about; `duplicate_page`, `resize_page` and
/// `move_to_page` are agent 6's, on one implementation in
/// `@/server/pages/tool-pages`.
///
/// `get_page` answers with tech-spec §V.4's `PageAIRepresentation` — the page's
/// own line, its blocks as boxes in reading order, the caps and the omitted
/// count — and the picture of it. Both halves are built here from **one** read of
/// the board row, and that is §III.3's invariant rather than an optimisation: a
/// board can move between two reads, chasing the true latest is a race nobody
/// wins, and a tool that read the blocks at one revision and drew the picture at
/// another would hand the model two descriptions of two different pages in one
/// answer. One read, the revision stamped on the answer, and the two cannot
/// disagree.
///
/// The text is `pageBriefText`'s, unchanged, through its `asked` door: what a
/// user attaches to a message and what a model asks for here are one
/// representation with one first line's difference (§V.5.3 against §IV.2).
/// Nothing about a page is described twice in this codebase.
///
/// `resize_page` is here because it is the one act on a page agent 8 cannot
/// spell any other way: `transform_on_canvas` refuses a page's shape and says so,
/// since a page's rectangle has always been this call's to change. Its
/// description is agent 8's own (`DESIGNER_RESIZE_PAGE`) for two reasons written
/// out where it is declared — agent 6's names `inspect_board` and
/// `compose_moodboard` and closes on offering a compose, and it prints the three
/// presets in pixels on every round of every design, which is the half of
/// §VIII's page-shape anchor the instruction could not reach.
///
/// `duplicate_page` is here because copying a page by hand is not the same act at
/// a different price — it is nine `put_on_canvas` calls that each land where the
/// model guessed rather than where the picture already was. That is the one thing
/// agent 8 is worst at and this call does exactly, so a variation of a page that
/// works starts here rather than being rebuilt from a reading of it. Its
/// description is agent 8's own (`DESIGNER_DUPLICATE_PAGE`) because agent 6's
/// names five tools this agent does not hold.
///
/// `move_to_page` is here because a picture's box is in thousandths of the page
/// holding it, so "put that one on the other page" by hand is the target page's
/// rectangle read in scene pixels, the picture's share of one page worked into a
/// share of another, and a `to` written outside 0-1000 — arithmetic across two
/// coordinate frames, which is what this agent is least reliable at. Its
/// description is its own for `duplicate_page`'s reason.
///
/// `set_page_background` is here because a page's ground is the first decision in
/// most of what this agent is asked to make, and it is the one act on a page that
/// `put_on_canvas` can only counterfeit: a page-sized rectangle drawn at the back
/// is an object with a handle, so the next `read_canvas` lists the page's own
/// colour as something standing on the page, tidy has an opinion about it and a
/// `reorder_on_canvas` sending a photograph to the back puts it underneath. Its
/// description is agent 6's, unforked — the only one of these five that is
/// (§IV.2) — because it points at `read_canvas`, which both agents hold and which
/// is where a page's `background` is read either way.
///
/// `discard_page` is here because a page is the unit the user organizes by, and
/// nothing else agent 8 holds takes one away — `remove_from_canvas` naming a
/// page's id would *take* it, which is the act this tool exists to refuse to do
/// on its own. It writes nothing and is queued behind nothing: it is a read, and
/// a page the user has not decided about yet is not made wrong by a
/// `put_on_canvas` landing on another page behind it. Its description is its own
/// because agent 6's promises the user a button, and there is none here.

/// The columns one page read costs. `elements` is the megabytes and there is no
/// reading a page without them; the rest are the head line's own fields.
const PAGE_BOARD_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  appState: true,
  layout: true,
  layoutSlots: true,
} as const;

export type DesignerPageToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on the same terms as the
  /// gallery's: the unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const boardKey = (args: Record<string, unknown>) => asString(args.boardId);

export function designerPageToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
  render = renderForModel,
  boardEdits = keyedQueue(),
}: {
  db: PrismaClient;
  projectId: string;
  /// The project's pictures, shared with the gallery: the blocks on a page name
  /// the same rows `list_gallery` lists, and they are described in the catalogue's
  /// own line format so a picture on a page and a row in the gallery are one
  /// dialect (§V.4).
  references?: DesignerReferences;
  /// Injected for the same reason the model call is: a page read is testable
  /// without a bucket, and drawing is the one part of it that touches the world.
  render?: typeof renderForModel;
  /// The canvas toolset's own queue, so a reshape and a `put_on_canvas` in one
  /// round are one write after another to the board they both name rather than
  /// two reads of one revision.
  boardEdits?: DesignerBoardEdits;
}): DesignerPageToolset {
  const pages = pageToolset({
    db,
    projectId,
    references,
    notes: {
      noPage: 'Draw one with put_on_canvas, kind "page", and a box the shape the work wants',
      noPageToCopy:
        'Draw one with put_on_canvas, kind "page", and a box the shape the work wants — there is nothing here yet to make a variation of',
      fellOffPage:
        "put them back on it yourself with transform_on_canvas — you are the one arranging this page",
      composedAtOldShape:
        "so move what is on it onto the new rectangle with transform_on_canvas rather than leaving an arrangement cut for a shape the page no longer has",
      readTheBoard: "read the board with read_canvas before naming a page again",
      makePageFirst: 'draw it with put_on_canvas, kind "page", first if it does not exist yet',
      composedPageJoined:
        "so put it into the arrangement yourself with transform_on_canvas rather than leaving it standing below the slots",
      discardOffer:
        "Nothing you call puts a button in front of the user: this answer is the whole of the offer, so the choice is one you put to them in your closing line.",
      emptiesBoardOffer:
        "and say the empty board would still be there — losing the board itself is not something you can offer, so tell them that is what they would have to ask for",
      noPageToDiscard:
        "it is a canvas the user arranged rather than a board laid out in pages, so what is standing on it comes off with remove_from_canvas",
      otherRectangle:
        'this call has three shapes and no others — a page that belongs at any other rectangle is one you put with put_on_canvas, kind "page", at that box',
    },
  });

  async function getPage(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const boardId = asString(args.boardId);
    const pageId = asString(args.pageId);

    /// Scoped by project, like every other board read: a boardId is something
    /// the model wrote, and an id is not a licence to read a row from somewhere
    /// else.
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_BOARD_SELECT,
        })
      : null;
    if (!board) {
      return { result: { error: `no board called ${boardId} in this project` } };
    }

    const elements = persistableElements(board.elements);
    const inOrder = pagesInReadingOrder(boardPages(elements));
    const page = pageById(inOrder, pageId);
    if (!page) {
      return {
        result: {
          error: `there is no page called ${pageId} on the board ${boardId} — read_canvas lists the pages that board has`,
        },
      };
    }

    /// The scene handed over rather than a boardId to read again: `renderForModel`
    /// takes the caller's own read for exactly this reason, so the picture is of
    /// the arrangement described below and breaking that is unspellable.
    const [{ all }, drawn] = await Promise.all([
      references(),
      render({
        boardId: board.id,
        pageId: page.id,
        scene: {
          projectId,
          revision: board.revision,
          elements: board.elements,
          appState: board.appState,
        },
      }),
    ]);

    /// Shapes among them (§XI.5): agent 8 draws scrims, rules and colour blocks
    /// now, and a page it just put a colour field on described back to it as
    /// empty room is the disagreement invariant 13 is about. The seating reads
    /// below count photographs and are silent about the rest, so one list serves
    /// both.
    const items = boardItems(elements, { shapes: true });
    /// §V.4's `layout?` is "the template, if composed" — a claim about this page
    /// and never about the row, which carries one id describing the board's first
    /// page. Asked of the page, it is silent on a spread laid out at another
    /// template, on a page added after the compose, and on one the user has
    /// pulled apart since.
    const layout = boardLayout(board);
    const failed = "failed" in drawn;
    const note = failed ? "" : undrawnNote(drawn.undrawn);
    /// Said on both branches, unlike the undrawn note: it comes off the plan
    /// rather than off the raster, so a page the renderer could not draw is a
    /// page this can still measure — and that is the round the model has nothing
    /// else to go on (§VIII).
    const standing = drawn.occupancy ? occupancyNote(drawn.occupancy) : "";
    /// Said on both branches too, and quiet on the page whose type all clears.
    /// The ids it may name are filtered through the read's own question rather
    /// than through the plan the ratios came off: a bound label is drawn like
    /// any other line and every canvas door refuses its id by name, so a note
    /// pointing at one would be `read_canvas`'s old palette-label loop reopened
    /// at this door (§XI.1).
    const restylable = new Set(
      elements.flatMap((element) => (readableTarget(element) ? [element.id] : [])),
    );
    const legibility = drawn.contrast ? contrastNote(drawn.contrast, restylable) : "";

    const text = pageBriefText(
      {
        page: {
          boardId: board.id,
          pageId: page.id,
          boardTitle: board.title,
          name: page.name,
          position: inOrder.indexOf(page) + 1,
          of: inOrder.length,
          width: page.width,
          height: page.height,
          preset: page.preset,
          ...(pageStandsAsComposed(items, inOrder, page, layout) && { layout: board.layout }),
        },
        ...pageBlocks(itemsOnPage(items, inOrder, page), page),
        rendered: !failed,
        door: "asked",
        ...(standing && { standingNote: standing }),
        ...(legibility && { legibilityNote: legibility }),
                ...(failed ? { renderFailure: drawn.reason } : note ? { undrawnNote: note } : {}),
      },
      all,
    );

    const result = {
      boardId: board.id,
      pageId: page.id,
      /// The stamp. Nothing takes it as an argument — the canvas tools guard
      /// their own writes — so it is here for the reason §III.3 asks for it: the
      /// answer says which scene it is of, and a model that reads the same page
      /// twice can tell a board that moved from one that did not.
      revision: board.revision,
      page: text,
    };

    /// The uri never goes into the result, only into the part: a `gs://` path in
    /// JSON is one a model will put in a sentence.
    return failed
      ? { result }
      : {
          result,
          pictures: [{ fileData: { fileUri: drawn.uri, mimeType: BOARD_RENDER_CONTENT_TYPE } }],
        };
  }

  return {
    declarations: [
      GET_PAGE,
      DESIGNER_DUPLICATE_PAGE,
      DESIGNER_RESIZE_PAGE,
      DESIGNER_MOVE_TO_PAGE,
      SET_PAGE_BACKGROUND,
      DESIGNER_DISCARD_PAGE,
    ],

    async execute({ name, args }) {
      switch (name) {
        case GET_PAGE.name:
          return getPage(args);

        /// Queued on the board it copies *within*, unlike a board's copy: it
        /// writes back to the same scene it read, so a `put_on_canvas` landing
        /// between the read and the write would be a copy of the page as the
        /// round found it and the revision guard would throw one of the two away.
        ///
        /// The tile dropped, for the reason every write agent 8 makes drops one.
        case DESIGNER_DUPLICATE_PAGE.name:
          return {
            result: (
              await boardEdits.run(boardKey(args), () => pages.duplicateBoardPage(args))
            ).result,
          };

        /// Queued with the canvas writes, on the same board key: the rectangle it
        /// rewrites is on the scene a `put_on_canvas` in the same round is
        /// rewriting, and both are revision-guarded — so unqueued the loser is
        /// told the user changed the board underneath it, which nobody did.
        ///
        /// The tile dropped, like every other write agent 8 makes: `shown` is the
        /// facts a picture for a user is made of and there is no user here (§III).
        /// What the model gets instead is the words, and `get_page` is how it
        /// looks at what the new shape did.
        case DESIGNER_RESIZE_PAGE.name:
          return {
            result: (
              await boardEdits.run(boardKey(args), () => pages.resizeBoardPage(args))
            ).result,
          };

        /// Queued with the canvas writes on the board it names, like every
        /// other write here: it rewrites the one scene both its pages are on,
        /// and a `put_on_canvas` landing between the read and the write would
        /// cost one of the two its revision.
        ///
        /// The tile dropped, for the reason every write agent 8 makes drops one.
        case DESIGNER_MOVE_TO_PAGE.name:
          return {
            result: (await boardEdits.run(boardKey(args), () => pages.moveToBoardPage(args)))
              .result,
          };

        /// Queued with the canvas writes on the board it names, like every
        /// other write here: the ground it adds, recolours or drops is one
        /// element on the scene a `put_on_canvas` in the same round is writing,
        /// and both are revision-guarded.
        ///
        /// The tile dropped, for the reason every write agent 8 makes drops one.
        case SET_PAGE_BACKGROUND.name:
          return {
            result: (
              await boardEdits.run(boardKey(args), () => pages.setBoardPageBackground(args))
            ).result,
          };

        /// Unqueued, unlike the four writes above it: it changes nothing, and
        /// making an offer wait on a `put_on_canvas` would answer slower for no
        /// gain. What it reports is what the page holds now, and a page the user
        /// has not decided about is not made wrong by a picture landing on
        /// another page behind it.
        ///
        /// The tile dropped, and here that is the whole difference between the
        /// two agents' versions of this call: agent 6's offer *is* the tile, and
        /// agent 8's is the sentence the answer told it to write.
        case DESIGNER_DISCARD_PAGE.name:
          return { result: (await pages.offerBoardPageDiscard(args)).result };

        default:
          return null;
      }
    },
  };
}
