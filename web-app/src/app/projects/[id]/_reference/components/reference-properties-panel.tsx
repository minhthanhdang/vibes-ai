"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { secondLevelPlacement } from "@/lib/ui/second-level-sidebar";
import {
  isTrailRoot,
  openedTrail,
  trailBack,
  trailCurrent,
  trailLabel,
  trailUpTo,
  type TrailStep,
} from "@/lib/references/reference-trail";
import { cropBoxOutline } from "@/lib/references/reference-version";
import { DrawnFrom } from "./drawn-from";
import { useSidebarState } from "../../_workspace/stores/sidebar-state";
import { takeVersionFocus, useFocusedVersion } from "../stores/version-focus";
import { useViewportWidth } from "../hooks/viewport-width";
import { ReferenceProperties } from "./reference-properties";
import { ReferenceVersions } from "./reference-versions";

export type PanelReference = TrailStep;

/// The sidebar's second level. Portalled to the body and fixed against the
/// sidebar's inner edge, so it lays over the gallery instead of taking width
/// from it — the tile the user was looking at stays where it was.
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

  /// Which cut of the shown frame the user is pointing at, and the step it
  /// is a cut *of* — carried together so that walking into a version cannot
  /// leave the box of a sibling drawn over it. The list unmounts on that walk
  /// and never gets to say the pointer left it.
  const [pointed, setPointed] = useState<{ stepId: string; cropBox: number[] } | null>(null);

  /// The box agent 3 has just answered with and nothing has been cut of yet,
  /// carried with its step for the same reason. This is where the offer is
  /// looked at: the versions card below is a few characters wide and a box is
  /// judged on the frame, at the size the frame is shown.
  const [proposed, setProposed] = useState<{ stepId: string; cropBox: number[] } | null>(null);
  /// Rebuilt only when the step changes — which is the same event that remounts
  /// the section calling it — so the effect that publishes a proposal upward
  /// does not re-fire on every render of this panel.
  const propose = useCallback(
    (cropBox: number[] | null) => setProposed(cropBox ? { stepId: shown.id, cropBox } : null),
    [shown.id],
  );

  /// The cut the chat sent the user to, when the thing they clicked was a
  /// version. Read against the step on screen so a walk into a different frame
  /// cannot pick up a row waiting on the one behind it.
  const focusVersionId = useFocusedVersion(shown.id);

  /// Pointing wins while it lasts: a user reading the offer can still check
  /// where an existing cut of this frame is, and the offer comes back when the
  /// pointer leaves it.
  const highlighted =
    (pointed?.stepId === shown.id ? pointed.cropBox : null) ??
    (proposed?.stepId === shown.id ? proposed.cropBox : null);
  const outline = cropBoxOutline(highlighted);

  /// Listening on the document rather than on the panel: this is deliberately
  /// not a modal — the chat beside it stays usable, so focus is often not in
  /// here when Escape is pressed.
  ///
  /// Escape walks back out the way it walked in, and closes only from the
  /// photograph itself: a user two crops deep pressing it means "not this
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
                    /// what the user is looking at is the one that has to
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
        {/* The frame, and — while a cut of it is pointed at below, or one is
            being offered — which part of it that cut is. A version's own
            thumbnail says what it kept and never where it was, and every cut
            listed under one frame is a picture of that same frame, so this is
            what tells them apart on sight. It is the same drawing either way,
            because a cut that exists and one being offered raise the same
            question. Everything outside the box is dimmed rather than the box
            drawn on: the answer is what was kept. */}
        <div className="relative overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.thumbUrl} alt={trailLabel(shown)} className="w-full object-cover" />
          {outline ? (
            <div
              aria-hidden
              style={{
                left: `${outline.left}%`,
                top: `${outline.top}%`,
                width: `${outline.width}%`,
                height: `${outline.height}%`,
              }}
              className="pointer-events-none absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
            />
          ) : null}
        </div>
        <DrawnFrom reference={shown} />

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
          /// The step itself, for its pixels: a box on the image above is drawn
          /// on the grid-sized copy, so how big the cut would actually be is a
          /// question only the frame's own dimensions answer.
          frame={shown}
          onOpen={(version) => setTrail((walked) => openedTrail(walked, version))}
          onPoint={(cropBox) => setPointed(cropBox ? { stepId: shown.id, cropBox } : null)}
          onPropose={propose}
          focusVersionId={focusVersionId}
          onFocusApplied={takeVersionFocus}
        />
      </div>
    </aside>,
    document.body,
  );
}
