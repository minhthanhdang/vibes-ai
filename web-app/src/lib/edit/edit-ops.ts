import { usableCropBox, type LooseHeld } from "@/lib/crop/crop-attempt";
import { cropBoxColumns, cropBoxOf, shapeAsked } from "@/lib/references/reference-version";

export type CropBoxColumns = [number, number, number, number];

export type CropOp = { op: "crop"; box: CropBoxColumns; shape?: string };
export type TurnOp = { op: "turn"; turn: TurnWord };
export type FlipOp = { op: "flip"; axis: FlipAxis };
export type GradeOp = {
  op: "grade";
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  hue: number;
};

export type EditOp = CropOp | TurnOp | FlipOp | GradeOp;
export type EditOpKind = EditOp["op"];

export const EDIT_OP_ORDER = ["crop", "turn", "flip", "grade"] as const;

export const EDIT_OPS_LIMIT = 4;

export const GRADE_KNOB = 100;

export const HUE_KNOB = 180;

export const QUARTER_TURNS = { left: 270, right: 90, "upside-down": 180 } as const;

export type TurnWord = keyof typeof QUARTER_TURNS;

export const TURN_WORDS = Object.keys(QUARTER_TURNS) as [TurnWord, ...TurnWord[]];

export const FLIP_AXES = ["horizontal", "vertical", "both"] as const;

export type FlipAxis = (typeof FLIP_AXES)[number];

export const GRADE_KNOBS = ["brightness", "contrast", "saturation", "warmth", "hue"] as const;

export type GradeKnob = (typeof GRADE_KNOBS)[number];

function knobLimit(knob: GradeKnob) {
  return knob === "hue" ? HUE_KNOB : GRADE_KNOB;
}

function knobOf(value: unknown, knob: GradeKnob): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const limit = knobLimit(knob);
  return Math.round(Math.min(limit, Math.max(-limit, value)));
}

