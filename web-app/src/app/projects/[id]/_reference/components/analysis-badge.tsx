import { ColorPalette } from "@/components/color-palette";
import type { AnalysisView } from "@/lib/analysis/analysis-view";

export function AnalysisBadge({ view }: { view: AnalysisView }) {
  if (view.kind === "pending") {
    return (
      <span className="flex items-center gap-1.5 opacity-50" aria-busy="true" title={view.message}>
        <span className="size-2.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />
        Analyzing
      </span>
    );
  }

  if (view.kind === "failed") {
    return (
      <span className="opacity-50" title={view.message}>
        Analysis failed
      </span>
    );
  }

  if (view.kind !== "ready" || !view.properties.colorPalette.length) return null;

  return <ColorPalette colors={view.properties.colorPalette} size="sm" />;
}
