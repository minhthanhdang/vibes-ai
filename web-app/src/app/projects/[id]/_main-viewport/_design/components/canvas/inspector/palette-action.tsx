"use client";

import { ColorPalette } from "@/components/color-palette";
import { usePalette } from "../../../hooks/use-palette";

/// The palette agent 2 read out of these references, as an object on the board.
///
/// A colour that can only be read in a panel is not part of the board a
/// user shows anyone — or of the deck agent 5 builds from it — so the one
/// thing this panel can do that the gallery's cannot is put it on the canvas.
export function PaletteAction({
  referenceIds,
  label,
  onAddPalette,
}: {
  referenceIds: readonly string[];
  label: string;
  onAddPalette: (colors: string[]) => void;
}) {
  const colors = usePalette(referenceIds);

  /// Nothing analyzed yet, or analyzed and colourless: the panel already says
  /// which of the two it is, and an offer to place an empty bar would be a
  /// button that does nothing.
  if (colors.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-current/10 pt-3">
      <ColorPalette colors={colors} size="sm" />
      <button
        type="button"
        onClick={() => onAddPalette(colors)}
        className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
      >
        {label}
      </button>
    </div>
  );
}