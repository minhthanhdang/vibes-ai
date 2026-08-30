import "server-only";
import { MODELS, generateContent, inlineDataOf, textOf, type Content } from "@/server/google/vertex";
import type { ShapeAsked } from "@/lib/references/reference-version";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { withAgent } from "@/server/agents/shared/agent-scope";

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

const LOOSE_CANVAS: Record<string, NativeAspect> = {
  square: "1:1",
  landscape: "3:2",
  portrait: "2:3",
  rectangle: "3:2",
};

export const IMAGE_MAX_ATTEMPTS = 2;

export type GeneratedImage = {
  model: string;
  mimeType: string;
  bytes: Uint8Array;
  attempts: number;
  usage: TokenUsage;
};

export class ImageGeneratorError extends Error {
  usage: TokenUsage = NO_USAGE;

  model = MODELS.IMAGE;

  detail?: string;
}

const DRAWING_BUSY =
  "the drawing service is busy and did not answer, so there is no picture — tell the user it could not be drawn just now and offer to try again";
const DRAWING_UNREACHABLE =
  "the drawing service could not be reached, so there is no picture — tell the user the picture could not be drawn rather than describing one";

function blockedSaid(feedback?: { blockReason?: string; blockReasonMessage?: string }) {
  const reason = feedback?.blockReasonMessage?.trim() || feedback?.blockReason?.trim();
  if (!reason) return null;
  return `the drawing service turned the description away before it drew anything: ${reason}. Ask the user to describe the picture in different words — the same ones are refused the same way`;
}

function unreachableSaid(cause: unknown) {
  const busy = (cause as { retryable?: unknown } | null | undefined)?.retryable === true;
  return busy ? DRAWING_BUSY : DRAWING_UNREACHABLE;
}

export function generateImage(asked: Parameters<typeof generatingImage>[0]) {
  return withAgent("image-generator", () => generatingImage(asked));
}

async function generatingImage({
  description,
  shape,
  generate = generateContent,
}: {
  description: string;
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
