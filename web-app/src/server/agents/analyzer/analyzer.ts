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
import { usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { withAgent } from "@/server/agents/shared/agent-scope";

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
  usage: TokenUsage;
};

export function analyzeReference(asked: Parameters<typeof analyzingReference>[0]) {
  return withAgent("analyzer", () => analyzingReference(asked));
}

async function analyzingReference({
  gcsUri,
  title,
  origin,
  generationPrompt,
  generate = generateContent,
}: {
  gcsUri: string;
  title?: string;
  origin?: ReferenceOrigin | null;
  generationPrompt?: string | null;
  generate?: typeof generateContent;
}): Promise<AnalyzerResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new Error(`cannot analyze ${gcsUri}: unrecognized image type`);

  const response = await generate(
    MODELS.FLASH,
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
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  );

  const text = textOf(response.candidates?.[0]?.content?.parts ?? []);
  return {
    model: MODELS.FLASH,
    properties: normalizeAnalysis(parse(text)),
    usage: usageOf(response),
  };
}

function parse(text: string) {
  if (!text) throw new Error("analyzer returned no content");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`analyzer returned non-JSON: ${text.slice(0, 200)}`);
  }
}
