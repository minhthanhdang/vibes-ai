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

/// The three things that happen to a project's pictures away from the chat, put
/// into the open thread as they happen.
///
/// Called from the sidebar shell rather than from the column it draws
/// (orchestrator-tool-reference §VII.2). The `<aside>` stays mounted when the
/// assistant is collapsed and only its children are conditional, so a listener
/// hung here is still listening while the thread is put away — which is the
/// whole reason these are not in the conversation itself. A crop taken with the
/// assistant shut still happened in this session, and the conversation is the
/// record of it.
export function useChatEventRecorder(projectId: string) {
  const { conversationId } = useConversationSeat(projectId);
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  /// The store's copy of every event the listeners below put in the column, so
  /// a reload draws the note and the tile the session drew.
  ///
  /// The switcher is told afterwards: a note is the first thing said in a thread
  /// nobody had spoken in, so the record may have just *opened* the row this
  /// list is missing — and on an old thread it has still moved it to the top.
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

  /// A cut the user takes in the properties panel goes back into the
  /// conversation — it is the other end of `crop_reference`, and the note it
  /// leaves is what lets the next turn name the new row without buying a round
  /// to find it.
  useEffect(
    () => onCutTaken((cut) => recordCutTaken({ projectId, conversationId }, cut, recordEvent)),
    [projectId, conversationId, recordEvent],
  );

  /// A board that has gone, from whichever door it went by: the chat's own
  /// Discard button, or the delete in the tab row. The conversation may be
  /// holding a tile of it, and a tile whose board no longer exists opens
  /// whichever board the tab row falls back to — the one failure in this
  /// pipeline that is reported to neither the user nor the model.
  useEffect(
    () =>
      onBoardDiscarded((board) =>
        recordBoardDiscarded({ projectId, conversationId }, board, recordEvent),
      ),
    [projectId, conversationId, recordEvent],
  );

  /// And a picture that has gone, by whichever door: the chat's Remove button,
  /// the gallery tile's, or the versions list's. Same reason, one column over —
  /// a tile whose picture no longer exists is a click the properties panel has
  /// nowhere to answer.
  useEffect(
    () =>
      onReferenceDiscarded((reference) =>
        recordReferenceDiscarded({ projectId, conversationId }, reference, recordEvent),
      ),
    [projectId, conversationId, recordEvent],
  );
}
