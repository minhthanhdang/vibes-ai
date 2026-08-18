import "server-only";
import type { ReferenceOrigin } from "@/generated/prisma/enums";
import { MODELS, generateContent, textOf } from "@/server/google/vertex";
import {
  PALETTE_LIMIT,
  TAGS_PER_DIMENSION_LIMIT,
  TAG_VOCABULARY,
  normalizeAnalysis,
  type AnalysisProperties,
  type TagDimension,
} from "@/lib/analysis/analysis";
import { analysisAskSaid } from "@/lib/analysis/analysis-ask";
import { contentTypeOfUri } from "@/lib/intake/image-types";
import { usageOf, type TokenUsage } from "@/lib/agent/model-cost";

/// Agent 2, the property analyzer (tech-spec §III.2). One vision call per
/// reference over the six spec dimensions. It is the first model to see an
/// image and the pipeline's main latency sink, so it is deliberately a single
/// request/response with no tools — the fan-out across a batch belongs to
/// whatever queues these, not here.
const SYSTEM_INSTRUCTION = `You are the property analyzer for a moodboard assistant for creatives.

You are given one reference image. Name it, then describe its *look* in the six
dimensions below so the rest of the pipeline can group references that share a
look.

- title: a few words for what the picture is *of* — what the user would call
  it pointing at it across the room. A name, not a sentence, and not a judgement
  of the look.
- colorPalette: the dominant colours, as hex, ordered most to least prominent.
  Sample them from the image; do not invent a palette that would be nice.
- lighting, texture, composition, subject, contrastDepth: pick only from the
  fixed vocabulary you are given. Choose the terms that are unmistakably true
  of this image; two accurate tags beat five hedged ones. Leave a dimension
  empty rather than guessing.
- rationale: one or two sentences on what gives this image its look, in the
  plain language of the craft.

Describe only what is in the frame. Never guess at a film, a photographer or a
production the image might come from — the title least of all, since a name is
read as a fact about the picture rather than as a reading of it.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    /// First in `propertyOrdering` as well as here: the model writes the fields
    /// in that order, and naming the picture before reading its look is the
    /// order the instruction asks for.
    title: {
      type: "STRING",
      description: "A few words naming what the picture is of.",
    },
    colorPalette: {
      type: "ARRAY",
      description: "Dominant colours as #rrggbb, most prominent first.",
      maxItems: PALETTE_LIMIT,
      items: { type: "STRING", pattern: "^#[0-9a-fA-F]{6}$" },
    },
    ...(Object.fromEntries(
      Object.entries(TAG_VOCABULARY).map(([dimension, tags]) => [
        dimension,
        {
          type: "ARRAY",
          maxItems: TAGS_PER_DIMENSION_LIMIT,
          items: { type: "STRING", enum: [...tags] },
        },
      ]),
    ) as Record<TagDimension, unknown>),
    rationale: { type: "STRING" },
  },
  required: ["title", "colorPalette", ...Object.keys(TAG_VOCABULARY), "rationale"],
  propertyOrdering: ["title", "colorPalette", ...Object.keys(TAG_VOCABULARY), "rationale"],
};

export type AnalyzerResult = {
  model: string;
  properties: AnalysisProperties;
  /// Agent 2 is the pipeline's largest bill by volume — one photograph read per
  /// upload, fanned out across a batch — so it is the run row where a token
  /// count is worth the most.
  usage: TokenUsage;
};

export async function analyzeReference({
  gcsUri,
  title,
  origin,
  generationPrompt,
}: {
  gcsUri: string;
  title?: string;
  origin?: ReferenceOrigin | null;
  generationPrompt?: string | null;
}): Promise<AnalyzerResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new Error(`cannot analyze ${gcsUri}: unrecognized image type`);

  const response = await generateContent(
    MODELS.PRO,
    [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: gcsUri, mimeType } },
          { text: analysisAskSaid({ title, origin, generationPrompt }) },
        ],
      },
    ],
    {
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        // The dimensions are a description of what is there, not a creative
        // act, and agent 5 groups by them — two runs over the same image
        // disagreeing would split a group in half.
        temperature: 0.2,
      },
    },
  );

  const text = textOf(response.candidates?.[0]?.content?.parts ?? []);
  return {
    model: MODELS.PRO,
    properties: normalizeAnalysis(parse(text)),
    usage: usageOf(response),
  };
}

/// Structured output makes this JSON, but a safety block or a truncated
/// response comes back as prose in the same field. The caller records the
/// failure on the run row, so the message has to say which of the two it was.
function parse(text: string) {
  if (!text) throw new Error("analyzer returned no content");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`analyzer returned non-JSON: ${text.slice(0, 200)}`);
  }
}
