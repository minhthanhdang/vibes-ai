import "server-only";
import { MODELS, generateContent, textOf, type Content } from "@/server/google/vertex";
import { layoutFromBoxes, type LayoutBox } from "@/lib/layout/custom-layout";
import type { MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { contentTypeOfUri } from "@/lib/intake/image-types";
import { CROP_BOX_SCALE, cropBoxOf } from "@/lib/references/reference-version";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";

const SYSTEM_INSTRUCTION = `You are the layout reader for a moodboard assistant.

You are given one picture of a page — a sketch, a screenshot of a spread
somebody liked, a frame out of a deck. Somebody has drawn on it where things
go. Answer with one box per area a block goes in, and nothing else.

- box: [ymin, xmin, ymax, xmax], normalized 0-${CROP_BOX_SCALE} against the
  picture you were given, y first.
- kind: "image" for a placeholder a photograph goes in, "text" for a ruled area
  words go in.

A placeholder is a box drawn to *hold* a photograph: an empty rectangle, a
frame with a cross or a mountain glyph through it, a block of flat grey. A
photograph already sitting on the page is one too — read the area it covers,
because that is where the next photograph goes.

What is not a placeholder: the page's own border, rules and margins, logos,
ornaments, folios, and any photograph that is part of the drawing rather than
an example of what goes on it. Leave them out. A box around the whole page is
not a layout.

Answer with the whole of the area a block goes in, out to the edges of the mark
that was drawn, and stop there — the gutter between two placeholders belongs to
neither of them, and two placeholders that touch are still two boxes.

- composition: one line saying what the page *is*, for a reader who cannot see
  it. The shape of the arrangement — "a large hero left, three supporting
  frames stacked right, a caption beneath them" — not a count of the boxes and
  not a description of the photographs, which have not been chosen yet.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    boxes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          box: {
            type: "ARRAY",
            description: `[ymin, xmin, ymax, xmax], normalized 0-${CROP_BOX_SCALE}.`,
            minItems: 4,
            maxItems: 4,
            items: { type: "INTEGER" },
          },
          kind: { type: "STRING", enum: ["image", "text"] },
        },
        required: ["box", "kind"],
        propertyOrdering: ["box", "kind"],
      },
    },
    composition: { type: "STRING" },
  },
  required: ["boxes", "composition"],
  propertyOrdering: ["boxes", "composition"],
};

export const LAYOUT_MAX_ATTEMPTS = 3;

export type LayoutReaderResult = {
  model: string;
  layout: MoodboardLayout;
  composition: string;
  attempts: number;
  usage: TokenUsage;
};

export class LayoutReaderError extends Error {
  usage: TokenUsage = NO_USAGE;

  model = MODELS.FLASH;
}

export async function readLayout({
  gcsUri,
  image = {},
  intention,
  generate = generateContent,
}: {
  gcsUri: string;
  image?: { width?: unknown; height?: unknown };
  intention?: string;
  generate?: typeof generateContent;
}): Promise<LayoutReaderResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new LayoutReaderError(`cannot read ${gcsUri}: unrecognized image type`);

  const asked = intention?.trim();
  const request = asked
    ? `This is the page the user wants their moodboard laid out on. They are building it for: ${asked}. Read the layout off it.`
    : `This is the page the user wants their moodboard laid out on. Read the layout off it.`;

  const contents: Content[] = [
    { role: "user", parts: [{ fileData: { fileUri: gcsUri, mimeType } }, { text: request }] },
  ];

  let refused: string | undefined = undefined;
  let attempts = 0;
  let usage = NO_USAGE;

  const refuse = (message: string) => Object.assign(new LayoutReaderError(message), { usage });

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

    const attempt = layoutFromBoxes({
      boxes: answer.boxes,
      image,
      composition: answer.composition,
    });
    if ("layout" in attempt) {
      return {
        model: MODELS.FLASH,
        layout: attempt.layout,
        composition: attempt.layout.composition,
        attempts,
        usage,
      };
    }

    if (attempts >= LAYOUT_MAX_ATTEMPTS) {
      throw refuse(`the layout reader could not read that page: ${attempt.fault}`);
    }
    const answered = sameness(answer.boxes);
    if (refused !== undefined && answered === refused) {
      throw refuse(`the layout reader read that page the same unusable way twice: ${attempt.fault}`);
    }
    refused = answered;

    contents.push(
      { role: "model", parts: [{ text: emitted }] },
      { role: "user", parts: [{ text: attempt.fault }] },
    );
  }
}

function sameness(boxes: unknown): string {
  if (!Array.isArray(boxes)) return JSON.stringify(boxes ?? null);
  return boxes
    .map((entry) => {
      const box = cropBoxOf((entry as LayoutBox | null)?.box);
      const kind = String((entry as LayoutBox | null)?.kind);
      return box ? `${kind}:${box.ymin},${box.xmin},${box.ymax},${box.xmax}` : JSON.stringify(entry);
    })
    .join("|");
}

function parse(
  text: string,
): { answer: { boxes?: unknown; composition?: unknown } } | { fault: string } {
  if (!text) return { fault: "the layout reader returned no content" };
  try {
    return { answer: JSON.parse(text) as { boxes?: unknown; composition?: unknown } };
  } catch {
    return { fault: `the layout reader returned non-JSON: ${text.slice(0, 200)}` };
  }
}
