export const TAG_VOCABULARY = {
  lighting: [
    "high-key",
    "low-key",
    "natural-light",
    "golden-hour",
    "blue-hour",
    "overcast",
    "backlit",
    "rim-light",
    "silhouette",
    "practical-light",
    "neon",
    "hard-light",
    "soft-light",
    "chiaroscuro",
    "top-light",
    "underlit",
    "firelight",
    "moonlight",
  ],
  texture: [
    "fine-grain",
    "heavy-grain",
    "clean-digital",
    "halation",
    "soft-focus",
    "tack-sharp",
    "anamorphic-flare",
    "bloom",
    "haze",
    "smoke",
    "matte",
    "glossy",
    "weathered",
    "wet",
  ],
  composition: [
    "centered",
    "rule-of-thirds",
    "symmetrical",
    "leading-lines",
    "frame-within-frame",
    "negative-space",
    "wide-shot",
    "medium-shot",
    "close-up",
    "extreme-close-up",
    "overhead",
    "low-angle",
    "high-angle",
    "dutch-angle",
    "over-the-shoulder",
    "two-shot",
  ],
  subject: [
    "portrait",
    "crowd",
    "architecture",
    "interior",
    "landscape",
    "cityscape",
    "vehicle",
    "still-life",
    "nature",
    "water",
    "sky",
    "street",
    "industrial",
    "domestic",
    "period",
    "futuristic",
    "abstract",
  ],
  contrastDepth: [
    "high-contrast",
    "low-contrast",
    "crushed-blacks",
    "lifted-blacks",
    "blown-highlights",
    "shallow-depth",
    "deep-focus",
    "flat-depth",
    "layered-depth",
    "atmospheric-perspective",
  ],
} as const;

export type TagDimension = keyof typeof TAG_VOCABULARY;

export const ANALYSIS_DIMENSIONS = [
  { key: "lighting", label: "Lighting" },
  { key: "texture", label: "Texture & grain" },
  { key: "composition", label: "Composition" },
  { key: "subject", label: "Subject & context" },
  { key: "contrastDepth", label: "Contrast & depth" },
] as const satisfies readonly { key: TagDimension; label: string }[];

export const PALETTE_LIMIT = 6;
export const TAGS_PER_DIMENSION_LIMIT = 5;
const RATIONALE_LIMIT = 600;
const TITLE_LIMIT = 80;

export type AnalysisProperties = {
  title: string;
  colorPalette: string[];
  lighting: string[];
  texture: string[];
  composition: string[];
  subject: string[];
  contrastDepth: string[];
  rationale: string;
};

const HEX = /^[0-9a-f]{6}$/;

export function normalizeHexColor(value: unknown) {
  if (typeof value !== "string") return null;

  const digits = value.trim().toLowerCase().replace(/^#/, "");
  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;

  return HEX.test(expanded) ? `#${expanded}` : null;
}

function normalizeTags(dimension: TagDimension, raw: unknown) {
  const allowed = new Set<string>(TAG_VOCABULARY[dimension]);
  const values = Array.isArray(raw) ? raw : [raw];

  const tags = values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const tag = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
    return allowed.has(tag) ? [tag] : [];
  });

  return [...new Set(tags)].slice(0, TAGS_PER_DIMENSION_LIMIT);
}

export function normalizeAnalysis(raw: unknown): AnalysisProperties {
  const source: Record<string, unknown> = raw !== null && typeof raw === "object" ? { ...raw } : {};

  const colorPalette = (Array.isArray(source.colorPalette) ? source.colorPalette : [])
    .map(normalizeHexColor)
    .filter((color): color is string => color !== null);

  const title = typeof source.title === "string" ? source.title.trim() : "";
  const rationale = typeof source.rationale === "string" ? source.rationale.trim() : "";

  return {
    title: title.slice(0, TITLE_LIMIT),
    colorPalette: [...new Set(colorPalette)].slice(0, PALETTE_LIMIT),
    lighting: normalizeTags("lighting", source.lighting),
    texture: normalizeTags("texture", source.texture),
    composition: normalizeTags("composition", source.composition),
    subject: normalizeTags("subject", source.subject),
    contrastDepth: normalizeTags("contrastDepth", source.contrastDepth),
    rationale: rationale.slice(0, RATIONALE_LIMIT),
  };
}

export function isEmptyAnalysis(properties: AnalysisProperties) {
  return (
    !properties.colorPalette.length &&
    ANALYSIS_DIMENSIONS.every(({ key }) => !properties[key].length)
  );
}

export function tagLabel(tag: string) {
  const spaced = tag.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function analysisFields(analysis: Partial<AnalysisProperties> | null | undefined) {
  return {
    ...(Object.fromEntries(
      ANALYSIS_DIMENSIONS.map(({ key }) => [key, (analysis?.[key] ?? []).map(tagLabel)]),
    ) as Record<TagDimension, string[]>),
    palette: analysis?.colorPalette ?? [],
    rationale: (analysis?.rationale ?? "").trim(),
  };
}
