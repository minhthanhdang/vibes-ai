import "server-only";
import { MODELS, generateContent, inlineDataOf, textOf, type Content } from "@/server/google/vertex";
import type { ShapeAsked } from "@/lib/references/reference-version";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/model-cost";

/// The image generator (tech-spec §III.7). One call per picture: the
/// orchestrator hands in a description carrying the user's intent and the
/// brief's look, and the model answers with the PNG itself — the one
/// capability in the system that makes a picture out of nothing.
///
/// This file ends at bytes. Filing them as a reference row — storage, the
/// analyzer job, the catalog — is the executor's half, so the loop around the
/// model can be exercised without a bucket or a database.

/// The shapes the API takes natively — `generationConfig.imageConfig.aspectRatio`
/// is a live field, verified 2026-08-18 (an invalid value is refused as a value,
/// not as an unknown name, and "16:9" came back 1376×768). The user's dialect is
/// `crop_reference`'s, which is wider than this list, so an asked shape lands on
/// the nearest canvas and the exact ratio rides the prompt when they differ.
const NATIVE_ASPECTS = {
  "21:9": 21 / 9,
  "16:9": 16 / 9,
  "3:2": 3 / 2,
  "4:3": 4 / 3,
  "5:4": 5 / 4,
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "2:3": 2 / 3,
  "9:16": 9 / 16,
} as const;

type NativeAspect = keyof typeof NATIVE_ASPECTS;

/// Nearest by proportion rather than by difference, so 2.39:1 lands on 21:9 and
/// a portrait misses every landscape canvas by as much as its mirror image.
function nearestNativeAspect(ratio: number): NativeAspect {
  let nearest: NativeAspect = "1:1";
  let closest = Infinity;
  for (const [aspect, value] of Object.entries(NATIVE_ASPECTS)) {
    const distance = Math.abs(Math.log(ratio / value));
    if (distance < closest) {
      nearest = aspect as NativeAspect;
      closest = distance;
    }
  }
  return nearest;
}

/// A word names a kind of shape, not a ratio, so it gets a representative
/// canvas: the moderate one of its kind rather than the extreme.
const LOOSE_CANVAS: Record<string, NativeAspect> = {
  square: "1:1",
  landscape: "3:2",
  portrait: "2:3",
  rectangle: "3:2",
};

/// Two, not three: a failed generation is not charged, the prompt is not
/// improved between attempts, and the second refusal in a row is the model
/// saying no to this description rather than to this throw of the dice.
export const IMAGE_MAX_ATTEMPTS = 2;

export type GeneratedImage = {
  model: string;
  mimeType: string;
  bytes: Uint8Array;
  attempts: number;
  usage: TokenUsage;
};

/// What the model would not draw, as opposed to what went wrong reaching it.
/// It carries the tokens for the reason `LayoutReaderError` does: a refusal is
/// still a run the ledger has to see.
export class ImageGeneratorError extends Error {
  usage: TokenUsage = NO_USAGE;
}

export async function generateImage({
  description,
  shape,
  /// The generation call, injected — the one thing in this file that costs
  /// money, so the loop around it can be exercised without any.
  generate = generateContent,
}: {
  description: string;
  /// The asked shape, already read out of `crop_reference`'s dialect by the
  /// caller — an unreadable shape is refused with a sentence before anything
  /// is spent, and that sentence is the executor's.
  shape?: ShapeAsked | null;
  generate?: typeof generateContent;
}): Promise<GeneratedImage> {
  const asked = description.trim();
  if (!asked) throw new ImageGeneratorError("say what the picture should show");

  const canvas = shape
    ? shape.shape
      ? nearestNativeAspect(shape.shape.ratio)
      : LOOSE_CANVAS[shape.loose?.id ?? ""]
    : undefined;

  /// The prompt carries only what the canvas cannot: an exact ratio the API
  /// does not take natively, or a loose shape no canvas represents.
  const prompt =
    shape?.shape && shape.shape.label !== canvas
      ? `${asked}\n\nCompose the picture at ${shape.shape.label}.`
      : shape?.loose && !canvas
        ? `${asked}\n\nThe picture is ${shape.loose.wants}.`
        : asked;

  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];

  let attempts = 0;
  let usage = NO_USAGE;
  let refusal = "";

  const refuse = (message: string) =>
    Object.assign(new ImageGeneratorError(message), { usage });

  for (;;) {
    const response = await generate(MODELS.IMAGE, contents, {
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(canvas && { imageConfig: { aspectRatio: canvas } }),
      },
    });

    usage = addUsage(usage, usageOf(response));
    attempts += 1;

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const image = inlineDataOf(parts);
    if (image) {
      return {
        model: MODELS.IMAGE,
        mimeType: image.mimeType,
        bytes: Buffer.from(image.data, "base64"),
        attempts,
        usage,
      };
    }

    /// An answer with no image is a refusal, not a fault: an image safety block
    /// arrives as a candidate with no parts and `finishMessage` beside it, and
    /// a text-only answer is the model explaining itself. Either way there is
    /// nothing to correct — the prompt is what it is — so the retry is a fresh
    /// throw, and the sentence kept is the model's own.
    refusal =
      textOf(parts) ||
      candidate?.finishMessage ||
      (candidate?.finishReason ? `the image model answered ${candidate.finishReason} with no image` : "") ||
      "the image model returned no answer";

    if (attempts >= IMAGE_MAX_ATTEMPTS) {
      throw refuse(`the image model would not draw that: ${refusal}`);
    }
  }
}
