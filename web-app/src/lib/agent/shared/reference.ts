import { ReferenceOrigin } from "@/generated/prisma/enums";
import {
  ANALYSIS_DIMENSIONS,
  analysisFields,
  tagLabel,
  type AnalysisProperties,
  type TagDimension,
} from "@/lib/analysis/analysis";
import { cropShapeAt } from "@/lib/references/reference-version";

/// A picture as every agent reads it — the columns a tool needs, the line it is
/// said as, and the whole of its analysis where a tool is worth a round.
///
/// Kept pure and out of `server/` because both sides need it: the executor
/// builds these values, the chat renders them.

/// How many references one catalog answer carries — a cost ceiling first and a
/// readability one second.
export const CATALOG_LIMIT = 24;

/// Why a picture's line carries no tags. Three reasons rather than one, because
/// they need three different next steps.
export type UnreadReason = "pending" | "failed" | "never";

/// Three or four tokens on a line, against a sentence carried once under the
/// list. Exported because a page's blocks are said in this same format and two
/// wordings would be two dialects in one prompt.
export const UNREAD_MARK: Record<UnreadReason, string> = {
  pending: "not read yet",
  failed: "could not be read",
  never: "never read",
};


/// The same thing said to a *tool answer* rather than to the instruction, and
/// only attached when something in that answer is marked.
export const UNREAD_CATALOG_NOTE =
  "a picture marked “unread” has not been read by the property analyzer — its look is unknown rather than plain, so do not say what it is of. “pending” arrives on its own; “failed” and “never” will not, and only the user can ask for a reading, from that picture's properties panel.";

