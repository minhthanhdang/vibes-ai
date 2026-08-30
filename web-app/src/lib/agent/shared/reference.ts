import { ReferenceOrigin } from "@/generated/prisma/enums";
import {
  ANALYSIS_DIMENSIONS,
  analysisFields,
  tagLabel,
  type AnalysisProperties,
  type TagDimension,
} from "@/lib/analysis/analysis";
import { cropShapeAt } from "@/lib/references/reference-version";

export const CATALOG_LIMIT = 24;

export type UnreadReason = "pending" | "failed" | "never";

export const UNREAD_MARK: Record<UnreadReason, string> = {
  pending: "not read yet",
  failed: "could not be read",
  never: "never read",
};


export const UNREAD_CATALOG_NOTE =
  "a picture marked “unread” has not been read by the property analyzer — its look is unknown rather than plain, so do not say what it is of. “pending” arrives on its own; “failed” and “never” will not, and only the user can ask for a reading, from that picture's properties panel.";

export function unreadReason(
  run: { status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" } | null | undefined,
): UnreadReason | null {
  if (!run) return "never";
  if (run.status === "QUEUED" || run.status === "RUNNING") return "pending";
  return run.status === "FAILED" ? "failed" : null;
}

export type ToolReference = {
  id: string;
  title: string;
  width?: number | null;
  height?: number | null;
  editIntent?: string | null;
  editAspect?: string | null;
  thumbUrl: string;
  favorite?: boolean | null;
  source?: { id: string; title: string } | null;
  origin?: ReferenceOrigin | null;
  generationPrompt?: string | null;
  analysis?: Partial<AnalysisProperties> | null;
  unread?: UnreadReason | null;
};

export type ReferenceDigest = {
  id: string;
  title: string;
  shape: string;
  favorite?: true;
  croppedFrom?: string;
  made?: true;
  keeps?: string;
  tags?: string[];
  unread?: UnreadReason;
};

export function aspectLabel(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  return cropShapeAt(width / height)?.label ?? `${(width / height).toFixed(2)}:1`;
}

export function digestTags(analysis?: Partial<AnalysisProperties> | null) {
  if (!analysis) return undefined;
  const tags = ANALYSIS_DIMENSIONS.flatMap(({ key }) => analysis[key] ?? []).map(tagLabel);
  return tags.length ? tags : undefined;
}

export function drawnFrom(reference: ToolReference) {
  const asked = (reference.generationPrompt ?? "").trim();
  return asked || undefined;
}

export function referenceDigest(reference: ToolReference): ReferenceDigest {
  const keeps = (reference.editIntent ?? "").trim();
  const tags = digestTags(reference.analysis);
  return {
    id: reference.id,
    title: (reference.analysis?.title ?? "").trim() || reference.title.trim() || "Untitled",
    shape: aspectLabel(reference.width, reference.height),
    ...(reference.favorite && { favorite: true as const }),
    ...(reference.source && { croppedFrom: reference.source.id }),
    ...(reference.origin === ReferenceOrigin.GENERATED && { made: true as const }),
    ...(keeps && { keeps }),
    ...(tags && { tags }),
    ...(!tags && reference.unread && { unread: reference.unread }),
  };
}

export type ReferenceProperties = Omit<ReferenceDigest, "tags" | "unread"> &
  Record<TagDimension, string[]> & {
    palette: string[];
    rationale: string;
    drawnFrom?: string;
  };

export function referenceProperties(reference: ToolReference): ReferenceProperties | null {
  const { analysis } = reference;
  if (!analysis) return null;

  const { id, title, shape, favorite, croppedFrom, made, keeps } = referenceDigest(reference);
  const asked = drawnFrom(reference);
  return {
    id,
    title,
    shape,
    ...(favorite && { favorite }),
    ...(croppedFrom && { croppedFrom }),
    ...(made && { made }),
    ...(keeps && { keeps }),
    ...analysisFields(analysis),
    ...(asked && { drawnFrom: asked }),
  };
}

export function referenceCatalog(references: readonly ToolReference[], limit = CATALOG_LIMIT) {
  const shown = references.slice(0, Math.max(0, limit));
  return {
    total: references.length,
    shown: shown.length,
    references: shown.map(referenceDigest),
  };
}
