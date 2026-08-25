"use client";

import type { AttachmentTarget } from "@/lib/agent/shared/attachments";
import { useConversationSeat } from "../hooks/use-conversation-seat";
import { ConversationBody } from "./conversation-body";
import { ConversationHeader } from "./conversation-header";

/// The open thread — the sidebar's third level, and the only level that knows
/// which thread that is.
///
/// Resolved here rather than passed in: the header switches it and the body
/// sends into it, and nothing above needs to know which one it is except the
/// recorder, which asks the same hook and gets the same answer.
export function ConversationContainer({
  projectId,
  onOpenAttachment,
  collapse,
  children,
}: {
  projectId: string;
  /// Where an attachment click sends the main viewport. Handled by the shell,
  /// because the surface it switches is in the other column.
  onOpenAttachment: (target: AttachmentTarget) => void;
  /// The sidebar's own collapse arrow, which shares the header's bar: it is the
  /// column's control and not the thread's, so it is handed in rather than
  /// drawn here.
  collapse: React.ReactNode;
  /// The reference strip, which sits between the thread's name and its
  /// messages.
  children: React.ReactNode;
}) {
  const { conversations, conversationId, isStored, seat, openConversation } =
    useConversationSeat(projectId);

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-current/10 px-3 py-3">
        <ConversationHeader
          projectId={projectId}
          conversationId={conversationId}
          conversations={conversations}
          onOpen={openConversation}
        />
        {collapse}
      </div>

      {children}

      <ConversationBody
        /// Keyed by the thread, so switching one out gives the column a fresh
        /// instance rather than one carrying the last thread's local state. What
        /// is *not* thrown away is the draft: that lives in the store, under the
        /// thread's own key.
        key={conversationId}
        seat={seat}
        isStored={isStored}
        onOpen={onOpenAttachment}
      />
    </>
  );
}
