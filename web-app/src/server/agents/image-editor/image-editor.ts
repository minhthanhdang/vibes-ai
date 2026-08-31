import "server-only";
import { MODELS, generateContent, textOf, type Content } from "@/server/google/vertex";
import { CROP_MAX_ATTEMPTS } from "@/lib/crop/crop-attempt";
import {
  EDIT_LOOKS,
  FLIP_AXES,
  GRADE_KNOB,
  GRADE_KNOBS,
  HUE_KNOB,
  TURN_WORDS,
  sameEditAnswer,
  sameEditOps,
  usableEditOps,
  type CropOp,
  type EditOp,
  type EditOpKind,
} from "@/lib/edit/edit-ops";
import { editSaid } from "@/lib/edit/edit-said";
import {
  CROP_BOX_SCALE,
  cropBoxOf,
  editIntent,
  priorCropNote,
  refinedIntent,
  type CropBox,
  type LooseShape,
} from "@/lib/references/reference-version";
import { contentTypeOfUri } from "@/lib/intake/image-types";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { withAgent } from "@/server/agents/shared/agent-scope";
import { instructionFor } from "@/server/agents/image-editor/instruction";
import type { EditPreviewing } from "@/server/references/edits";

const WHOLE_FRAME: CropBox = {
  ymin: 0,
  xmin: 0,
  ymax: CROP_BOX_SCALE,
  xmax: CROP_BOX_SCALE,
};

const OP_FIELDS = {
  crop: {
    box: {
      type: "ARRAY",
      description: `For a crop: [ymin, xmin, ymax, xmax], normalized 0-${CROP_BOX_SCALE}.`,
      minItems: 4,
      maxItems: 4,
      items: { type: "INTEGER" },
    },
  },
  turn: {
    turn: {
      type: "STRING",
      description: "For a turn: which quarter turn to make.",
      enum: [...TURN_WORDS],
    },
  },
  flip: {
    axis: {
      type: "STRING",
      description: "For a flip: the axis to mirror the picture across.",
      enum: [...FLIP_AXES],
    },
  },
  grade: Object.fromEntries(
    GRADE_KNOBS.map((knob) => [
      knob,
      {
        type: "INTEGER",
        description:
          knob === "hue"
            ? `For a grade: the hue, -${HUE_KNOB} to ${HUE_KNOB} degrees, 0 to leave it alone.`
            : `For a grade: the ${knob}, -${GRADE_KNOB} to ${GRADE_KNOB}, 0 to leave it alone.`,
      },
    ]),
  ),
} as const satisfies Record<EditOpKind, Record<string, unknown>>;

function responseSchema(only?: EditOpKind) {
  const kinds = only ? [only] : (Object.keys(OP_FIELDS) as EditOpKind[]);
  return {
    type: "OBJECT",
    properties: {
      ops: {
        type: "ARRAY",
        description: `The edits to make, in order, at most one of each kind: ${kinds.join(", ")}.`,
        items: {
          type: "OBJECT",
          properties: {
            op: {
              type: "STRING",
              description: "Which edit this is.",
              enum: kinds,
            },
            ...Object.assign({}, ...kinds.map((kind) => OP_FIELDS[kind])),
          },
          required: ["op"],
        },
      },
      intent: { type: "STRING" },
      rationale: { type: "STRING" },
    },
    required: ["ops", "intent", "rationale"],
    propertyOrdering: ["ops", "intent", "rationale"],
  };
}

export type ImageEditorResult = {
  model: string;
  box: CropBox;
  ops: EditOp[];
  intent: string;
  rationale: string;
  attempts: number;
  looks: number;
  usage: TokenUsage;
};

export class ImageEditorError extends Error {
  usage: TokenUsage = NO_USAGE;

  model = MODELS.FLASH;
}

export type PriorCrop = { cropBox: number[]; editIntent?: string };

export function editReference(asked: Parameters<typeof editingReference>[0]) {
  return withAgent("image-editor", () => editingReference(asked));
}

