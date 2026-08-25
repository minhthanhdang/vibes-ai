"use client";

import { useQueries } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { analysisView } from "@/lib/analysis/analysis-view";
import { mergedPalette } from "@/lib/canvas/moodboard-palette";

/// The palette agent 2 read out of a set of references, merged. The same
/// per-reference query the panel body polls, so the colours offered are always
/// the colours on screen, and a selection of five costs five small reads of
/// rows that are usually already cached. Asked by both things this panel does
/// with colour — placing it on the board, and printing a page on it.
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