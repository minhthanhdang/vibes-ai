import { normalizeHexColor } from "@/lib/analysis/analysis";
import { RENDER_BACKGROUND } from "@/lib/render/render-plan";
import { persistedAppState, type PersistedAppState } from "@/lib/scene/moodboard-scene";

export const CANVAS_BACKGROUND_DEFAULT = "default";

function drawnOn(appState: unknown): string {
  const stored = (appState as { viewBackgroundColor?: unknown } | null | undefined)
    ?.viewBackgroundColor;
  return normalizeHexColor(stored) ?? RENDER_BACKGROUND;
}

export function canvasBackgroundColour(appState: unknown): string | null {
  const stored = (appState as { viewBackgroundColor?: unknown } | null | undefined)
    ?.viewBackgroundColor;
  return normalizeHexColor(stored);
}

export type CanvasBackgroundEdit = {
  appState: PersistedAppState | null;
  colour: string | null;
  was: string | null;
};

export function setCanvasBackground({
  appState,
  colour,
}: {
  appState: unknown;
  colour: unknown;
}): CanvasBackgroundEdit | null {
  const asked = typeof colour === "string" ? colour.trim() : "";
  const clearing = asked.toLowerCase() === CANVAS_BACKGROUND_DEFAULT;
  const hex = clearing ? null : normalizeHexColor(asked);
  if (!clearing && !hex) return null;

  const was = canvasBackgroundColour(appState);
  if (drawnOn(appState) === (hex ?? RENDER_BACKGROUND)) {
    return { appState: null, colour: clearing ? null : hex, was };
  }

  const next = persistedAppState(appState);
  if (clearing) delete next.viewBackgroundColor;
  else next.viewBackgroundColor = hex!;

  return { appState: next, colour: hex, was };
}
