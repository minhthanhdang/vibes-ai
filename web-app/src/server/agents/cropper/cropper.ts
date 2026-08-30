import "server-only";
import { MODELS, generateContent, textOf, type Content } from "@/server/google/vertex";
import { CROP_MAX_ATTEMPTS, sameCropAnswer, usableCropBox } from "@/lib/crop/crop-attempt";
import {
  CROP_BOX_SCALE,
  editIntent,
  priorCropNote,
  refinedIntent,
  type CropBox,
  type LooseShape,
} from "@/lib/references/reference-version";
import { contentTypeOfUri } from "@/lib/intake/image-types";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { withAgent } from "@/server/agents/shared/agent-scope";

const SYSTEM_INSTRUCTION = `You are the cropper for a moodboard assistant for creatives.

You are given one reference image and what the user wants out of it. Answer
with the single rectangle of that image that is what they asked for.

- box: [ymin, xmin, ymax, xmax], normalized 0-${CROP_BOX_SCALE} against the image
  you were given. Frame it as a photographer would: keep the subject whole, keep the
  headroom and lead room the shot needs, and cut at the edges of what was asked
  for rather than at the subject's outline.
- intent: what the crop keeps, in a handful of words. This is the label it is
  filed under, not a sentence.
- rationale: one line on why this is the box, speaking plainly about the picture.

If what they asked for is not in the image, return the box you would answer with
for the closest thing that is, and say so plainly in the rationale. If the whole
frame already is the answer, return the whole frame — a crop that trims nothing
is refused later, which is the right outcome and better than one invented to
have something to cut.

Sometimes you are given a box you answered with before and what the user
wants changed about it — tighter, more headroom, take in the lamp. Then you are
adjusting that box, not reading the image again: move only the edges the change
asks for, leave the others where they are, and keep the subject the box was
already on. Answer with the whole box either way. The intent still names what
the crop keeps, not the change that was asked for.

Sometimes you are told the crop will be held to a shape — 2.39:1, 16:9, a square.
Frame for that shape: choose the box whose centre is the shot's centre at that
format, and put in it everything that has to be in the shot. The box you answer
with is opened out about its own centre until it is exactly that ratio, so you do
not have to count — but a box centred off the subject is a shape centred off the
subject.

Sometimes the shape is loose instead — roughly square, a landscape rectangle.
Then nothing is opened out afterwards: the box you answer with *is* the shape of
the cut, so give it that shape yourself. Loose means give or take, not exact, so
let the subject decide the last few percent and do not stretch the box past what
belongs in the shot to reach a number.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    box: {
      type: "ARRAY",
      description: `[ymin, xmin, ymax, xmax], normalized 0-${CROP_BOX_SCALE}.`,
      minItems: 4,
      maxItems: 4,
      items: { type: "INTEGER" },
    },
    intent: { type: "STRING" },
    rationale: { type: "STRING" },
  },
  required: ["box", "intent", "rationale"],
  propertyOrdering: ["box", "intent", "rationale"],
};

export type CropperResult = {
  model: string;
  box: CropBox;
  intent: string;
  rationale: string;
  attempts: number;
  usage: TokenUsage;
};

export class CropperError extends Error {
  usage: TokenUsage = NO_USAGE;

  model = MODELS.FLASH;
}

export type PriorCrop = { cropBox: number[]; editIntent?: string };

export function cropReference(asked: Parameters<typeof croppingReference>[0]) {
  return withAgent("cropper", () => croppingReference(asked));
}

async function croppingReference({
  gcsUri,
  prompt,
  title,
  previous,
  aspect,
  loose,
  frame,
  generate = generateContent,
}: {
  gcsUri: string;
  prompt: string;
  title?: string;
  previous?: PriorCrop;
  aspect?: string;
  loose?: LooseShape;
  frame?: { width?: unknown; height?: unknown };
  generate?: typeof generateContent;
}): Promise<CropperResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new Error(`cannot crop ${gcsUri}: unrecognized image type`);

  const asked = editIntent(prompt);
  if (!asked) throw new CropperError("say what to crop out of this reference");

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

  const refuse = (message: string) => Object.assign(new CropperError(message), { usage });

  for (;;) {
    const response = await generate(MODELS.FLASH, contents, {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    });

    usage = addUsage(usage, usageOf(response));

    const emitted = textOf(response.candidates?.[0]?.content?.parts ?? []);
    const read = parse(emitted);
    if ("fault" in read) throw refuse(read.fault);
    const answer = read.answer;
    attempts += 1;

    const attempt = usableCropBox(answer.box, held);
    if ("box" in attempt) {
      return {
        model: MODELS.FLASH,
        box: attempt.box,
        attempts,
        usage,
        intent: refinedIntent({
          answered: answer.intent ?? "",
          previous: previous?.editIntent,
          asked,
        }),
        rationale: typeof answer.rationale === "string" ? answer.rationale : "",
      };
    }

    if (attempts >= CROP_MAX_ATTEMPTS) {
      throw refuse(`the cropper could not answer with a usable box: ${attempt.fault}`);
    }
    if (refused !== undefined && sameCropAnswer(answer.box, refused)) {
      throw refuse(`the cropper answered with the same unusable box twice: ${attempt.fault}`);
    }
    refused = answer.box;

    contents.push(
      { role: "model", parts: [{ text: emitted }] },
      { role: "user", parts: [{ text: attempt.fault }] },
    );
  }
}

function parse(
  text: string,
): { answer: { box?: unknown; intent?: string; rationale?: string } } | { fault: string } {
  if (!text) return { fault: "cropper returned no content" };
  try {
    return { answer: JSON.parse(text) as { box?: unknown; intent?: string; rationale?: string } };
  } catch {
    return { fault: `cropper returned non-JSON: ${text.slice(0, 200)}` };
  }
}
