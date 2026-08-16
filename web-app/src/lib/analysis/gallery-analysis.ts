import { analyzerJob } from "@/lib/analysis/analyzer-queue";
import { analysisView, type AnalysisRunStatus, type AnalysisView } from "@/lib/analysis/analysis-view";
import type { AnalysisProperties } from "@/lib/analysis/analysis";

/// The gallery's own read of the analyzer, one query for every tile instead of
/// one per tile. The panel asks about a single reference because it is open on
/// one; the grid needs all of them at once, and a per-tile query would be a
/// round trip per image per poll.

export type GalleryAnalysisSource = {
  analyses: ({ referenceId: string } & AnalysisProperties)[];
  /// Newest first — `AgentRun` has no reference column, so which run belongs to
  /// which reference only comes out of the client-written `input` Json, and the
  /// first row naming a reference is that reference's latest run.
  runs: { input: unknown; status: AnalysisRunStatus; error: string | null }[];
};

export type GalleryAnalysisIndex = Map<string, AnalysisView>;

export function galleryAnalysisIndex({ analyses, runs }: GalleryAnalysisSource): GalleryAnalysisIndex {
  const latestRun = new Map<string, { status: AnalysisRunStatus; error: string | null }>();
  for (const { input, status, error } of runs) {
    const job = analyzerJob(input);
    if (!job || latestRun.has(job.referenceId)) continue;
    latestRun.set(job.referenceId, { status, error });
  }

  const index: GalleryAnalysisIndex = new Map();
  for (const { referenceId, ...properties } of analyses) {
    index.set(referenceId, analysisView({ properties, run: null }));
  }
  for (const [referenceId, run] of latestRun) {
    if (index.has(referenceId)) continue;
    index.set(referenceId, analysisView({ properties: null, run }));
  }
  return index;
}

/// A reference the index has never heard of is not "unanalyzed" the way the
/// panel means it: the gallery list and this read are two queries, so a tile can
/// land before the read that would have carried its job. Unknown is therefore
/// "still coming" — the tile shows the same spinner it will keep showing once
/// the queued run does turn up.
export function galleryAnalysisView(index: GalleryAnalysisIndex, referenceId: string): AnalysisView {
  return index.get(referenceId) ?? { kind: "pending", message: "Queued for analysis…" };
}

/// Whether the grid still has an answer coming, and so whether to keep polling.
/// Driven by the references on screen rather than by the index, because the
/// tiles missing from it are exactly the ones whose answer has not arrived yet.
export function isGalleryAnalysisPending(index: GalleryAnalysisIndex, referenceIds: string[]) {
  return referenceIds.some((id) => galleryAnalysisView(index, id).kind === "pending");
}
