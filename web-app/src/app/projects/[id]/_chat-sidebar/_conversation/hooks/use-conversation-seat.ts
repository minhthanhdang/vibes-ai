"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { openConversationId } from "@/lib/agent/shared/conversation-list";
import {
  chooseConversation,
  ensureMintedConversation,
  mintConversation,
  useMintedConversations,
  useOpenConversation,
} from "../stores/use-conversation-store";
import type { ChatSeat, ConversationRow } from "../types";

/// Which of the project's threads is open, and the two things that decide it:
/// the list the server holds, and what this browser has minted and chosen.
///
/// A hook rather than state in one component, because two places need the
/// answer and only one of them is on screen at a time — the container that draws
/// the thread, and the recorder that has to keep putting events into it while
/// the column is collapsed. Both read the same query and the same store, so
/// asking twice costs one fetch and always answers the same.
export function useConversationSeat(projectId: string): {
  conversations: ConversationRow[] | undefined;
  conversationId: string;
  isStored: boolean;
  seat: ChatSeat;
  openConversation: (id: string | null) => void;
} {
  const trpc = useTRPC();
  const { data: conversations } = useQuery(trpc.chat.conversations.queryOptions({ projectId }));

  const mintedIds = useMintedConversations(projectId);
  const session = useMemo(() => new Set(mintedIds), [mintedIds]);
  /// The thread a project with nothing to open falls back on. Minted on the
  /// spot when the project has none, because `openConversationId` is pure and
  /// cannot mint one for itself.
  const freshId = mintedIds[mintedIds.length - 1] ?? ensureMintedConversation(projectId);

  const chosenId = useOpenConversation(projectId);
  const conversationId = openConversationId(conversations, chosenId, session, freshId);

  /// Whether the column should fetch a stored page of messages for this thread.
  ///
  /// Two things have to be true. It has to be a row — a minted thread is in no
  /// list, and asking `chat.list` about one would be a 404 for a conversation
  /// that does not exist yet. And it must not be a thread *this session* minted:
  /// once the first message is sent it becomes a row and joins the list, but its
  /// messages are already in the store, and fetching them again would be a
  /// round trip whose only possible outcome is being thrown away by the store's
  /// once-guard.
  const isStored =
    (conversations?.some((row) => row.id === conversationId) ?? false) &&
    !session.has(conversationId);

  /// Where the switcher sends the column. `null` is "there is nothing left to
  /// open" — a fresh chat, minted here because minting is this layer's business.
  ///
  /// Pressing "New chat" while already sitting in one does nothing, which is the
  /// honest answer: you are already in a new chat. Minting a second would put
  /// the half-written sentence in the first somewhere with no row in the
  /// switcher to get back to it.
  const openConversation = useCallback(
    (id: string | null) => {
      if (id) {
        chooseConversation(projectId, id);
        return;
      }
      if (!isStored && session.has(conversationId)) return;
      chooseConversation(projectId, mintConversation(projectId));
    },
    [conversationId, isStored, projectId, session],
  );

  return {
    conversations,
    conversationId,
    isStored,
    seat: useMemo(() => ({ projectId, conversationId }), [projectId, conversationId]),
    openConversation,
  };
}
