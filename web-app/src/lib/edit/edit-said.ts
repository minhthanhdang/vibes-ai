import { GRADE_KNOBS, type EditOp, type GradeOp } from "@/lib/edit/edit-ops";
import {
  CROP_BOX_SCALE,
  cropBoxOf,
  cropRegionOfBox,
  type CropBox,
} from "@/lib/references/reference-version";

const WHOLE_FRAME: CropBox = {
  ymin: 0,
  xmin: 0,
  ymax: CROP_BOX_SCALE,
  xmax: CROP_BOX_SCALE,
};

export const EDIT_TITLE_LIMIT = 200;

const EDIT_SUFFIX = /\s*\((crop|turned|flipped|graded|edit)(?:\s+(\d+))?\)$/i;

const TURN_SAID = {
  left: "turned it left",
  right: "turned it right",
  "upside-down": "turned it upside down",
} as const;

const FLIP_SAID = {
  horizontal: "flipped it left to right",
  vertical: "flipped it top to bottom",
  both: "flipped it both ways",
} as const;

const GRADE_SAID: Record<(typeof GRADE_KNOBS)[number], [string, string]> = {
  brightness: ["brightened it", "darkened it"],
  contrast: ["put more contrast in it", "took contrast out of it"],
  saturation: ["put more colour in it", "took colour out of it"],
  warmth: ["warmed it up", "cooled it down"],
  hue: ["turned the colours one way", "turned the colours the other way"],
};

const EDIT_WORDS = { crop: "crop", turn: "turned", flip: "flipped", grade: "graded" } as const;

function trims(op: EditOp): boolean {
  return op.op !== "crop" || !!cropRegionOfBox(cropBoxOf(op.box) ?? WHOLE_FRAME);
}

function editWord(ops: readonly EditOp[]): string {
  const doing = ops.filter(trims);
  if (doing.length > 1) return "edit";
  const only = doing[0];
  return only ? EDIT_WORDS[only.op] : "crop";
}

export function editedReferenceTitle(sourceTitle: string, ops: readonly EditOp[] = []): string {
  const title = sourceTitle.trim();
  const previous = EDIT_SUFFIX.exec(title);
  const base = title.replace(EDIT_SUFFIX, "").trim() || "Reference";
  const next = previous ? Math.max(2, Number(previous[2] ?? 1) + 1) : 1;
  const word = editWord(ops);
  const suffix = next === 1 ? ` (${word})` : ` (${word} ${next})`;

  return `${base.slice(0, EDIT_TITLE_LIMIT - suffix.length).trim()}${suffix}`;
}

function gradeSaid(grade: GradeOp): string[] {
  return GRADE_KNOBS.filter((knob) => grade[knob] !== 0).map(
    (knob) => GRADE_SAID[knob][grade[knob] > 0 ? 0 : 1],
  );
}

function opSaid(op: EditOp): string[] {
  switch (op.op) {
    case "crop":
      return [op.shape ? `cropped it to ${op.shape}` : "cropped it"];
    case "turn":
      return [TURN_SAID[op.turn]];
    case "flip":
      return [FLIP_SAID[op.axis]];
    case "grade":
      return gradeSaid(op);
  }
}

export function editSaid(ops: readonly EditOp[]): string {
  const said = ops.flatMap(opSaid);
  if (!said.length) return "";
  if (said.length === 1) return said[0]!;
  return `${said.slice(0, -1).join(", ")} and ${said.at(-1)}`;
}
