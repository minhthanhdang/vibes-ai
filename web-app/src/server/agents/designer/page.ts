import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { RESIZE_PAGE, type ToolDeclaration } from "@/lib/agent/agent-tools";
import { GET_PAGE } from "@/lib/agent/designer-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, itemsOnPage, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageBlocks } from "@/lib/pages/page-blocks";
import { pageBriefText } from "@/lib/pages/page-brief";
import { pageStandsAsComposed } from "@/lib/pages/page-fit";
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
/// and the one the whole stage is about; `resize_page` is agent 6's, unforked,
/// in `@/server/pages/tool-pages`.
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
/// since a page's rectangle has always been this call's to change. What this door
/// owns is the three clauses that name a tool — agent 6 draws a first page with
/// `add_page` and offers to lay a page out again with `compose_moodboard`, and
/// agent 8 has neither; it makes a page with `put_on_canvas` and arranging is the
/// work it was opened to do.

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
      fellOffPage:
        "put them back on it yourself with transform_on_canvas — you are the one arranging this page",
      composedAtOldShape:
        "so move what is on it onto the new rectangle with transform_on_canvas rather than leaving an arrangement cut for a shape the page no longer has",
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

    const items = boardItems(elements);
    /// §V.4's `layout?` is "the template, if composed" — a claim about this page
    /// and never about the row, which carries one id describing the board's first
    /// page. Asked of the page, it is silent on a spread laid out at another
    /// template, on a page added after the compose, and on one the user has
    /// pulled apart since.
    const layout = boardLayout(board);
    const failed = "failed" in drawn;
    const note = failed ? "" : undrawnNote(drawn.undrawn);

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
    declarations: [GET_PAGE, RESIZE_PAGE],

    async execute({ name, args }) {
      switch (name) {
        case GET_PAGE.name:
          return getPage(args);

        /// Queued with the canvas writes, on the same board key: the rectangle it
        /// rewrites is on the scene a `put_on_canvas` in the same round is
        /// rewriting, and both are revision-guarded — so unqueued the loser is
        /// told the user changed the board underneath it, which nobody did.
        ///
        /// The tile dropped, like every other write agent 8 makes: `shown` is the
        /// facts a picture for a user is made of and there is no user here (§III).
        /// What the model gets instead is the words, and `get_page` is how it
        /// looks at what the new shape did.
        case RESIZE_PAGE.name:
          return {
            result: (
              await boardEdits.run(boardKey(args), () => pages.resizeBoardPage(args))
            ).result,
          };

        default:
          return null;
      }
    },
  };
}
