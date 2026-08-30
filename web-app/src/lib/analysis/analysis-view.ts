import { isEmptyAnalysis, type AnalysisProperties } from "@/lib/analysis/analysis";

export type AnalysisRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type AnalysisSource = {
  properties: AnalysisProperties | null;
  run: { status: AnalysisRunStatus; error?: string | null } | null;
};

export type AnalysisView =
  | { kind: "pending"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "empty" }
  | { kind: "unanalyzed" }
  | { kind: "ready"; properties: AnalysisProperties };

const PENDING_MESSAGE: Record<"QUEUED" | "RUNNING", string> = {
  QUEUED: "Queued for analysis…",
  RUNNING: "Reading the image…",
};

const FAILED_FALLBACK = "Analysis failed.";

export function analysisView({ properties, run }: AnalysisSource): AnalysisView {
  if (properties) {
    const hasAnything = !isEmptyAnalysis(properties) || properties.rationale.length > 0;
    return hasAnything ? { kind: "ready", properties } : { kind: "empty" };
  }

  if (!run) return { kind: "unanalyzed" };

  switch (run.status) {
    case "QUEUED":
    case "RUNNING":
      return { kind: "pending", message: PENDING_MESSAGE[run.status] };
    case "FAILED":
      return { kind: "failed", message: run.error?.trim() || FAILED_FALLBACK };
    case "SUCCEEDED":
      return { kind: "empty" };
  }
}

export function isAnalysisPending(view: AnalysisView) {
  return view.kind === "pending";
}

const REQUEST_LABEL: Partial<Record<AnalysisView["kind"], string>> = {
  unanalyzed: "Analyze this reference",
  failed: "Try again",
  empty: "Analyze again",
};

export function analysisRequestLabel(view: AnalysisView) {
  return REQUEST_LABEL[view.kind] ?? null;
}
