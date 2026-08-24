import "server-only";
import { MODELS, generateContent, inlineDataOf, textOf, type Content } from "@/server/google/vertex";
import type { ShapeAsked } from "@/lib/references/reference-version";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { withTranscript } from "@/server/agents/transcript";

/// The image generator (tech-spec §III.7). One call per picture: the
/// orchestrator hands in a description carrying the user's intent and the
/// brief's look, and the model answers with the PNG itself — the one
/// capability in the system that makes a picture out of nothing.
///
/// This file ends at bytes. Filing them as a reference row — storage, the
/// analyzer job, the catalog — is the executor's half, so the loop around the
/// model can be exercised without a bucket or a database.

/// The shapes the API takes natively — `config.imageConfig.aspectRatio` is a
/// live field, verified 2026-08-18 on the REST body's `generationConfig`, which
/// is where the SDK's flat `config` puts it (an invalid value is refused as a value,
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

  /// And what they were bought on, for the reason `CropperError` carries it.
  /// This is the one agent whose model is not the text tier, which is exactly
  /// why the caller should not be the one saying so.
  model = MODELS.IMAGE;

  /// What actually went wrong, when the message is a sentence this file wrote
  /// rather than the model's own words. The executor puts it on the run row and
  /// keeps it out of the answer: `vertex 429: {…}` is a diagnostic, and the
  /// thing handed to the orchestrator has to be a sentence it can repeat.
  detail?: string;
}

/// The call not landing is a different answer from the model saying no, and the
/// model reading it is about to write a sentence to the user. Burst throttling
/// is the likely one here (infra.md §X: the image model answers an HTML 404
/// under load), and `throttleRetried` has already backed off `THROTTLE_RETRIES`
/// times by the time it reaches this, so "busy" means busy for the whole turn.
const DRAWING_BUSY =
  "the drawing service is busy and did not answer, so there is no picture — tell the user it could not be drawn just now and offer to try again";
const DRAWING_UNREACHABLE =
  "the drawing service could not be reached, so there is no picture — tell the user the picture could not be drawn rather than describing one";

/// A block decided on the description alone, before any drawing. It is the one
/// refusal the loop's second attempt cannot change: a fresh throw of the dice
/// reaches the same reader of the same words, so the answer is written once and
/// steers at the description rather than at another go.
function blockedSaid(feedback?: { blockReason?: string; blockReasonMessage?: string }) {
  const reason = feedback?.blockReasonMessage?.trim() || feedback?.blockReason?.trim();
  if (!reason) return null;
  return `the drawing service turned the description away before it drew anything: ${reason}. Ask the user to describe the picture in different words — the same ones are refused the same way`;
}

/// `retryable` is read off the thrown value rather than through `instanceof
/// VertexError`, the way `usageThrown` reads a refusal's tokens: a class is a
/// module-identity and this error crosses bundles and loaders, while the flag
/// is the fact. `VertexError` is the only thing that sets it.
function unreachableSaid(cause: unknown) {
  const busy = (cause as { retryable?: unknown } | null | undefined)?.retryable === true;
  return busy ? DRAWING_BUSY : DRAWING_UNREACHABLE;
}

/// Recorded under the turn that asked for the picture, labelled as itself.
export function generateImage(asked: Parameters<typeof generatingImage>[0]) {
  return withTranscript("image-generator", () => generatingImage(asked));
}

async function generatingImage({
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
    let response;
    try {
      response = await generate(MODELS.IMAGE, contents, {
        responseModalities: ["TEXT", "IMAGE"],
        ...(canvas && { imageConfig: { aspectRatio: canvas } }),
      });
    } catch (cause) {
      /// Not retried here: the transport has already exhausted its own backoff,
      /// and the second attempt this loop offers is for a model that answered
      /// without a picture rather than for one that never answered at all.
      throw Object.assign(refuse(unreachableSaid(cause)), {
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }

    usage = addUsage(usage, usageOf(response));
    attempts += 1;

    const blocked = blockedSaid(response.promptFeedback);
    if (blocked) throw refuse(blocked);

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
