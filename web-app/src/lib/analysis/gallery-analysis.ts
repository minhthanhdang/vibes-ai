import { analyzerJob } from "@/lib/analysis/analyzer-queue";
import { analysisView, type AnalysisRunStatus, type AnalysisView } from "@/lib/analysis/analysis-view";
import type { AnalysisProperties } from "@/lib/analysis/analysis";

export type GalleryAnalysisSource = {
  analyses: ({ referenceId: string } & AnalysisProperties)[];
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

export function galleryAnalysisView(index: GalleryAnalysisIndex, referenceId: string): AnalysisView {
  return index.get(referenceId) ?? { kind: "pending", message: "Queued for analysis…" };
}

export function isGalleryAnalysisPending(index: GalleryAnalysisIndex, referenceIds: string[]) {
  return referenceIds.some((id) => galleryAnalysisView(index, id).kind === "pending");
}
