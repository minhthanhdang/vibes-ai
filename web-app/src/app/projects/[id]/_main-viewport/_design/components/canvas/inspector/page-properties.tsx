"use client";

import { useRef, useState } from "react";
import type { BoardSelection } from "@/lib/canvas/moodboard-selection";
import { usePalette } from "../../../hooks/use-palette";
import { InspectorHeader } from "./inspector-header";

/// A page selected on its own. Excalidraw's islands say everything there is to
/// say about a frame — its name, its size, where it is — and nothing at all
/// about the one property a page has that a frame does not: the colour it
/// stands on. That ground is a locked rectangle at the very back of the page
/// (canvas.md §XI.4), deliberately unselectable so it is not what every click
/// on empty page lands on, which leaves this panel as the only place it can be
/// changed.
export function PageProperties({
  selection,
  onClose,
  onPageBackground,
}: {
  selection: Extract<BoardSelection, { kind: "page" }>;
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
        <PageBackgroundAction
          background={selection.background}
          referenceIds={selection.referenceIds}
          onPageBackground={onPageBackground}
        />
      </div>
    </>
  );
}

/// A `#rrggbb` for the colour input, which accepts nothing else — a page
/// standing on nothing opens the picker on white rather than refusing to render.
function pickerValue(colour: string | null): string {
  return colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#ffffff";
}

/// What the page can be painted, and the two ways of saying it.
///
/// The colours offered first are the page's *own* — agent 2's palettes for the
/// photographs standing on it, merged exactly as the palette bar merges them.
/// That is the one offer a swatch book cannot make, and it is what makes a
/// ground read as part of the composition rather than a wash behind it. The
/// picker is there for everything else, and clearing leaves the page on the
/// board's colour rather than on white paper.
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
  /// Held locally while it is being dragged: the panel is re-derived from the
  /// scene as the board settles, and a value driven from there would jump back
  /// under the pointer mid-choice.
  const [picked, setPicked] = useState(() => pickerValue(background));
  /// Whether the picker was actually used. Opening it and closing it again
  /// fires no change at all, and a blur that committed anyway would paint the
  /// page the value the input happened to open on — white, for a page standing
  /// on nothing.
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
                  /// The colour it is already standing on wears the ring, so the
                  /// panel says what the page is as well as what it could be.
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
        {/* Every frame of a drag inside the picker paints the page, so the
            choice is watched on the page it is being made for — but only the
            release is an undo step, which is what the preview flag buys. */}
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