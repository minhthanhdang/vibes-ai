"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { secondLevelPlacement } from "@/lib/second-level-sidebar";
import {
  isTrailRoot,
  openedTrail,
  trailBack,
  trailCurrent,
  trailLabel,
  trailUpTo,
  type TrailStep,
} from "@/lib/reference-trail";
import { useSidebarState } from "./sidebar-state";
import { useViewportWidth } from "./viewport-width";
import { ReferenceProperties } from "./reference-properties";
import { ReferenceVersions } from "./reference-versions";

export type PanelReference = TrailStep;

/// The sidebar's second level. Portalled to the body and fixed against the
/// sidebar's inner edge, so it lays over the gallery instead of taking width
/// from it — the tile the director was looking at stays where it was.
///
/// It walks. A version is shown under the frame it came out of, and a version
/// has properties of its own — its palette is read off what the crop kept, not
/// off the parts it cut away — so opening one puts it in the panel, with the
/// frame it came from left behind as a crumb. That is also the only way to ask
/// for a cut of a cut, which `reference.versions` files under the cut it was
/// made from.
export function ReferencePropertiesPanel({
  projectId,
  reference,
  onClose,
}: {
  projectId: string;
  reference: PanelReference;
  onClose: () => void;
}) {
  const sidebar = useSidebarState();
  const { right, width } = secondLevelPlacement(sidebar, useViewportWidth());
  const [trail, setTrail] = useState<TrailStep[]>([reference]);
  const shown = trailCurrent(trail) ?? reference;
  const atRoot = isTrailRoot(trail);

  /// Listening on the document rather than on the panel: this is deliberately
  /// not a modal — the chat beside it stays usable, so focus is often not in
  /// here when Escape is pressed.
  ///
  /// Escape walks back out the way it walked in, and closes only from the
  /// photograph itself: a director two crops deep pressing it means "not this
  /// one", not "put the whole panel away".
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (atRoot) onClose();
      else setTrail(trailBack);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [atRoot, onClose]);

  /// Deliberately untransitioned: `right` tracks the sidebar's edge, and easing
  /// it leaves the panel trailing the handle by a gap for a whole drag.
  return createPortal(
    <aside
      role="dialog"
      aria-label={`Properties of ${trailLabel(shown)}`}
      style={{ right, width }}
      className="fixed inset-y-0 z-30 flex flex-col border-l border-current/10 bg-[var(--background)] text-[var(--foreground)] shadow-[-8px_0_24px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-center gap-2 border-b border-current/10 px-4 py-3">
        <nav aria-label="Reference trail" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {trail.map((step, index) => {
            const last = index === trail.length - 1;
            return (
              <span key={step.id} className="flex min-w-0 items-center gap-1">
                {index > 0 ? <span className="shrink-0 opacity-35">/</span> : null}
                {last ? (
                  <span className="min-w-0 truncate font-medium" title={step.title}>
                    {trailLabel(step)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTrail((walked) => trailUpTo(walked, step.id))}
                    title={step.title}
                    /// The crumbs give way before the step being shown does:
                    /// what the director is looking at is the one that has to
                    /// stay readable in a panel this narrow.
                    className="min-w-0 max-w-24 shrink truncate opacity-55 hover:opacity-100 hover:underline"
                  >
                    {trailLabel(step)}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => (atRoot ? onClose() : setTrail(trailBack))}
          aria-label={atRoot ? "Close properties" : "Back to the frame this was cut from"}
          className="shrink-0 rounded-md border border-current/20 px-2 py-1 text-xs opacity-70 hover:opacity-100"
        >
          {atRoot ? "✕" : "←"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shown.thumbUrl}
          alt={trailLabel(shown)}
          className="w-full rounded-lg object-cover"
        />
        {/* Keyed on the reference so switching tiles in the strip — or walking
            into a version — remounts the panel rather than showing the previous
            image's properties until the next query settles. */}
        <ReferenceProperties key={shown.id} referenceId={shown.id} />
        {/* Keyed alongside the properties for the same reason: a crop asked for
            on one frame must not still be running under another. */}
        <ReferenceVersions
          key={`versions:${shown.id}`}
          projectId={projectId}
          referenceId={shown.id}
          onOpen={(version) => setTrail((walked) => openedTrail(walked, version))}
        />
      </div>
    </aside>,
    document.body,
  );
}
