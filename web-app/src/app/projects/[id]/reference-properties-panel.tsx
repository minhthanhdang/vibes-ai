"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { secondLevelPlacement } from "@/lib/second-level-sidebar";
import { useSidebarState } from "./sidebar-state";
import { useViewportWidth } from "./viewport-width";
import { ReferenceProperties } from "./reference-properties";

export type PanelReference = { id: string; title: string; thumbUrl: string };

/// The sidebar's second level. Portalled to the body and fixed against the
/// sidebar's inner edge, so it lays over the gallery instead of taking width
/// from it — the tile the director was looking at stays where it was.
export function ReferencePropertiesPanel({
  reference,
  onClose,
}: {
  reference: PanelReference;
  onClose: () => void;
}) {
  const sidebar = useSidebarState();
  const { right, width } = secondLevelPlacement(sidebar, useViewportWidth());

  /// Listening on the document rather than on the panel: this is deliberately
  /// not a modal — the chat beside it stays usable, so focus is often not in
  /// here when Escape is pressed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /// Deliberately untransitioned: `right` tracks the sidebar's edge, and easing
  /// it leaves the panel trailing the handle by a gap for a whole drag.
  return createPortal(
    <aside
      role="dialog"
      aria-label={`Properties of ${reference.title || "reference"}`}
      style={{ right, width }}
      className="fixed inset-y-0 z-30 flex flex-col border-l border-current/10 bg-[var(--background)] text-[var(--foreground)] shadow-[-8px_0_24px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-center gap-2 border-b border-current/10 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {reference.title || "Reference"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close properties"
          className="shrink-0 rounded-md border border-current/20 px-2 py-1 text-xs opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={reference.thumbUrl}
          alt={reference.title}
          className="w-full rounded-lg object-cover"
        />
        {/* Keyed on the reference so switching tiles in the strip remounts the
            panel rather than showing the previous image's properties until the
            next query settles. */}
        <ReferenceProperties key={reference.id} referenceId={reference.id} />
      </div>
    </aside>,
    document.body,
  );
}
