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
  useEffect(() => void useSidebarStore.persist.rehydrate(), []);
  useEffect(() => void useConversationStore.persist.rehydrate(), []);

  const view = useWorkspaceViewStore((state) => state.view);

  useEffect(() => syncWorkspaceViewFromHash(), []);

  useDerivedReferenceCopies(projectId);

  return (
    <div className="flex min-h-0 flex-1 items-stretch">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {view === "gallery" ? (
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
