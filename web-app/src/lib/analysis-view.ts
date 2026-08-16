import { isEmptyAnalysis, type AnalysisProperties } from "./analysis";

/// What the property panel is looking at. The analyzer runs out of band, so a
/// reference the director just uploaded has no `Analysis` row for as long as the
/// worker takes — the panel has to tell "not yet" apart from "nothing found",
/// and both of those apart from a run that died.
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

/// A stored analysis always wins over the run row: rows are written once the
/// agent has succeeded, so properties on screen are never stale relative to a
/// later re-run that failed, and re-running must not blank a panel that already
/// has something to show.
export function analysisView({ properties, run }: AnalysisSource): AnalysisView {
  /// `isEmptyAnalysis` is about the dimensions agent 5 groups by, and a
  /// rationale is none of them — but a sentence about the look is still the
  /// panel having something to say, so it opens the panel on its own.
  if (properties) {
    const hasAnything = !isEmptyAnalysis(properties) || properties.rationale.length > 0;
    return hasAnything ? { kind: "ready", properties } : { kind: "empty" };
  }

  /// `add` files the job in the same transaction as the reference, so there is
  /// no window where a row exists without one. No run means no job was ever
  /// filed — a reference from before the queue, or one whose run was deleted —
  /// and a spinner there would never end. It is an offer to analyze instead.
  if (!run) return { kind: "unanalyzed" };

  switch (run.status) {
    case "QUEUED":
    case "RUNNING":
      return { kind: "pending", message: PENDING_MESSAGE[run.status] };
    case "FAILED":
      return { kind: "failed", message: run.error?.trim() || FAILED_FALLBACK };
    /// Succeeded with nothing written is the model finding no term it was sure
    /// of. Waiting on it forever would be a lie.
    case "SUCCEEDED":
      return { kind: "empty" };
  }
}

/// Polling only while the answer can still change — a settled panel that keeps
/// asking costs a query per open reference per interval for nothing.
export function isAnalysisPending(view: AnalysisView) {
  return view.kind === "pending";
}

/// Every state the panel can settle on with nothing to show is a dead end
/// unless the director can ask again, and each one is a different ask: one job
/// was never filed, one died, one ran and found nothing worth saying.
const REQUEST_LABEL: Partial<Record<AnalysisView["kind"], string>> = {
  unanalyzed: "Analyze this reference",
  failed: "Try again",
  empty: "Analyze again",
};

/// What the panel's re-analyze button says, or null when there is nothing to
/// ask for — a job already in the queue does not need a second one, and a
/// filled panel is not a dead end.
export function analysisRequestLabel(view: AnalysisView) {
  return REQUEST_LABEL[view.kind] ?? null;
}
