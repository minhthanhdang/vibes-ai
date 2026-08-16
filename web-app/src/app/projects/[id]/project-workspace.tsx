"use client";

import { useState } from "react";
import Link from "next/link";
import {
  SIDEBAR_KEYBOARD_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarPageWidth,
  widthAfterDrag,
} from "@/lib/sidebar";
import { ReferenceGallery } from "./reference-gallery";
import { ReferenceSidebar } from "./reference-sidebar";
import { ReferenceUploader } from "./reference-uploader";
import { usePendingUploads } from "./pending-uploads";
import { setSidebarWidth, toggleSidebar, useSidebarState } from "./sidebar-state";

export function ProjectWorkspace({
  projectId,
  title,
  brief,
}: {
  projectId: string;
  title: string;
  brief: string;
}) {
  const { isOpen: isSidebarOpen, width } = useSidebarState();
  const [isResizing, setIsResizing] = useState(false);
  /// Held here rather than in the uploader: the dropzone knows which files are
  /// in flight and the gallery is what has to show them.
  const uploads = usePendingUploads();

  /// Pointer capture keeps the drag alive over the gallery and past the window
  /// edge, which a plain pointermove on the handle loses the moment the cursor
  /// outruns it.
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(event.pointerId);
    setIsResizing(true);

    const onMove = (move: PointerEvent) =>
      setSidebarWidth(widthAfterDrag(startWidth, startX, move.clientX), { persist: false });
    const onEnd = (end: PointerEvent) => {
      setSidebarWidth(widthAfterDrag(startWidth, startX, end.clientX));
      setIsResizing(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  return (
    /// The sidebar is a flex sibling, not an overlay — expanding it narrows the
    /// gallery instead of covering it.
    <div className="flex flex-1 items-stretch">
      <main className="flex min-w-0 flex-1 flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2">
          <Link href="/projects" className="text-sm opacity-50 hover:opacity-80">
            ← Projects
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {brief ? <p className="text-sm opacity-60">{brief}</p> : null}
        </header>

        <ReferenceUploader projectId={projectId} uploads={uploads} />
        <ReferenceGallery projectId={projectId} pendingUploads={uploads.pending} />
      </main>

      <aside
        style={{ width: sidebarPageWidth({ isOpen: isSidebarOpen, width }) }}
        className={`shrink-0 overflow-hidden border-l border-current/10 ${
          /// Animating the collapse is worth it; animating a drag makes the edge
          /// trail the pointer.
          isResizing ? "" : "transition-[width] duration-200"
        }`}
      >
        {/* `sticky` is a positioned value, so the resize handle can be absolute
            against it without a second wrapper. */}
        <div className="sticky top-0 flex h-dvh flex-col">
          {isSidebarOpen ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuenow={width}
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") setSidebarWidth(width + SIDEBAR_KEYBOARD_STEP);
                else if (event.key === "ArrowRight") setSidebarWidth(width - SIDEBAR_KEYBOARD_STEP);
                else return;
                event.preventDefault();
              }}
              className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-current/20 focus-visible:bg-current/30 focus-visible:outline-none"
            />
          ) : null}

          <div
            className={`flex items-center gap-2 border-b border-current/10 px-3 py-3 ${
              isSidebarOpen ? "justify-between" : "justify-center"
            }`}
          >
            {isSidebarOpen ? <span className="text-sm font-medium">Assistant</span> : null}
            <button
              type="button"
              onClick={toggleSidebar}
              aria-expanded={isSidebarOpen}
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              className="rounded-md border border-current/20 px-2 py-1 text-xs transition-opacity hover:opacity-70"
            >
              {isSidebarOpen ? "→" : "←"}
            </button>
          </div>

          {isSidebarOpen ? (
            <ReferenceSidebar projectId={projectId} />
          ) : (
            <span className="mt-6 self-center text-xs tracking-widest opacity-40 [writing-mode:vertical-rl]">
              ASSISTANT
            </span>
          )}
        </div>
      </aside>
    </div>
  );
}
