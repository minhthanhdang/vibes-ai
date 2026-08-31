import "server-only";
import type { LooseHeld } from "@/lib/crop/crop-attempt";
import { editorDeclarations } from "@/lib/agent/image-editor/edit-tools";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import {
  EDIT_OP_ORDER,
  canonical,
  readEditOp,
  sameEditOps,
  type EditOp,
  type EditOpKind,
} from "@/lib/edit/edit-ops";
import { editSaid } from "@/lib/edit/edit-said";
import type { EditPreviewing } from "@/server/references/edits";
import type { EditorCall, EditorOutcome } from "@/server/agents/image-editor/loop";
import type { GeneratePart } from "@/server/google/vertex";

export const CROP_MADE =
  "cropped — the box is against the picture you were given, and the cut is the picture from here on.";

export const CROP_MOVED =
  "the crop is moved to this box: it replaces the one before it rather than cutting the cut again.";

export const GRADE_MADE = "graded.";

export const GRADE_REPLACED =
  "graded — these knobs replace the grade you made before rather than adding to it, so what you see is this call alone.";

export function cropAfterSaid(kind: EditOpKind): string {
  return `no crop can be made now: this picture has already been ${kind === "grade" ? "graded" : `${kind}ed`}, so a box would be read against a picture nobody has seen. The crop is the first edit or none. If the cut wants to be tighter than it is, say so in your closing line rather than calling this again.`;
}

export function twiceSaid(kind: "turn" | "flip", said: string): string {
  return `this picture is already ${said}, and one ${kind} is the whole of the vocabulary — a second is not put on top of the first. What is applied stands; say in your closing line if it is not where you wanted it.`;
}

export function undeclaredSaid(name: string, declared: readonly string[]): string {
  return `“${name}” is not an edit this can make. The edits offered here are ${declared.join(", ")}.`;
}

export type EditorToolset = {
  declarations: ToolDeclaration[];
  execute: (call: EditorCall) => Promise<EditorOutcome>;
  ops: () => EditOp[];
  preview: () => Promise<GeneratePart | null>;
};

export function editorToolset({
  only,
  held,
  preview,
}: {
  only?: EditOpKind;
  held?: LooseHeld;
  preview?: EditPreviewing;
} = {}): EditorToolset {
  const declarations = editorDeclarations(only);
  const named = declarations.map((declaration) => declaration.name);
  const made: EditOp[] = [];
  let shown: EditOp[] | null = null;

  const ops = () => canonical(made);
  const done = () => editSaid(ops());

  function put(op: EditOp) {
    const at = made.findIndex((applied) => applied.op === op.op);
    if (at >= 0) made[at] = op;
    else made.push(op);
  }

  function applied(op: EditOp, status: string): EditorOutcome {
    put(op);
    return { result: { edit: op.op, status, done: done() } };
  }

  function cropping(args: Record<string, unknown>): EditorOutcome {
    const pixel = made.find((op) => op.op !== "crop");
    if (pixel) return { result: { error: cropAfterSaid(pixel.op) } };

    const read = readEditOp({ op: "crop", box: args.box }, held);
    if ("fault" in read) return { result: { error: read.fault } };

    const moved = made.some((op) => op.op === "crop");
    return applied(read.op, moved ? CROP_MOVED : CROP_MADE);
  }

  function turning(kind: "turn" | "flip", args: Record<string, unknown>): EditorOutcome {
    const twice = made.find((op) => op.op === kind);
    if (twice) return { result: { error: twiceSaid(kind, editSaid([twice])) } };

    const read = readEditOp({ op: kind, ...args });
    if ("fault" in read) return { result: { error: read.fault } };

    return applied(read.op, `${editSaid([read.op])}.`);
  }

  function grading(args: Record<string, unknown>): EditorOutcome {
    const read = readEditOp({ op: "grade", ...args });
    if ("fault" in read) return { result: { error: read.fault } };

    const again = made.some((op) => op.op === "grade");
    return applied(read.op, again ? GRADE_REPLACED : GRADE_MADE);
  }

  return {
    declarations,
    ops,
    async execute({ name, args }) {
      if (!named.includes(name)) return { result: { error: undeclaredSaid(name, named) } };
      switch (name as EditOpKind) {
        case "crop":
          return cropping(args);
        case "turn":
        case "flip":
          return turning(name as "turn" | "flip", args);
        case "grade":
          return grading(args);
        default:
          return { result: { error: undeclaredSaid(name, EDIT_OP_ORDER) } };
      }
    },
    async preview() {
      const applying = ops();
      if (!preview || !applying.length) return null;
      if (shown && sameEditOps(shown, applying)) return null;

      const picture = await preview(applying);
      if (!picture) return null;

      shown = applying;
      return { inlineData: { mimeType: picture.mimeType, data: picture.base64 } };
    },
  };
}
