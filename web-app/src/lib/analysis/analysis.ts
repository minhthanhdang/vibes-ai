/// Agent 2's output vocabulary, shared by the agent that produces tags, the
/// response schema that constrains the model, and the UI that renders them.
/// tech-spec §III.2: fixed vocabulary per dimension so agent 5 can group by
/// tag — a free-text tag is a group of one and disappears from the deck.
///
/// Client-safe on purpose: the property panel imports this for labels.
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

/// Reading order of the property panel. Palette leads because it is the one
/// dimension the director can read without words.
export const ANALYSIS_DIMENSIONS = [
  { key: "lighting", label: "Lighting" },
  { key: "texture", label: "Texture & grain" },
  { key: "composition", label: "Composition" },
  { key: "subject", label: "Subject & context" },
  { key: "contrastDepth", label: "Contrast & depth" },
] as const satisfies readonly { key: TagDimension; label: string }[];

/// A palette wider than this stops reading as a palette and a tag list longer
/// than this stops being a summary. Both are also what the response schema
/// asks the model for, so trimming here is a backstop, not the mechanism.
export const PALETTE_LIMIT = 6;
export const TAGS_PER_DIMENSION_LIMIT = 5;
const RATIONALE_LIMIT = 600;
/// A name, not a description — it stands on a catalog line beside five other
/// fields, and a title that runs on is the rationale in the one place the
/// rationale was left out of.
const TITLE_LIMIT = 80;

export type AnalysisProperties = {
  /// What the picture is of, in agent 2's words. `Reference.title` is whatever
  /// filename the browser sent, so this is the first name in the row that was
  /// read off the frame.
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

/// `#rrggbb` lowercase, or null when the value is not a colour we can paint.
/// The model is asked for hex and mostly obliges, but "#FFF", " #ffcc00 " and
/// a bare "ffcc00" all turn up, and each of them is a real colour.
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

/// The model returns a tag list, but not always as a list, and not always in
/// the exact spelling it was given: "Golden Hour" and "golden_hour" are the
/// vocabulary term, "cinematic" is not and is dropped rather than stored — an
/// off-vocabulary tag groups with nothing downstream.
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

/// Structured output constrains the model, it does not verify it — a preview
/// model still answers with a stray tag or a colour name now and then, and a
/// half-parsed response is worth more to the director than a failed run.
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

/// True when the analyzer came back with nothing worth showing, which the
/// panel renders as "no properties found" rather than as an empty grid of
/// headings. An analysis row that exists is never a loading state.
export function isEmptyAnalysis(properties: AnalysisProperties) {
  return (
    !properties.colorPalette.length &&
    ANALYSIS_DIMENSIONS.every(({ key }) => !properties[key].length)
  );
}

/// `golden-hour` reads as a slug in a database and as a mistake in a UI.
export function tagLabel(tag: string) {
  const spaced = tag.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
