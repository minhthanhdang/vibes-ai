import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { PUT_ON_CANVAS, READ_CANVAS, REMOVE_FROM_CANVAS, REORDER_ON_CANVAS, RESTYLE_ON_CANVAS, TRANSFORM_ON_CANVAS } from "@/lib/agent/shared/canvas-tools";
import { LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { drawnLine } from "@/lib/pages/page-brief";
import { undrawnNote } from "@/lib/render/render-plan";
import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import { keyedQueue } from "@/lib/util/keyed-queue";
import { canvasToolset } from "@/server/canvas/tool-canvas";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import { designerReferences, type DesignerReferences } from "@/server/agents/designer/references";
import { renderForModel } from "@/server/render/for-model";

export type DesignerBoardEdits = ReturnType<typeof keyedQueue>;

export type DesignerCanvasToolset = {
  declarations: ToolDeclaration[];
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

export const notDrawnLine = (reason: string) =>
  `There is no picture of it — ${reason}. The objects above are the whole of what you have of it, so answer from them and say you could not see it.`;

export const TYPE_CLAMP_NOTE =
  "the type follows the box height, and a put has a floor and a ceiling the box does not know about — these lines were set at a size their box did not ask for, and each object was written at the height of the size it settled on rather than the box you sent. That ceiling is only on the size a box derives: fontSize is a field on this tool, and a size you say is the size that is set, with the block measured to it — so a headline meant to fill a page says its number rather than being handed a tall box and hoping. The lines above are already placed, and restyle_on_canvas takes the same field without moving them";

export const TEXT_WRAP_NOTE =
  "a put sets words to the width of the box you gave it and breaks the line where they no longer fit, then writes the object at the height of the block rather than the box you sent — so these blocks stand below where you placed them by the difference, and anything you put under one is now behind it. A box's width is how many words fit on a line: give copy the width it needs, send fewer words, or move what is under it with transform_on_canvas";

export const TYPE_FLOOR_NOTE =
  `a line cannot be set under ${LAYOUT_TEXT_MIN_FONT} — nobody can read one, and a scale small enough would round it to nothing — so these lines stopped at the floor while their box went on down. Type that no longer follows its box is type the box no longer holds: each of these blocks broke again to the narrower width and stands at the height of the block rather than the box you asked for, so it may now be over what was under it. Resize them to a box that fits ${LAYOUT_TEXT_MIN_FONT} type, or send fewer words`;

export const LEGIBILITY_NOTE =
  "type that stands too close in colour to what it is on cannot be read there, however right the rest of the page is — each of these came in under the ratio its size wants, which is 4.5:1 for a line small enough to read at arm's length and 3:1 once it is large. Set them in an ink that separates from their ground with restyle_on_canvas, or repaint the ground they stand on — near-black lettering on a page painted near-black is a page that looks emptied without anything having left it. On a palette with no legible pair in it the ground is the only way out";

export function designerCanvasToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
  render = renderForModel,
  boardEdits = keyedQueue(),
}: {
  db: PrismaClient;
  projectId: string;
  references?: DesignerReferences;
  render?: typeof renderForModel;
  boardEdits?: DesignerBoardEdits;
}): DesignerCanvasToolset {
  const canvas = canvasToolset({
    db,
    projectId,
    references,
    notes: {
      typeClamp: TYPE_CLAMP_NOTE,
      textWrap: TEXT_WRAP_NOTE,
      typeFloor: TYPE_FLOOR_NOTE,
      legibility: LEGIBILITY_NOTE,
    },
  });

  const boardKey = (args: Record<string, unknown>) =>
    typeof args.boardId === "string" ? args.boardId.trim() : "";

  const wordsOnly = async (edit: Promise<{ result: Record<string, unknown> }>) => ({
    result: (await edit).result,
  });

  async function readCanvas(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const { result, scene } = await canvas.readCanvas(args);
    if (!scene) return { result };

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
        revision: scene.revision,
        picture: [drawnLine(scene.pageId ? "page" : "board"), note].filter(Boolean).join(" "),
      },
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