/// Which of the three reasons a reference with no analysis is under, read off
/// its latest analyzer run. Null means it was read.
export function unreadReason(
  run: { status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" } | null | undefined,
): UnreadReason | null {
  if (!run) return "never";
  if (run.status === "QUEUED" || run.status === "RUNNING") return "pending";
  return run.status === "FAILED" ? "failed" : null;
}

/// A reference as the database holds it, in the columns a tool needs — the
/// loosest shape that answers them.
export type ToolReference = {
  id: string;
  title: string;
  width?: number | null;
  height?: number | null;
  editIntent?: string | null;
  editAspect?: string | null;
  thumbUrl: string;
  /// The star the user put on it in the gallery. Optional because a caller
  /// that has not read the column leaves it off, and an unmarked line then reads
  /// exactly as it always did.
  favorite?: boolean | null;
  source?: { id: string; title: string } | null;
  /// Where the bytes came from, read only to mark the pictures this assistant
  /// drew. Optional for the reason `favorite` is: a caller that has not read
  /// the column is not claiming the picture was shot.
  origin?: ReferenceOrigin | null;
  /// The description a drawn picture was made from. Optional on the same terms
  /// as `origin`, and absent on every picture nobody drew.
  generationPrompt?: string | null;
  analysis?: Partial<AnalysisProperties> | null;
  /// Set only when there is no analysis to read and the reason is known. The
  /// toolset fills it from the project's analyzer runs; a caller that has not
  /// asked leaves it off, and a line with no tags then reads as it always did.
  unread?: UnreadReason | null;
};

/// One reference as the model reads it, every field earning its tokens. The
/// bytes are never in here — an agent that needs to *look* at a picture is
/// given its `gs://` uri as a file part, not a JSON field.
export type ReferenceDigest = {
  id: string;
  title: string;
  shape: string;
  /// True or absent, never false: an unstarred picture is the ordinary case and
  /// `favorite: false` on twenty-three lines is the tokens of a fact nobody
  /// needed. Present, it is the user's own judgement of the set — the only
  /// one in a digest that was not read off the pixels.
  favorite?: true;
  croppedFrom?: string;
  /// True or absent, never false, on the same terms as `favorite`: a picture
  /// this assistant drew is the rare line, and marking every photograph as one
  /// nobody drew is the tokens of the ordinary case.
  ///
  /// Earned rather than decorative — the instruction is to prefer a picture the
  /// user has over drawing another one, and without this the catalog reads a
  /// backdrop the model invented an hour ago as a photograph they shot.
  made?: true;
  keeps?: string;
  tags?: string[];
  /// Present only when the tags are missing *and* the reason is known, so the
  /// two silences a blank line used to carry — not read, and read with nothing
  /// found — are told apart wherever a digest goes.
  unread?: UnreadReason;
};

/// The shape of a picture, by the name a user would use for it, falling back to
/// the ratio itself.
export function aspectLabel(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  return cropShapeAt(width / height)?.label ?? `${(width / height).toFixed(2)}:1`;
}

/// The tags of one reference, flattened across the dimensions into the one list
/// the model reasons over, with the palette deliberately left out.
export function digestTags(analysis?: Partial<AnalysisProperties> | null) {
  if (!analysis) return undefined;
  const tags = ANALYSIS_DIMENSIONS.flatMap(({ key }) => analysis[key] ?? []).map(tagLabel);
  return tags.length ? tags : undefined;
}

/// What a drawn picture was asked for, or nothing at all. Read off the column
/// and not off `origin`, and blank reads as absent.
export function drawnFrom(reference: ToolReference) {
  const asked = (reference.generationPrompt ?? "").trim();
  return asked || undefined;
}

export function referenceDigest(reference: ToolReference): ReferenceDigest {
  const keeps = (reference.editIntent ?? "").trim();
  const tags = digestTags(reference.analysis);
  return {
    id: reference.id,
    /// Agent 2's name first, the row's second. The row's is the filename the
    /// browser sent, which names a file on somebody's laptop rather than
    /// anything in the frame, so a name read off the picture beats it wherever
    /// there is one. `Untitled` is only for a picture nobody has read that was
    /// also uploaded without a name.
    title: (reference.analysis?.title ?? "").trim() || reference.title.trim() || "Untitled",
    shape: aspectLabel(reference.width, reference.height),
    ...(reference.favorite && { favorite: true as const }),
    ...(reference.source && { croppedFrom: reference.source.id }),
    ...(reference.origin === ReferenceOrigin.GENERATED && { made: true as const }),
    ...(keeps && { keeps }),
    ...(tags && { tags }),
    /// Never beside tags. A reference that has tags has been read, and marking
    /// it would be contradicting the evidence on the same line.
    ...(!tags && reference.unread && { unread: reference.unread }),
  };
}

/// One reference with the whole of its analysis, which is what
/// `read_references` answers with and the one place in the layer the palette
/// and the rationale can be reached.
export type ReferenceProperties = Omit<ReferenceDigest, "tags" | "unread"> &
  /// Under the dimension names agent 2 wrote them in, because the question this
  /// is called for is "what is the light like" and a flat list makes the model
  /// guess which of the words are about light.
  Record<TagDimension, string[]> & {
    palette: string[];
    /// Agent 2's own sentences about the look — the one field in the analysis
    /// written for a reader rather than for a group-by, and the reason the tool
    /// is worth a round at all.
    rationale: string;
    /// The description this picture was drawn from, on the pictures that were
    /// drawn. Beside the analysis rather than instead of it: the two say
    /// different things — one is what was asked for and the other is what came
    /// out — and a variant of a picture is asked for from the first.
    drawnFrom?: string;
  };

/// Null for a reference with no analysis, which is the caller's filter.
export function referenceProperties(reference: ToolReference): ReferenceProperties | null {
  const { analysis } = reference;
  if (!analysis) return null;

  /// Picked off the digest rather than spread from it, since the two fields this
  /// shape does not carry are exactly the two a spread would bring.
  const { id, title, shape, favorite, croppedFrom, made, keeps } = referenceDigest(reference);
  const asked = drawnFrom(reference);
  return {
    id,
    title,
    shape,
    ...(favorite && { favorite }),
    ...(croppedFrom && { croppedFrom }),
    /// Carried across rather than dropped with the tags: the catalog marks a
    /// picture the assistant drew, and a properties answer that left the mark
    /// off would have the same picture reading as a photograph the moment it is
    /// looked at closely.
    ...(made && { made }),
    ...(keeps && { keeps }),
    ...analysisFields(analysis),
    ...(asked && { drawnFrom: asked }),
  };
}

/// The catalog answer: what fits, and how much did not.
export function referenceCatalog(references: readonly ToolReference[], limit = CATALOG_LIMIT) {
  const shown = references.slice(0, Math.max(0, limit));
  return {
    total: references.length,
    shown: shown.length,
    references: shown.map(referenceDigest),
  };
}
