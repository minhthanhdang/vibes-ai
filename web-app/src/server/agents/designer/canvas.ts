import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  PUT_ON_CANVAS,
  READ_CANVAS,
  REMOVE_FROM_CANVAS,
  REORDER_ON_CANVAS,
  TRANSFORM_ON_CANVAS,
  type ToolDeclaration,
} from "@/lib/agent/agent-tools";
import { drawnLine } from "@/lib/pages/page-brief";
import { undrawnNote } from "@/lib/render/render-plan";
import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import { keyedQueue } from "@/lib/util/keyed-queue";
import { canvasToolset } from "@/server/canvas/tool-canvas";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import { designerReferences, type DesignerReferences } from "@/server/agents/designer/references";
import { renderForModel } from "@/server/render/for-model";

/// Agent 8's canvas toolset (compositor-v2.md §IV.1, canvas.md §XI).
///
/// The thinnest of the four toolsets, and deliberately: the five tools are agent
/// 6's, unforked, in `@/server/canvas/tool-canvas`. Nothing here decides what a
/// handle is, what a box means or when a write is refused — this is the door
/// agent 8 reaches them through, and everything in it is one of the two things
/// that door has to settle.
///
/// The first is the tile. Agent 6's four writes each end in a picture of the
/// board under a chat message; nothing agent 8 does is ever shown to a user
/// (§III), so the tile is dropped here rather than never built, which is what
/// keeps the two agents on one implementation.
///
/// The second is §IV.1's one addition: `read_canvas` carries the board picture.
/// The geometry read was built for a model that could not see, and a model that
/// can should be looking at the thing the numbers describe.

/// One edit at a time per board, for the length of one design call.
///
/// The same collision agent 6's turn has and for the same reason: the loop runs
/// a round's tool calls with `Promise.all`, so "move the headline up and take
/// the second photo off" ran both against one revision, landed one and answered
/// the other with a conflict the user never caused. Keyed by board rather than
/// serialising the round, so a crop and a move still go side by side.
///
/// Per design call rather than per turn because that is the unit that contends:
/// agent 6 opens one `design_page` a turn (§VI), and every write inside it is
/// this loop's own.
///
/// Made by the caller and shared with the page toolset, because a page's
/// rectangle is on the same scene the canvas writes: a `resize_page` and a
/// `put_on_canvas` in one round are two revision-guarded writes to one row, and
/// a queue each would serialise neither of them against the other.
export type DesignerBoardEdits = ReturnType<typeof keyedQueue>;

export type DesignerCanvasToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on the same terms as the
  /// gallery's: the unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

/// The renderer failed, said in the answer rather than left to be inferred.
///
/// §V.5.3's rule at a third door: whether a picture rides with an answer is said
/// in the text, never assumed. A model that read a board, was handed boxes and
/// was not told the picture is missing is a model describing an arrangement it
/// never saw — and §III.2 makes this an error rather than the ordinary case, so
/// it is said as one.
export const notDrawnLine = (reason: string) =>
  `There is no picture of it — ${reason}. The objects above are the whole of what you have of it, so answer from them and say you could not see it.`;

export function designerCanvasToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
  render = renderForModel,
  boardEdits = keyedQueue(),
}: {
  db: PrismaClient;
  projectId: string;
  /// The project's pictures, shared with every other toolset in the call: an
  /// object on the board and a line in the gallery name the same row, and a
  /// second read is a second answer to what a picture is.
  references?: DesignerReferences;
  /// Injected for the same reason the page toolset injects it: a canvas read is
  /// testable without a bucket, and drawing is the one part of it that touches
  /// the world.
  render?: typeof renderForModel;
  /// The board queue this call's writes run in, taken so the page toolset's
  /// writes queue behind the same one.
  boardEdits?: DesignerBoardEdits;
}): DesignerCanvasToolset {
  const canvas = canvasToolset({ db, projectId, references });

  const boardKey = (args: Record<string, unknown>) =>
    typeof args.boardId === "string" ? args.boardId.trim() : "";

  /// The tile dropped, which is the whole of what agent 8's four writes do
  /// differently: `shown` is the facts a picture for a user is made of, and
  /// there is no user here.
  const wordsOnly = async (edit: Promise<{ result: Record<string, unknown> }>) => ({
    result: (await edit).result,
  });

  async function readCanvas(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const { result, scene } = await canvas.readCanvas(args);
    /// No geometry, no picture: a refusal with a board drawn beside it reads as
    /// a board that was found after all.
    if (!scene) return { result };

    /// The scene the boxes above were read off, handed over rather than read
    /// again — §III.3's invariant, and the reason `renderForModel` takes a scene
    /// at all. The picture and the numbers cannot be of two revisions.
    const drawn = await render({
      boardId: scene.boardId,
      ...(scene.pageId !== undefined && { pageId: scene.pageId }),
      scene: {
        projectId,
        revision: scene.revision,
        elements: scene.elements,
        appState: scene.appState,
      },
    });

    if ("failed" in drawn) {
      return {
        result: { ...result, revision: scene.revision, picture: notDrawnLine(drawn.reason) },
      };
    }

    const note = undrawnNote(drawn.undrawn);
    return {
      result: {
        ...result,
        /// The stamp §III.3 asks for, on the read as it is on `get_page`'s: the
        /// answer says which scene it is of, so a model that read the same board
        /// twice can tell one that moved from one that did not.
        revision: scene.revision,
        picture: [drawnLine(scene.pageId ? "page" : "board"), note].filter(Boolean).join(" "),
      },
      /// The uri never goes into the result, only into the part: a `gs://` path
      /// in JSON is one a model will put in a sentence.
      pictures: [{ fileData: { fileUri: drawn.uri, mimeType: BOARD_RENDER_CONTENT_TYPE } }],
    };
  }

  return {
    declarations: [
      READ_CANVAS,
      PUT_ON_CANVAS,
      REMOVE_FROM_CANVAS,
      TRANSFORM_ON_CANVAS,
      REORDER_ON_CANVAS,
    ],

    async execute({ name, args }) {
      switch (name) {
        /// Unqueued, like agent 6's: it writes nothing, and a read made to wait
        /// on a write answers slower for no gain.
        case READ_CANVAS.name:
          return readCanvas(args);

        case PUT_ON_CANVAS.name:
          return wordsOnly(boardEdits.run(boardKey(args), () => canvas.putOnCanvas(args)));

        case REMOVE_FROM_CANVAS.name:
          return wordsOnly(boardEdits.run(boardKey(args), () => canvas.removeFromCanvas(args)));

        case TRANSFORM_ON_CANVAS.name:
          return wordsOnly(boardEdits.run(boardKey(args), () => canvas.transformOnCanvas(args)));

        case REORDER_ON_CANVAS.name:
          return wordsOnly(boardEdits.run(boardKey(args), () => canvas.reorderOnCanvas(args)));

        default:
          return null;
      }
    },
  };
}
