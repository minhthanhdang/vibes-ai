"use client";

import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { onBoardDiscarded } from "../../../_events/board-discarded";
import { onCutTaken } from "../../../_events/cut-taken";
import { onReferenceDiscarded } from "../../../_events/reference-discarded";
import {
  recordBoardDiscarded,
  recordCutTaken,
  recordReferenceDiscarded,
} from "../stores/use-chat-log-store";
import { useConversationSeat } from "./use-conversation-seat";
import type { RecordChatEvent } from "../types";

export function useChatEventRecorder(projectId: string) {
  const { conversationId } = useConversationSeat(projectId);
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const recordEvent: RecordChatEvent = useCallback(
    async (input) => {
      const written = await client.chat.record.mutate(
        input as Parameters<typeof client.chat.record.mutate>[0],
      );
      await queryClient.invalidateQueries({
        queryKey: trpc.chat.conversations.queryOptions({ projectId }).queryKey,
      });
      return written;
    },
    [client, projectId, queryClient, trpc],
  );

  useEffect(
    () => onCutTaken((cut) => recordCutTaken({ projectId, conversationId }, cut, recordEvent)),
    [projectId, conversationId, recordEvent],
  );

  useEffect(
    () =>
      onBoardDiscarded((board) =>
        recordBoardDiscarded({ projectId, conversationId }, board, recordEvent),
      ),
    [projectId, conversationId, recordEvent],
  );

  useEffect(
    () =>
      onReferenceDiscarded((reference) =>
        recordReferenceDiscarded({ projectId, conversationId }, reference, recordEvent),
      ),
    [projectId, conversationId, recordEvent],
  );
}
