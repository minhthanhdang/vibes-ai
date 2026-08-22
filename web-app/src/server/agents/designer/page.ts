import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/agent-tools";
import { GET_PAGE } from "@/lib/agent/designer-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, itemsOnPage, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageBlocks } from "@/lib/pages/page-blocks";
import { pageBriefText } from "@/lib/pages/page-brief";
import { pageStandsAsComposed } from "@/lib/pages/page-fit";
import { undrawnNote } from "@/lib/render/render-plan";
import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import { renderForModel } from "@/server/render/for-model";

/// Agent 8's page toolset (compositor-v2.md §IV.2). One tool so far, and it is
/// the one the whole stage is about.
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

export type PageToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on the same terms as the
  /// gallery's: the unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function pageToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
  render = renderForModel,
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
}): PageToolset {
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
    declarations: [GET_PAGE],

    async execute({ name, args }) {
      switch (name) {
        case GET_PAGE.name:
          return getPage(args);

        default:
          return null;
      }
    },
  };
}
