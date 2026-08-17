import "server-only";
import { MODELS, generateContent, textOf, type Content } from "@/server/google/vertex";
import { layoutFromBoxes, type LayoutBox } from "@/lib/layout/custom-layout";
import type { MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { contentTypeOfUri } from "@/lib/intake/image-types";
import { CROP_BOX_SCALE, cropBoxOf } from "@/lib/references/reference-version";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/model-cost";

/// The layout reader (tech-spec §III.4). One vision call per compose: the user
/// hands in a picture of the page they want — placeholder boxes where the
/// photographs go, ruled areas where the words go — and the model answers with
/// where the marks on it are.
///
/// It sits in front of agent 4 and is invisible to it. The compositor's whole
/// economy is that no pixel ever reaches it, so the pixels stop here: this file
/// ends at a list of boxes, `custom-layout.ts` turns them into a page, and from
/// there a `CUSTOM` layout is briefed exactly as `HERO_LEFT` is.
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

/// Three, like the cropper's. The ceiling matters more than the number: a model
/// that cannot read a page is not going to read it on the fourth attempt, and
/// each attempt re-sends the page to a PRO vision call.
export const LAYOUT_MAX_ATTEMPTS = 3;

export type LayoutReaderResult = {
  model: string;
  /// The page the boxes came out as, already validated and numbered in reading
  /// order. `CUSTOM` in every other respect a template is a layout.
  layout: MoodboardLayout;
  /// What the page is, in the reader's own line — the layout's `composition`,
  /// lifted out because the caller relays it and does not otherwise open the
  /// layout.
  composition: string;
  attempts: number;
  usage: TokenUsage;
};

/// What the reader could not read, as opposed to what went wrong reaching it —
/// a page with nothing on it that holds a photograph, or boxes that never came
/// back as boxes. The caller records it on the run row and hands the sentence
/// back to the orchestrator, so a user who handed in the wrong picture reads
/// why rather than "500".
///
/// It carries the tokens, for the reason `CropperError` does: a refusal reached
/// on the third read is the most expensive thing this agent does, and an error
/// that dropped its own usage would make the failed runs the only ones the
/// ledger cannot see.
export class LayoutReaderError extends Error {
  usage: TokenUsage = NO_USAGE;
}

export async function readLayout({
  gcsUri,
  image = {},
  intention,
  /// The vision call, injected — the one thing in this file that costs money,
  /// so the loop around it can be exercised without any.
  generate = generateContent,
}: {
  gcsUri: string;
  /// The layout image's own pixel size, which is what the page rect is taken
  /// from: the boxes are 0-1000 of a picture that is not square, so the shape of
  /// the page is not readable without it. A picture nobody measured still reads
  /// — it lands on the widest preset rather than refusing.
  image?: { width?: unknown; height?: unknown };
  /// What the user said the page is for, passed through from the orchestrator.
  /// It decides nothing here; it is context for the composition line, which is
  /// the only prose the reader writes.
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

  /// The cropper's loop, for the same reason it has one: prompt, validate
  /// deterministically, and on a fault re-prompt with the sentence appended to
  /// the *conversation* — the model has to be able to see the boxes it is being
  /// told about, and a re-prompt that hid its own last answer would be asking it
  /// to guess which of them was wrong.
  let refused: string | undefined = undefined;
  let attempts = 0;
  /// Summed across the loop rather than read off the last response: every
  /// re-prompt re-sends the page, so the attempt that worked is never what the
  /// compose cost.
  let usage = NO_USAGE;

  const refuse = (message: string) => Object.assign(new LayoutReaderError(message), { usage });

  for (;;) {
    const response = await generate(MODELS.PRO, contents, {
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        /// Reading a page is a reading, not a creative act. Two composes off the
        /// same sketch drifting apart would be two different pages under one
        /// board.
        temperature: 0.2,
      },
    });

    /// Before `parse`, which can fault: a call that came back as prose was still
    /// a page read, and the run row recording the failure should say so.
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
        model: MODELS.PRO,
        layout: attempt.layout,
        composition: attempt.layout.composition,
        attempts,
        usage,
      };
    }

    if (attempts >= LAYOUT_MAX_ATTEMPTS) {
      throw refuse(`the layout reader could not read that page: ${attempt.fault}`);
    }
    /// A model that answers with the boxes it was just told were wrong has said
    /// everything it has to say about this page, and the attempt it has left
    /// would buy the same answer again at the price of a PRO read.
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

/// The answer reduced to what a repeat means: the boxes and their tags, in the
/// order they were emitted. Rounded through `cropBoxOf`, so a model that shifts
/// a corner by half a unit still counts as having repeated itself; anything that
/// is not a box at all falls back to its own text, which is the only thing left
/// to compare.
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

/// Structured output makes this JSON, but a safety block or a truncated response
/// comes back as prose in the same field. Answers with the fault rather than
/// throwing it, so the loop stays the one place a refusal is minted and every
/// refusal leaves carrying its tokens.
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
