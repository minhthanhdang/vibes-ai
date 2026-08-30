"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { DesignView } from "../../_main-viewport/_design/components/design-view";
import { GalleryView } from "../../_main-viewport/_gallery/components/gallery-view";
import { ChatSidebar } from "../../_chat-sidebar/components/chat-sidebar";
import { GalleryUploader } from "../../_main-viewport/_gallery/components/gallery-uploader";
import { useDerivedReferenceCopies } from "../../_reference/hooks/use-derived-reference-copies";
import { useConversationStore } from "../../_chat-sidebar/_conversation/stores/use-conversation-store";
import { useSidebarStore } from "../stores/use-sidebar-store";
import { VibesRunPanel } from "../../_main-viewport/_design/_vibes/components/vibes-run-panel";
import {
  syncWorkspaceViewFromHash,
  useWorkspaceViewStore,
} from "../stores/use-workspace-view-store";

/// Client-only for the same reason the design canvas is (`board-scene.tsx`):
/// the preview draws its slides with excalidraw's own exporter, and that
/// package does not load on the server.
const PreviewView = dynamic(
  async () => (await import("../../_main-viewport/_preview/components/preview-view")).PreviewView,
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm opacity-60">
        Loading preview…
      </div>
    ),
  },
);

export function ProjectWorkspace({ projectId }: { projectId: string }) {
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

  /// A `#design` or `#preview` hash survives a reload where the store does not;
  /// adopted after hydration for the same reason the stores above are.
  useEffect(() => syncWorkspaceViewFromHash(), []);

  /// The grid-sized copy a picture nobody uploaded is still owed — a drawing
  /// the assistant filed, above all. Kept here for the reason the listeners
  /// below are: the turn that drew it may not have been the last thing to
  /// happen, and the column that ran the derivation collapses.
  useDerivedReferenceCopies(projectId);

  return (
    /// The sidebar is a flex sibling, not an overlay — expanding it narrows the
    /// gallery instead of covering it.
    <div className="flex min-h-0 flex-1 items-stretch">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {view === "gallery" ? (
          /// The dropzone keeps its size and the grid takes what is left, so the
          /// scrolling happens in the grid rather than in the page. Padded here
          /// rather than on the column, which the board fills edge to edge.
          <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 pt-6">
            <GalleryUploader projectId={projectId} />
            <GalleryView projectId={projectId} />
          </div>
        ) : view === "design" ? (
          <DesignView projectId={projectId} />
        ) : (
          <PreviewView projectId={projectId} />
        )}
      </main>

      <ChatSidebar projectId={projectId} />

      <VibesRunPanel projectId={projectId} />
    </div>
  );
}
