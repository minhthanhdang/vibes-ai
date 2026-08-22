import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  PUT_ON_CANVAS,
  READ_CANVAS,
  REMOVE_FROM_CANVAS,
  REORDER_ON_CANVAS,
  RESTYLE_ON_CANVAS,
  TRANSFORM_ON_CANVAS,
  type ToolDeclaration,
} from "@/lib/agent/agent-tools";
import { LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
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
/// The thinnest of the four toolsets, and deliberately: the six tools are agent
/// 6's, unforked, in `@/server/canvas/tool-canvas`. Nothing here decides what a
/// handle is, what a box means or when a write is refused — this is the door
/// agent 8 reaches them through, and everything in it is one of the two things
/// that door has to settle.
///
/// The first is the tile. Agent 6's five writes each end in a picture of the
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

/// The put's type ceiling, said to the one agent that can do something about it
/// (compositor-v2.md §VII's rule about ceilings, at a door that is not one of
/// §VII's own).
///
/// `put_on_canvas` sets no line over `LAYOUT_TEXT_MAX_FONT` however tall the box
/// is, and rewrites the element's height to match — so the page comes back with
/// a headline two thirds the size it was placed at, the next `get_page` shows
/// exactly that, and nothing in between says the door refused rather than the
/// design being timid. Eleven of the thirty-three pages with type on the
/// development database are sitting on it, ten of them welcome signs.
///
/// The way out is the second sentence, and it is the reason this note is worth
/// its tokens: the ceiling belongs to this door alone. `transform_on_canvas`
/// scales a text object's `fontSize` with its box and keeps no ceiling, so a
/// headline that has to be larger is one put followed by one resize. It does
/// keep a floor — `TYPE_FLOOR_NOTE` below — and the asymmetry is the point:
/// upwards there is somewhere to go, downwards there is not.
///
/// The sizes are in the answer and no number is in the sentence, on iteration
/// 36's finding: a concrete rectangle printed where the model can read it comes
/// back as the rectangle the model asks for. `asked` and `set` say per line
/// what was lost without offering a size to settle on.
export const TYPE_CLAMP_NOTE =
  "the type follows the box height, and a put has a floor and a ceiling the box does not know about — these lines were set at a size their box did not ask for, and each object was written at the height of the size it settled on rather than the box you sent. That ceiling is this tool's and not the canvas's: transform_on_canvas resizes a line and its type together with no ceiling of its own, so type that has to be larger than a put will set is this put and then one resize to the box you wanted";

/// The put's line breaks, said for the same reason and to the same one agent.
///
/// A box's width is a measure of how many words fit on a line, and until the
/// door wrapped them it was not one: the sentence was stored whole and
/// excalidraw drew it straight out of the card it was placed in. Now it breaks,
/// which is the fix — and the block that comes back three lines deep where one
/// was asked for stands two lines below where it was placed, over whatever is
/// under it. That is the part only the caller can settle.
///
/// The counts are in the answer and no advice is in the sentence, on
/// `TYPE_CLAMP_NOTE`'s own finding: `lines`, `asked` and `set` say per block
/// what happened, and which of the three ways out to take is the design's.
export const TEXT_WRAP_NOTE =
  "a put sets words to the width of the box you gave it and breaks the line where they no longer fit, then writes the object at the height of the block rather than the box you sent — so these blocks stand below where you placed them by the difference, and anything you put under one is now behind it. A box's width is how many words fit on a line: give copy the width it needs, send fewer words, or move what is under it with transform_on_canvas";

/// The resize's floor, said to the one agent that can do anything about it.
///
/// A resize scales a text object's `fontSize` with its box, which is why
/// `TYPE_CLAMP_NOTE` sends type that has to be larger through this door — there
/// is no ceiling here. There is now a floor, and it is the put's own
/// `LAYOUT_TEXT_MIN_FONT`: 69 of the 440 text elements on the development
/// database sit exactly on it and 254 sit under 20, so an ordinary "make this
/// half the size" is the scale that reaches it rather than an extreme one.
///
/// The half worth the tokens is the second sentence. A line that stops
/// shrinking with its box is no longer proportional to it — it re-breaks to the
/// narrower box and stands taller than the scale asked for — so the block ends
/// up over whatever was under it, which is `TEXT_WRAP_NOTE`'s failure arriving
/// through the geometry door.
///
/// This one *does* name its number, where `TYPE_CLAMP_NOTE` deliberately does
/// not, and the difference is which way the bound runs. A ceiling printed in
/// prose comes back as the size the model asks for (iteration 36's finding), so
/// saying 96 would hold every headline at 96; a floor is a size the model has
/// to clear rather than reach, and it is already said out loud at the restyle
/// door — `object-style.ts` refuses a `fontSize` outside 12 through 512 by
/// naming both ends. One number for one bound, said the same way at both doors
/// that keep it.
export const TYPE_FLOOR_NOTE =
  `a line cannot be set under ${LAYOUT_TEXT_MIN_FONT} — nobody can read one, and a scale small enough would round it to nothing — so these lines stopped at the floor while their box went on down. Type that no longer follows its box is type the box no longer holds: each of these blocks broke again to the narrower width and stands at the height of the block rather than the box you asked for, so it may now be over what was under it. Resize them to a box that fits ${LAYOUT_TEXT_MIN_FONT} type, or send fewer words`;

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
  const canvas = canvasToolset({
    db,
    projectId,
    references,
    notes: { typeClamp: TYPE_CLAMP_NOTE, textWrap: TEXT_WRAP_NOTE, typeFloor: TYPE_FLOOR_NOTE },
  });

  const boardKey = (args: Record<string, unknown>) =>
    typeof args.boardId === "string" ? args.boardId.trim() : "";

  /// The tile dropped, which is the whole of what agent 8's five writes do
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
      RESTYLE_ON_CANVAS,
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

        case RESTYLE_ON_CANVAS.name:
          return wordsOnly(boardEdits.run(boardKey(args), () => canvas.restyleOnCanvas(args)));

        default:
          return null;
      }
    },
  };
}
