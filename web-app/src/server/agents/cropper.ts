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
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/model-cost";

/// Agent 3, the cropper (tech-spec §III.3). One vision call per request: the
/// director says what they want out of a reference, and the model answers with
/// the box that is it.
///
/// The model never touches pixels. Box detection is a trained Gemini behavior;
/// cropping is arithmetic, and the cut itself happens where every other cut in
/// this app happens — in the browser, on bytes read back same-origin, through
/// the path a hand-made crop already uses. So this file ends at four numbers.
const SYSTEM_INSTRUCTION = `You are the cropper for a film director's reference assistant.

You are given one reference image and what the director wants out of it. Answer
with the single rectangle of that image that is what they asked for.

- box: [ymin, xmin, ymax, xmax], normalized 0-${CROP_BOX_SCALE} against the image
  you were given. Frame it as a director would: keep the subject whole, keep the
  headroom and lead room the shot needs, and cut at the edges of what was asked
  for rather than at the subject's outline.
- intent: what the crop keeps, in a handful of words. This is the label it is
  filed under, not a sentence.
- rationale: one line on why this is the box, in the language used on set.

If what they asked for is not in the image, return the box you would answer with
for the closest thing that is, and say so plainly in the rationale. If the whole
frame already is the answer, return the whole frame — a crop that trims nothing
is refused later, which is the right outcome and better than one invented to
have something to cut.

Sometimes you are given a box you answered with before and what the director
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
  /// How many photograph reads this answer cost. One on nearly every ask; more
  /// only when the first box was not a box. Recorded on the run row, because a
  /// crop that quietly cost three vision calls is the kind of bill that is only
  /// noticed at the end of the month.
  attempts: number;
  /// What those reads came to, summed across the attempts. `attempts` says how
  /// many photographs were sent; this says how large they were — a 12-megapixel
  /// frame and a thumbnail are one attempt each and not one bill each.
  usage: TokenUsage;
};

/// What the cropper could not answer, as opposed to what went wrong reaching it.
/// The caller records this on the run row, so a director who asked for something
/// that is not in the frame reads why rather than "500".
///
/// It carries the tokens too. A refusal reached on the third read is the most
/// expensive thing this agent does, and an error that dropped its own usage
/// would make the failed runs the only ones the ledger cannot see.
export class CropperError extends Error {
  usage: TokenUsage = NO_USAGE;
}

/// The answer the director is adjusting, when this ask is a second one: the box
/// that is on screen and the label it is filed under. Absent on a first ask.
export type PriorCrop = { cropBox: number[]; editIntent?: string };

export async function cropReference({
  gcsUri,
  prompt,
  title,
  previous,
  aspect,
  loose,
  frame,
  /// The vision call, injected. It is the one thing in this file that costs
  /// money, so the loop around it can be exercised without any — which is the
  /// whole point of having the loop tested rather than reasoned about.
  generate = generateContent,
}: {
  gcsUri: string;
  prompt: string;
  title?: string;
  previous?: PriorCrop;
  /// The shape the cut will be held to, by its name. Said to the model so it
  /// frames *for* that format rather than around the subject's own outline — the
  /// ratio itself is arithmetic the caller does, since it depends on the frame's
  /// pixels and the model is given a box scale, not a size.
  aspect?: string;
  /// The shape the cut is asked to be *without* a ratio to open out to, so the
  /// framing is the model's rather than the caller's arithmetic. Mutually
  /// exclusive with `aspect`, which the caller resolves — a shape is said one way
  /// or the other, never both.
  loose?: LooseShape;
  /// The frame's pixel size, which is what makes a loose shape checkable: the box
  /// is 0-1000 of a picture that is not square, so its shape is not readable
  /// without it. Unused for an exact shape, where the ratio is imposed afterwards.
  frame?: { width?: unknown; height?: unknown };
  generate?: typeof generateContent;
}): Promise<CropperResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new Error(`cannot crop ${gcsUri}: unrecognized image type`);

  const asked = editIntent(prompt);
  if (!asked) throw new CropperError("say what to crop out of this reference");

  /// The adjustment, in the model's own numbers. Null when there is no readable
  /// box to move, and then this is an ordinary first ask — a director whose
  /// nudge arrives without the box it was about is better answered from the
  /// frame than refused.
  const prior = previous ? priorCropNote(previous) : null;
  const asking = prior
    ? `${prior} The director wants that box changed: ${asked}`
    : `The director wants: ${asked}`;
  const request = loose
    ? `${asking} The crop should be framed ${loose.wants}, and the box you answer with is the shape of the cut — nothing is opened out afterwards.`
    : aspect
      ? `${asking} The crop will be held to ${aspect}.`
      : asking;

  /// Checked only when there is something to check it against: both the shape
  /// and the pixels it is a shape of.
  const held = loose && frame ? { loose, frame } : undefined;

  const contents: Content[] = [
    {
      role: "user",
      parts: [
        { fileData: { fileUri: gcsUri, mimeType } },
        {
          text: title ? `The director filed this reference as "${title}". ${request}` : request,
        },
      ],
    },
  ];

  /// tech-spec §III.3: prompt, validate deterministically, and on a failure
  /// re-prompt with the validation error appended, up to three attempts.
  ///
  /// The correction is appended to the *conversation* rather than folded into a
  /// fresh prompt: the model has to be able to see the box it is being told
  /// about, and a re-prompt that hides its own last answer is a model being
  /// asked to guess which of its readings was wrong.
  let refused: unknown = undefined;
  let attempts = 0;
  /// Accumulated across the loop rather than read off the last response: a
  /// re-prompt re-sends the photograph, so the attempt that succeeded is never
  /// what the ask cost.
  let usage = NO_USAGE;

  /// A refusal carries the reads it already paid for. What the cropper could not
  /// answer is its expensive case, not its cheap one, and an error that dropped
  /// its own usage would leave the failed runs as the only ones the ledger
  /// cannot see.
  const refuse = (message: string) => Object.assign(new CropperError(message), { usage });

  for (;;) {
    const response = await generate(MODELS.PRO, contents, {
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        /// A box is a reading of the frame, not a creative act. Two runs over
        /// the same request drifting apart would be two different photographs
        /// filed under the same intent.
        temperature: 0.2,
      },
    });

    /// Before `parse`, which throws: a call that came back as prose was still a
    /// photograph read, and the run row that records the failure should say so.
    usage = addUsage(usage, usageOf(response));

    const emitted = textOf(response.candidates?.[0]?.content?.parts ?? []);
    const read = parse(emitted);
    if ("fault" in read) throw refuse(read.fault);
    const answer = read.answer;
    attempts += 1;

    /// A box that reads as no rectangle at all, or a strip too thin to be a
    /// shot. Whether the rectangle it *is* is worth cutting —
    /// `cropRegionOfBox` — is still the caller's question, because the answer to
    /// it is "the frame is already the shot", which is not an error and not
    /// something a second read would change.
    const attempt = usableCropBox(answer.box, held);
    if ("box" in attempt) {
      return {
        model: MODELS.PRO,
        box: attempt.box,
        attempts,
        usage,
        /// The director's own words when the model gave none — and on an
        /// adjustment, the label of the box being moved ahead of them, since
        /// "tighter" names no part of a photograph and the row it was moved from
        /// keeps its own label.
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
    /// A model repeating the box it was just told was wrong has said everything
    /// it has to say about this frame, and the attempts it has left would buy the
    /// same answer again at the price of a photograph read each.
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

/// Structured output makes this JSON, but a safety block or a truncated response
/// comes back as prose in the same field — the same two failures agent 2 tells
/// apart, and for the same reason: the message lands on the run row.
/// Answers with the fault rather than throwing it, so the loop is the one place
/// a refusal is minted and every refusal leaves carrying its tokens.
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
