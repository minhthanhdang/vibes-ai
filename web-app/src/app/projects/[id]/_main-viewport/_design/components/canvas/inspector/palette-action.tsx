"use client";

import { ColorPalette } from "@/components/color-palette";
import { usePalette } from "../../../hooks/use-palette";

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