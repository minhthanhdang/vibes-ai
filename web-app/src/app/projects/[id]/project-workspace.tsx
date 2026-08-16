"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  SIDEBAR_KEYBOARD_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarPageWidth,
  widthAfterDrag,
} from "@/lib/sidebar";
import { MoodboardPanel } from "./moodboard-panel";
import { ReferenceGallery } from "./reference-gallery";
import { ReferenceSidebar } from "./reference-sidebar";
import { SidebarReferences } from "./sidebar-references";
import { ReferenceUploader } from "./reference-uploader";
import { usePendingUploads } from "./pending-uploads";
import { inspectReference } from "./reference-inspection";
import { openBoard } from "./board-selection";
import { offerCrop } from "./crop-offer";
import { focusVersion } from "./version-focus";
import { recordCutTaken } from "./chat-log";
import { onCutTaken } from "./cut-taken";
import { setSidebarWidth, toggleSidebar, useSidebarState } from "./sidebar-state";

type WorkspaceView = "gallery" | "moodboard";

const VIEWS: { id: WorkspaceView; label: string }[] = [
  { id: "gallery", label: "References" },
  { id: "moodboard", label: "Moodboard" },
];

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
  /// The gallery is where references arrive, the board is where they are
  /// composed. They want the same column and all of it, so they take turns
  /// rather than splitting it.
  const [view, setView] = useState<WorkspaceView>("gallery");
  /// Held here rather than in the uploader: the dropzone knows which files are
  /// in flight and the gallery is what has to show them.
  const uploads = usePendingUploads();

  /// A cut the director takes in the properties panel goes back into the
  /// conversation — it is the other end of `crop_reference`, and the note it
  /// leaves is what lets the next turn name the new row without buying a round
  /// to find it. Listened for here rather than in the assistant's column, because
  /// that column collapses and the taking does not wait for it to be open.
  useEffect(() => onCutTaken((cut) => recordCutTaken(projectId, cut)), [projectId]);

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
    <div className="flex min-h-0 flex-1 items-stretch">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2">
          <Link href="/projects" className="text-sm opacity-50 hover:opacity-80">
            ← Projects
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {brief ? <p className="text-sm opacity-60">{brief}</p> : null}

          <nav className="mt-2 flex gap-1 self-start rounded-full border border-current/15 p-0.5">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                aria-current={view === option.id}
                className={`rounded-full px-3 py-1 text-xs transition-opacity ${
                  view === option.id ? "bg-current/10 font-medium" : "opacity-60 hover:opacity-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </nav>
        </header>

        {view === "gallery" ? (
          <>
            <ReferenceUploader projectId={projectId} uploads={uploads} />
            <ReferenceGallery projectId={projectId} pendingUploads={uploads.pending} />
          </>
        ) : (
          <MoodboardPanel projectId={projectId} />
        )}
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
            <>
              <SidebarReferences projectId={projectId} />
              {/* What the assistant showed is a way into the workspace, not a
                  picture of it. A reference switches the column back to the grid
                  it lives in — the properties panel lays over that column, and
                  opening it on top of the board would hide what it was covering
                  — and a board switches the column to the board. */}
              <ReferenceSidebar
                projectId={projectId}
                onOpen={(target) => {
                  setView(target.view);
                  if (target.view !== "gallery") {
                    openBoard(target.boardId);
                    return;
                  }
                  /// The offer is put down before the panel goes looking for it,
                  /// so the frame opens with the box already drawn on it rather
                  /// than plain for a render. A cut is put down the same way and
                  /// for the same reason: the frame opens at the row that was
                  /// clicked instead of at the top of a list holding it.
                  offerCrop(target.offer ?? null);
                  focusVersion(
                    target.versionId
                      ? { frameId: target.inspectId, versionId: target.versionId }
                      : null,
                  );
                  inspectReference(target.inspectId);
                }}
              />
            </>
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
