import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import {
  EDIT_OP_ORDER,
  FLIP_AXES,
  GRADE_KNOB,
  GRADE_KNOBS,
  HUE_KNOB,
  TURN_WORDS,
  type EditOpKind,
} from "@/lib/edit/edit-ops";
import { CROP_BOX_SCALE } from "@/lib/references/reference-version";

export const CROP_TOOL: ToolDeclaration = {
  name: "crop",
  description: `Cut the picture down to one rectangle of it and keep that. The box is read against the image you were given and against nothing else, which is why this is the first edit or none: called after a turn, a flip or a grade it is refused, because the box would then be of a picture nobody has seen. Frame it as a photographer would — keep the subject whole, keep the headroom and lead room the shot needs, and cut at the edges of what was asked for rather than at the subject's outline. While it is the only edit you have made, calling it again moves the box instead of cutting the cut, which is how a crop is made tighter after you have looked at it. A box that is a strip rather than a shot, that is inverted, or that misses a shape the cut is held to, is refused and nothing is applied. It costs nothing and makes no model call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      box: {
        type: "ARRAY",
        description: `The rectangle to keep, as [ymin, xmin, ymax, xmax], normalized 0-${CROP_BOX_SCALE} against the image you were given — ymin below ymax and xmin below xmax.`,
        minItems: 4,
        maxItems: 4,
        items: { type: "INTEGER" },
      },
    },
    required: ["box"],
  },
};

export const TURN_TOOL: ToolDeclaration = {
  name: "turn",
  description: `Turn the picture a quarter or a half turn. Left and right are the user's left and right, and a quarter turn either way swaps the picture's edges over. This is for a photograph that was shot on its side, not for straightening a horizon — there is nothing here that turns a picture by a few degrees. One turn is the whole of it: a second is refused rather than added to the first, so say the turn you want in one call. It costs nothing and makes no model call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      turn: {
        type: "STRING",
        description: "Which turn to make.",
        enum: [...TURN_WORDS],
      },
    },
    required: ["turn"],
  },
};

export const FLIP_TOOL: ToolDeclaration = {
  name: "flip",
  description: `Mirror the picture across an axis. Horizontal swaps left for right, vertical swaps top for bottom. Nothing here reads a mirrored picture as wrong, so flip only when the user asked for it — never to "improve" a composition, and never on a picture carrying words, a face someone will recognise or a sign, where a mirror is a picture of something that never existed. One flip is the whole of it: a second is refused, and both axes at once is the "both" axis rather than two calls. It costs nothing and makes no model call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      axis: {
        type: "STRING",
        description: "The axis to mirror the picture across.",
        enum: [...FLIP_AXES],
      },
    },
    required: ["axis"],
  },
};

export const GRADE_TOOL: ToolDeclaration = {
  name: "grade",
  description: `Change the colour of the picture on five knobs at once — brightness, contrast, saturation, warmth and hue. Every knob is a whole number and 0 leaves it alone, so turn only the ones the picture needs; a grade with every knob at 0 changes nothing and is refused. Positive warmth goes towards orange, negative towards blue. A grade does not land where its numbers sound like it will, so look at what comes back: calling it again replaces the grade you made rather than adding to it, which means a correction is the whole grade written again and not the difference. It costs nothing and makes no model call.`,
  parameters: {
    type: "OBJECT",
    properties: Object.fromEntries(
      GRADE_KNOBS.map((knob) => [
        knob,
        {
          type: "INTEGER",
          description:
            knob === "hue"
              ? `The hue, -${HUE_KNOB} to ${HUE_KNOB} degrees, 0 to leave it alone.`
              : `The ${knob}, -${GRADE_KNOB} to ${GRADE_KNOB}, 0 to leave it alone.`,
        },
      ]),
    ),
  },
};

export const EDITOR_TOOLS = {
  crop: CROP_TOOL,
  turn: TURN_TOOL,
  flip: FLIP_TOOL,
  grade: GRADE_TOOL,
} as const satisfies Record<EditOpKind, ToolDeclaration>;

export function editorDeclarations(only?: EditOpKind): ToolDeclaration[] {
  return (only ? [only] : EDIT_OP_ORDER).map((kind) => EDITOR_TOOLS[kind]);
}
