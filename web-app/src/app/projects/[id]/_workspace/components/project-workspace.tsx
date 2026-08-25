"use client";

import { useEffect } from "react";
import Link from "next/link";
import { DesignView } from "../../_main-viewport/_design/components/design-view";
import { ProjectBrief } from "./project-brief";
import { GalleryView } from "../../_main-viewport/_gallery/components/gallery-view";
import { ChatSidebar } from "../../_chat-sidebar/components/chat-sidebar";
import { GalleryUploader } from "../../_main-viewport/_gallery/components/gallery-uploader";
import { useDerivedReferenceCopies } from "../../_reference/hooks/use-derived-reference-copies";
import { useConversationStore } from "../../_chat-sidebar/_conversation/stores/use-conversation-store";
import { useSidebarStore } from "../stores/use-sidebar-store";
import { VibesRunPanel } from "../../_main-viewport/_design/_vibes/components/vibes-run-panel";
import { setWorkspaceView, useWorkspaceViewStore } from "../stores/use-workspace-view-store";
import type { WorkspaceView } from "../types";

const VIEWS: { id: WorkspaceView; label: string }[] = [
  { id: "gallery", label: "Gallery" },
  { id: "design", label: "Design" },
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
  /// The stored width and collapsed state arrive after hydration, never during
  /// it: the server rendered the default, and `persist` is told to skip its own
  /// module-evaluation rehydrate so that this effect is the one re-render that
  /// swaps them in (see `use-sidebar-store.ts`).
  useEffect(() => void useSidebarStore.persist.rehydrate(), []);
  /// And the thread each project was last left on, for the same reason and by
  /// the same route (see `use-conversation-store.ts`). Rehydrated here rather
  /// than in the column that reads it: that column unmounts on collapse, and a
  /// rehydrate per mount would re-read the entry on every arrow press.
  useEffect(() => void useConversationStore.persist.rehydrate(), []);

  const view = useWorkspaceViewStore((state) => state.view);

  /// The grid-sized copy a picture nobody uploaded is still owed — a drawing
  /// the assistant filed, above all. Kept here for the reason the listeners
  /// below are: the turn that drew it may not have been the last thing to
  /// happen, and the column that ran the derivation collapses.
  useDerivedReferenceCopies(projectId);

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
          <ProjectBrief projectId={projectId} brief={brief} />

          <nav className="mt-2 flex gap-1 self-start rounded-full border border-current/15 p-0.5">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setWorkspaceView(option.id)}
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
            <GalleryUploader projectId={projectId} />
            <GalleryView projectId={projectId} />
          </>
        ) : (
          <DesignView projectId={projectId} />
        )}
      </main>

      <ChatSidebar projectId={projectId} />

      {/* The Vibes loop, mounted where it outlives both the board it is
          designing and the switch to the references grid (`compositor-v2.md`
          §IX.2). Draws nothing until a run is announced.

          It lives under `_design/_vibes/` and is mounted here on purpose: the
          first thing `vibes.start` does is open the *new* board, which unmounts
          the editor the form was pressed in. A panel mounted inside the design
          view would stop on its own first page. */}
      <VibesRunPanel projectId={projectId} />
    </div>
  );
}
