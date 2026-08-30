"use client";

import { useState } from "react";
import { sidebarPageWidth } from "@/lib/ui/sidebar";
import type { AttachmentTarget } from "@/lib/agent/shared/attachments";
import { ConversationContainer } from "../_conversation/components/conversation-container";
import { useChatEventRecorder } from "../_conversation/hooks/use-chat-event-recorder";
import { SidebarGallery } from "./sidebar-gallery";
import { WorkspaceResizer } from "../../_workspace/components/workspace-resizer";
import { toggleSidebar, useSidebarStore } from "../../_workspace/stores/use-sidebar-store";
import { setWorkspaceView } from "../../_workspace/stores/use-workspace-view-store";
import { openBoard } from "../../_workspace/stores/use-open-board-store";
import { inspectReference } from "../../_reference/stores/use-inspection-store";
import { focusVersion } from "../../_reference/stores/use-version-focus-store";

export function ChatSidebar({ projectId }: { projectId: string }) {
  const isSidebarOpen = useSidebarStore((state) => state.isOpen);
  const width = useSidebarStore((state) => state.width);
  const [isResizing, setIsResizing] = useState(false);

  useChatEventRecorder(projectId);

  function openAttachment(target: AttachmentTarget) {
    setWorkspaceView(target.view);
    if (target.view !== "gallery") {
      openBoard(target.boardId);
      return;
    }
    focusVersion(
      target.versionId ? { frameId: target.inspectId, versionId: target.versionId } : null,
    );
    inspectReference(target.inspectId);
  }

  const collapse = (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-expanded={isSidebarOpen}
      aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      className="rounded-md border border-current/20 px-2 py-1 text-xs transition-opacity hover:opacity-70"
    >
      {isSidebarOpen ? "→" : "←"}
    </button>
  );

  return (
    <aside
      style={{ width: sidebarPageWidth({ isOpen: isSidebarOpen, width }) }}
      className={`flex shrink-0 flex-col overflow-hidden border-l border-current/10 ${
        isResizing ? "" : "transition-[width] duration-200"
      }`}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        {isSidebarOpen ? (
          <>
            <WorkspaceResizer width={width} onResizing={setIsResizing} />
            <ConversationContainer
              projectId={projectId}
              onOpenAttachment={openAttachment}
              collapse={collapse}
            >
              <SidebarGallery projectId={projectId} />
            </ConversationContainer>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 border-b border-current/10 px-3 py-3">
              {collapse}
            </div>
            <span className="mt-6 self-center text-xs tracking-widest opacity-40 [writing-mode:vertical-rl]">
              ASSISTANT
            </span>
          </>
        )}
      </div>
    </aside>
  );
}