function plainOp(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export type EditOpRead = { op: EditOp } | { fault: string };

function readCrop(said: Record<string, unknown>, held?: LooseHeld): EditOpRead {
  const attempt = usableCropBox(said.box, held);
  if ("fault" in attempt) return { fault: attempt.fault };

  const asked = shapeAsked(said.shape);
  const shape = asked?.shape?.label ?? asked?.loose?.id;
  const box = cropBoxColumns(attempt.box) as CropBoxColumns;
  return { op: { op: "crop", box, ...(shape && { shape }) } };
}

function readTurn(said: Record<string, unknown>): EditOpRead {
  const turn = typeof said.turn === "string" ? said.turn.trim().toLowerCase() : "";
  if (!(turn in QUARTER_TURNS)) {
    return {
      fault: `that turn was “${String(said.turn)}”, which is not a quarter turn. Answer with turn as one of ${TURN_WORDS.join(", ")}.`,
    };
  }
  return { op: { op: "turn", turn: turn as TurnWord } };
}

function readFlip(said: Record<string, unknown>): EditOpRead {
  const axis = typeof said.axis === "string" ? said.axis.trim().toLowerCase() : "";
  if (!FLIP_AXES.includes(axis as FlipAxis)) {
    return {
      fault: `that flip was “${String(said.axis)}”, which is not an axis. Answer with axis as one of ${FLIP_AXES.join(", ")}.`,
    };
  }
  return { op: { op: "flip", axis: axis as FlipAxis } };
}

function readGrade(said: Record<string, unknown>): EditOpRead {
  const knobs = {} as Record<GradeKnob, number>;
  for (const knob of GRADE_KNOBS) {
    const turned = knobOf(said[knob], knob);
    if (turned === null) {
      return {
        fault: `that grade's ${knob} was “${String(said[knob])}”, which is not a number. Every knob is a whole number from -${knobLimit(knob)} to ${knobLimit(knob)}, and 0 leaves it alone.`,
      };
    }
    knobs[knob] = turned;
  }

  if (GRADE_KNOBS.every((knob) => knobs[knob] === 0)) {
    return {
      fault:
        "that grade leaves every knob at 0, which changes nothing. Turn the knobs the picture needs, or leave the grade out of the list.",
    };
  }

  return { op: { op: "grade", ...knobs } };
}

export function readEditOp(value: unknown, held?: LooseHeld): EditOpRead {
  const said = plainOp(value);
  if (!said) return { fault: `${JSON.stringify(value)} is not an edit. Each edit is an object naming its op.` };

  switch (said.op) {
    case "crop":
      return readCrop(said, held);
    case "turn":
      return readTurn(said);
    case "flip":
      return readFlip(said);
    case "grade":
      return readGrade(said);
    default:
      return {
        fault: `“${String(said.op)}” is not an edit this can make. Answer with op as one of ${EDIT_OP_ORDER.join(", ")}.`,
      };
  }
}

const FLIPPED_ACROSS: Record<FlipAxis, FlipAxis> = {
  horizontal: "vertical",
  vertical: "horizontal",
  both: "both",
};

export function quarterTurned(ops: readonly EditOp[]): boolean {
  return ops.some((op) => op.op === "turn" && op.turn !== "upside-down");
}

export function canonical(ops: readonly EditOp[]): EditOp[] {
  const flipAt = ops.findIndex((op) => op.op === "flip");
  const turnAt = ops.findIndex((op) => op.op === "turn");
  const across = flipAt >= 0 && turnAt > flipAt && quarterTurned(ops);

  const ordered: EditOp[] = [];
  for (const kind of EDIT_OP_ORDER) {
    const found = ops.find((op) => op.op === kind);
    if (!found) continue;
    if (across && found.op === "flip") ordered.push({ op: "flip", axis: FLIPPED_ACROSS[found.axis] });
    else ordered.push(found);
  }
  return ordered;
}

export type EditOpsRead = { ops: EditOp[] } | { fault: string };

export function usableEditOps(value: unknown, held?: LooseHeld): EditOpsRead {
  if (!Array.isArray(value)) {
    return {
      fault: `that answer was not a list of edits. Answer with ops as a list of objects, each naming its op — one of ${EDIT_OP_ORDER.join(", ")}.`,
    };
  }
  if (!value.length) {
    return {
      fault: `that list is empty, so it asks for nothing. Answer with the edits this picture needs — a crop that keeps the whole frame is an answer, an empty list is not.`,
    };
  }
  if (value.length > EDIT_OPS_LIMIT) {
    return {
      fault: `that list has ${value.length} edits, and there are only ${EDIT_OPS_LIMIT} kinds — ${EDIT_OP_ORDER.join(", ")} — one of each at most.`,
    };
  }

  const ops: EditOp[] = [];
  const seen = new Set<EditOpKind>();
  for (const [at, said] of value.entries()) {
    const read = readEditOp(said, held);
    if ("fault" in read) return read;

    const { op } = read;
    if (seen.has(op.op)) {
      return {
        fault: `that list has two ${op.op} edits. One of each is the whole vocabulary — say the whole of what you want in the one ${op.op}.`,
      };
    }
    if (op.op === "crop" && at > 0) {
      return {
        fault:
          "the crop has to be the first edit in the list. Its box is read against the image you were given, so a crop after a turn or a flip is a box of a picture nobody has seen.",
      };
    }
    seen.add(op.op);
    ops.push(op);
  }

  return { ops: canonical(ops) };
}

export function editOps(value: unknown): EditOp[] {
  if (!Array.isArray(value)) return [];

  const ops: EditOp[] = [];
  const seen = new Set<EditOpKind>();
  for (const said of value.slice(0, EDIT_OPS_LIMIT)) {
    const read = readEditOp(said);
    if ("fault" in read || seen.has(read.op.op)) continue;
    seen.add(read.op.op);
    ops.push(read.op);
  }
  return canonical(ops);
}

export function sameEditOps(a: readonly EditOp[], b: readonly EditOp[]): boolean {
  return a.length === b.length && a.every((op, at) => sameOp(op, b[at]!));
}

function sameOp(a: EditOp, b: EditOp): boolean {
  if (a.op !== b.op) return false;
  if (a.op === "crop" && b.op === "crop") {
    const box = cropBoxOf(a.box);
    const other = cropBoxOf(b.box);
    return (
      !!box &&
      !!other &&
      box.ymin === other.ymin &&
      box.xmin === other.xmin &&
      box.ymax === other.ymax &&
      box.xmax === other.xmax &&
      (a.shape ?? "") === (b.shape ?? "")
    );
  }
  if (a.op === "turn" && b.op === "turn") return a.turn === b.turn;
  if (a.op === "flip" && b.op === "flip") return a.axis === b.axis;
  if (a.op === "grade" && b.op === "grade") {
    return GRADE_KNOBS.every((knob) => a[knob] === b[knob]);
  }
  return false;
}

export function sameEditAnswer(answered: unknown, previous: unknown): boolean {
  return JSON.stringify(answered ?? null) === JSON.stringify(previous ?? null);
}
