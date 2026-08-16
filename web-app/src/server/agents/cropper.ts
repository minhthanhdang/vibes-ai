import "server-only";
import { MODELS, generateContent, textOf } from "@/server/google/vertex";
import { CROP_BOX_SCALE, cropBoxOf, editIntent, type CropBox } from "@/lib/reference-version";
import { contentTypeOfUri } from "@/lib/image-types";

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
have something to cut.`;

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
};

/// What the cropper could not answer, as opposed to what went wrong reaching it.
/// The caller records this on the run row, so a director who asked for something
/// that is not in the frame reads why rather than "500".
export class CropperError extends Error {}

export async function cropReference({
  gcsUri,
  prompt,
  title,
}: {
  gcsUri: string;
  prompt: string;
  title?: string;
}): Promise<CropperResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new Error(`cannot crop ${gcsUri}: unrecognized image type`);

  const asked = editIntent(prompt);
  if (!asked) throw new CropperError("say what to crop out of this reference");

  const response = await generateContent(
    MODELS.PRO,
    [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: gcsUri, mimeType } },
          {
            text: title
              ? `The director filed this reference as "${title}". They want: ${asked}`
              : `The director wants: ${asked}`,
          },
        ],
      },
    ],
    {
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        /// A box is a reading of the frame, not a creative act. Two runs over
        /// the same request drifting apart would be two different photographs
        /// filed under the same intent.
        temperature: 0.2,
      },
    },
  );

  const answer = parse(textOf(response.candidates?.[0]?.content?.parts ?? []));
  const box = cropBoxOf(answer.box);
  /// A box that reads as no rectangle at all: the frame is unchanged and there
  /// is nothing to cut. Whether the rectangle it *is* is worth cutting —
  /// `cropRegionOfBox` — is the caller's question, because the answer to it is
  /// "the frame is already the shot", which is not an error.
  if (!box) throw new CropperError("the cropper did not answer with a box of this image");

  return {
    model: MODELS.PRO,
    box,
    /// The director's own words when the model gave none: the version is filed
    /// under what was asked for either way.
    intent: editIntent(answer.intent ?? "") || asked,
    rationale: typeof answer.rationale === "string" ? answer.rationale : "",
  };
}

/// Structured output makes this JSON, but a safety block or a truncated response
/// comes back as prose in the same field — the same two failures agent 2 tells
/// apart, and for the same reason: the message lands on the run row.
function parse(text: string) {
  if (!text) throw new CropperError("cropper returned no content");
  try {
    return JSON.parse(text) as { box?: unknown; intent?: string; rationale?: string };
  } catch {
    throw new CropperError(`cropper returned non-JSON: ${text.slice(0, 200)}`);
  }
}
