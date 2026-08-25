"use client";

import { useState } from "react";
import { sidebarPageWidth } from "@/lib/ui/sidebar";
import type { AttachmentTarget } from "@/lib/agent/shared/attachments";
import type { ChatSeat } from "../_conversation/stores/use-chat-log-store";
import type { ConversationRow } from "../_conversation/components/conversation-header";
import { ConversationBody } from "../_conversation/components/conversation-body";
import { ConversationHeader } from "../_conversation/components/conversation-header";
import { SidebarGallery } from "./sidebar-gallery";
import { WorkspaceResizer } from "../../_workspace/components/workspace-resizer";
import { toggleSidebar, useSidebarStore } from "../../_workspace/stores/use-sidebar-store";
import { setWorkspaceView } from "../../_workspace/stores/use-workspace-view-store";
import { openBoard } from "../../_workspace/stores/use-open-board-store";
import { inspectReference } from "../../_reference/stores/use-inspection-store";
import { focusVersion } from "../../_reference/stores/use-version-focus-store";

/// The assistant's column, which is also the project's second level: the
/// reference strip, the thread, and the arrow that puts all of it away.
///
/// The `<aside>` stays mounted when the column is collapsed — only its children
/// are conditional. Anything that has to keep working while the assistant is
/// shut can therefore live here rather than one level up in the workspace.
export function ChatSidebar({
  projectId,
  conversationId,
  conversations,
  seat,
  isStored,
  onOpenConversation,
}: {
  projectId: string;
  conversationId: string;
  conversations: ConversationRow[] | undefined;
  seat: ChatSeat;
  isStored: boolean;
  onOpenConversation: (id: string | null) => void;
}) {
  const isSidebarOpen = useSidebarStore((state) => state.isOpen);
  const width = useSidebarStore((state) => state.width);
  const [isResizing, setIsResizing] = useState(false);

  /// What the assistant showed is a way into the workspace, not a picture of it.
  /// A reference switches the main viewport back to the grid it lives in — the
  /// properties panel lays over that column, and opening it on top of the board
  /// would hide what it was covering — and a board switches it to the board.
  function open(target: AttachmentTarget) {
    setWorkspaceView(target.view);
    if (target.view !== "gallery") {
      openBoard(target.boardId);
      return;
    }
    /// The cut is put down before the panel goes looking for it, so the frame
    /// opens at the row that was clicked instead of at the top of a list
    /// holding it.
    focusVersion(
      target.versionId ? { frameId: target.inspectId, versionId: target.versionId } : null,
    );
    inspectReference(target.inspectId);
  }

  return (
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
        {isSidebarOpen ? <WorkspaceResizer width={width} onResizing={setIsResizing} /> : null}

        <div
          className={`flex items-center gap-2 border-b border-current/10 px-3 py-3 ${
            isSidebarOpen ? "justify-between" : "justify-center"
          }`}
        >
          {isSidebarOpen ? (
            <ConversationHeader
              projectId={projectId}
              conversationId={conversationId}
              conversations={conversations}
              onOpen={onOpenConversation}
            />
          ) : null}
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
            <SidebarGallery projectId={projectId} />
            <ConversationBody
              /// Keyed by the thread, so switching one out gives the column a
              /// fresh instance rather than one carrying the last thread's
              /// local state. What is *not* thrown away is the draft: that
              /// lives in the store, under the thread's own key.
              key={conversationId}
              seat={seat}
              isStored={isStored}
              onOpen={open}
            />
          </>
        ) : (
          <span className="mt-6 self-center text-xs tracking-widest opacity-40 [writing-mode:vertical-rl]">
            ASSISTANT
          </span>
        )}
      </div>
    </aside>
  );
}