async function editingReference({
  gcsUri,
  prompt,
  title,
  previous,
  aspect,
  loose,
  frame,
  only,
  preview,
  generate = generateContent,
}: {
  gcsUri: string;
  prompt: string;
  title?: string;
  previous?: PriorCrop;
  aspect?: string;
  loose?: LooseShape;
  frame?: { width?: unknown; height?: unknown };
  only?: EditOpKind;
  preview?: EditPreviewing;
  generate?: typeof generateContent;
}): Promise<ImageEditorResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new Error(`cannot edit ${gcsUri}: unrecognized image type`);

  const asked = editIntent(prompt);
  if (!asked) throw new ImageEditorError("say what to do with this reference");

  const prior = previous ? priorCropNote(previous) : null;
  const asking = prior
    ? `${prior} The user wants that box changed: ${asked}`
    : `The user wants: ${asked}`;
  const request = loose
    ? `${asking} The crop should be framed ${loose.wants}, and the box you answer with is the shape of the cut — nothing is opened out afterwards.`
    : aspect
      ? `${asking} The crop will be held to ${aspect}.`
      : asking;

  const held = loose && frame ? { loose, frame } : undefined;
  const systemInstruction = instructionFor(only);
  const responseFormat = {
    systemInstruction,
    responseMimeType: "application/json",
    responseSchema: responseSchema(only),
    temperature: 0.2,
  };

  const contents: Content[] = [
    {
      role: "user",
      parts: [
        { fileData: { fileUri: gcsUri, mimeType } },
        {
          text: title ? `The user filed this reference as "${title}". ${request}` : request,
        },
      ],
    },
  ];

  let refused: unknown = undefined;
  let attempts = 0;
  let usage = NO_USAGE;

  const refuse = (message: string) => Object.assign(new ImageEditorError(message), { usage });

  for (;;) {
    const response = await generate(MODELS.FLASH, contents, responseFormat);

    usage = addUsage(usage, usageOf(response));

    const emitted = textOf(response.candidates?.[0]?.content?.parts ?? []);
    const read = parse(emitted);
    if ("fault" in read) throw refuse(read.fault);
    const answer = read.answer;
    attempts += 1;

    const attempt = usableEditOps(answer.ops, held);
    if ("ops" in attempt) {
      const intent = refinedIntent({
        answered: answer.intent ?? "",
        previous: previous?.editIntent,
        asked,
      });
      const looked = await lookAgain({
        ops: attempt.ops,
        rationale: typeof answer.rationale === "string" ? answer.rationale : "",
        request,
        preview,
        generate,
        responseFormat,
        usage,
      });

      return {
        model: MODELS.FLASH,
        box: boxOf(looked.ops),
        ops: looked.ops,
        attempts,
        looks: looked.looks,
        usage: looked.usage,
        intent,
        rationale: looked.rationale,
      };
    }

    if (attempts >= CROP_MAX_ATTEMPTS) {
      throw refuse(`the image editor could not answer with a usable edit: ${attempt.fault}`);
    }
    if (refused !== undefined && sameEditAnswer(answer.ops, refused)) {
      throw refuse(`the image editor answered with the same unusable edit twice: ${attempt.fault}`);
    }
    refused = answer.ops;

    contents.push(
      { role: "model", parts: [{ text: emitted }] },
      { role: "user", parts: [{ text: attempt.fault }] },
    );
  }
}

function boxOf(ops: readonly EditOp[]): CropBox {
  const crop = ops.find((op): op is CropOp => op.op === "crop");
  return (crop && cropBoxOf(crop.box)) || WHOLE_FRAME;
}

async function lookAgain({
  ops,
  rationale,
  request,
  preview,
  generate,
  responseFormat,
  usage,
}: {
  ops: EditOp[];
  rationale: string;
  request: string;
  preview: EditPreviewing | undefined;
  generate: typeof generateContent;
  responseFormat: Parameters<typeof generateContent>[2];
  usage: TokenUsage;
}): Promise<{ ops: EditOp[]; rationale: string; looks: number; usage: TokenUsage }> {
  const crop = ops.find((op): op is CropOp => op.op === "crop");
  let kept = ops;
  let said = rationale;
  let spent = usage;
  let looks = 0;

  if (!preview || !ops.some((op) => op.op === "grade")) {
    return { ops: kept, rationale: said, looks, usage: spent };
  }

  while (looks < EDIT_LOOKS) {
    const shown = await preview(kept);
    if (!shown) break;

    const last = looks + 1 >= EDIT_LOOKS;
    const response = await generate(
      MODELS.FLASH,
      [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: shown.mimeType, data: shown.base64 } },
            { text: lookAsking({ request, ops: kept, last }) },
          ],
        },
      ],
      responseFormat,
    );

    looks += 1;
    spent = addUsage(spent, usageOf(response));

    const read = parse(textOf(response.candidates?.[0]?.content?.parts ?? []));
    if ("fault" in read) break;

    const attempt = usableEditOps(read.answer.ops);
    if ("fault" in attempt) break;

    const revised = [
      ...(crop ? [crop] : []),
      ...attempt.ops.filter((op) => op.op !== "crop"),
    ];
    if (typeof read.answer.rationale === "string" && read.answer.rationale.trim()) {
      said = read.answer.rationale;
    }

    const settled = sameEditOps(revised, kept) || !revised.some((op) => op.op === "grade");
    kept = revised;
    if (settled || last) break;
  }

  return { ops: kept, rationale: said, looks, usage: spent };
}

function lookAsking({
  request,
  ops,
  last,
}: {
  request: string;
  ops: readonly EditOp[];
  last: boolean;
}) {
  const did = editSaid(ops) || "made no change";
  return [
    `This is that picture with the edit on it: you ${did}.`,
    request,
    last
      ? `This is the last look — answer with the list of edits you want kept, and it is what gets filed.`
      : `Answer with the list of edits you want. Answer with the same list to keep it as it is.`,
  ].join(" ");
}

type EditAnswer = { ops?: unknown; intent?: string; rationale?: string };

function parse(text: string): { answer: EditAnswer } | { fault: string } {
  if (!text) return { fault: "the image editor returned no content" };
  try {
    return { answer: JSON.parse(text) as EditAnswer };
  } catch {
    return { fault: `the image editor returned non-JSON: ${text.slice(0, 200)}` };
  }
}
