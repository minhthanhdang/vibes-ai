"use client";

import type { AttachmentTarget } from "@/lib/agent/shared/attachments";
import { useConversationSeat } from "../hooks/use-conversation-seat";
import { ConversationBody } from "./conversation-body";
import { ConversationHeader } from "./conversation-header";

export function ConversationContainer({
  projectId,
  onOpenAttachment,
  collapse,
  children,
}: {
  projectId: string;
  onOpenAttachment: (target: AttachmentTarget) => void;
  collapse: React.ReactNode;
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
        key={conversationId}
        seat={seat}
        isStored={isStored}
        onOpen={onOpenAttachment}
      />
    </>
  );
}
