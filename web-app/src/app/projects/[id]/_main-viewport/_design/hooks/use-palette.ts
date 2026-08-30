"use client";

import { useQueries } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { analysisView } from "@/lib/analysis/analysis-view";
import { mergedPalette } from "@/lib/canvas/moodboard-palette";

export function usePalette(referenceIds: readonly string[]) {
  const trpc = useTRPC();
  const results = useQueries({
    queries: referenceIds.map((referenceId) =>
      trpc.reference.properties.queryOptions({ referenceId }),
    ),
  });

  const palettes = results.map((result) => {
    const view = result.data ? analysisView(result.data) : null;
    return view?.kind === "ready" ? view.properties.colorPalette : [];
  });
  return mergedPalette(palettes);
}