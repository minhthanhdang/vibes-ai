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
import { useSidebarStore } from "../../_workspace/stores/use-sidebar-store";
import { takeVersionFocus, useFocusedVersion } from "../stores/use-version-focus-store";
import { useViewportWidth } from "../hooks/use-viewport-width";
import { ReferenceProperties } from "./reference-properties";
import { ReferenceVersions } from "./reference-versions";

export type PanelReference = TrailStep;

export function ReferencePropertiesPanel({
  projectId,
  reference,
  onClose,
}: {
  projectId: string;
  reference: PanelReference;
  onClose: () => void;
}) {
  const sidebarIsOpen = useSidebarStore((state) => state.isOpen);
  const sidebarWidth = useSidebarStore((state) => state.width);
  const { right, width } = secondLevelPlacement(
    { isOpen: sidebarIsOpen, width: sidebarWidth },
    useViewportWidth(),
  );
  const [trail, setTrail] = useState<TrailStep[]>([reference]);
  const shown = trailCurrent(trail) ?? reference;
  const atRoot = isTrailRoot(trail);

  const [pointed, setPointed] = useState<{ stepId: string; cropBox: number[] } | null>(null);

  const [proposed, setProposed] = useState<{ stepId: string; cropBox: number[] } | null>(null);
  const propose = useCallback(
    (cropBox: number[] | null) => setProposed(cropBox ? { stepId: shown.id, cropBox } : null),
    [shown.id],
  );

  const focusVersionId = useFocusedVersion(shown.id);

  const highlighted =
    (pointed?.stepId === shown.id ? pointed.cropBox : null) ??
    (proposed?.stepId === shown.id ? proposed.cropBox : null);
  const outline = cropBoxOutline(highlighted);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (atRoot) onClose();
      else setTrail(trailBack);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [atRoot, onClose]);

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
        <div className="relative shrink-0 overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.thumbUrl} alt={trailLabel(shown)} className="block w-full" />
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

        <ReferenceProperties key={shown.id} referenceId={shown.id} />
        <ReferenceVersions
          key={`versions:${shown.id}`}
          projectId={projectId}
          referenceId={shown.id}
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
