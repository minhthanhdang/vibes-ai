"use client";

import { useRef, useState } from "react";
import type { BoardSelection } from "@/lib/canvas/moodboard-selection";
import { usePalette } from "../../../hooks/use-palette";
import { InspectorHeader } from "./inspector-header";

export function PageProperties({
  selection,
  held,
  onClose,
  onPageBackground,
}: {
  selection: Extract<BoardSelection, { kind: "page" }>;
  held: boolean;
  onClose: () => void;
  onPageBackground: (colour: string | null, options?: { preview?: boolean }) => void;
}) {
  return (
    <>
      <InspectorHeader title={selection.name || "Page"} onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <p className="text-xs opacity-60">
          The colour this page is printed on. It goes behind everything already standing
          there — nothing moves, and nothing on the board can pick it up by accident.
        </p>
        {held ? null : (
          <PageBackgroundAction
            background={selection.background}
            referenceIds={selection.referenceIds}
            onPageBackground={onPageBackground}
          />
        )}
      </div>
    </>
  );
}

function pickerValue(colour: string | null): string {
  return colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#ffffff";
}

function PageBackgroundAction({
  background,
  referenceIds,
  onPageBackground,
}: {
  background: string | null;
  referenceIds: readonly string[];
  onPageBackground: (colour: string | null, options?: { preview?: boolean }) => void;
}) {
  const colors = usePalette(referenceIds);
  const [picked, setPicked] = useState(() => pickerValue(background));
  const chosen = useRef(false);
  const painted = background?.toLowerCase() ?? null;

  return (
    <div className="flex flex-col gap-3 border-t border-current/10 pt-3">
      {colors.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] opacity-55">From the photographs on this page</p>
          <ul className="flex flex-wrap gap-1.5">
            {colors.map((color) => (
              <li key={color}>
                <button
                  type="button"
                  onClick={() => onPageBackground(color)}
                  title={`Print this page on ${color}`}
                  style={{ backgroundColor: color }}
                  className={`size-6 rounded-full ring-2 transition-transform duration-150 hover:scale-110 ${
                    painted === color.toLowerCase() ? "ring-current" : "ring-[var(--background)]"
                  }`}
                >
                  <span className="sr-only">{color}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="color"
          value={picked}
          onChange={(event) => {
            chosen.current = true;
            setPicked(event.target.value);
            onPageBackground(event.target.value, { preview: true });
          }}
          onBlur={() => {
            if (!chosen.current) return;
            chosen.current = false;
            onPageBackground(picked);
          }}
          aria-label="Page background colour"
          className="size-6 cursor-pointer rounded-md border border-current/20 bg-transparent p-0"
        />
        Any colour
      </label>

      {background ? (
        <button
          type="button"
          onClick={() => onPageBackground(null)}
          title="Leave the page standing on the board's own colour"
          className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
        >
          No background
        </button>
      ) : null}
    </div>
  );
}