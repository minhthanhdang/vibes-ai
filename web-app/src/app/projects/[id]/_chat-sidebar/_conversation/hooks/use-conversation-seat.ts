"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { openConversationId } from "@/lib/agent/shared/conversation-list";
import { roomFor } from "@/lib/limits/account-tier";
import {
  adoptMintedConversation,
  chooseConversation,
  mintConversation,
  useMintedConversations,
  useOpenConversation,
} from "../stores/use-conversation-store";
import type { ChatSeat, ConversationRow } from "../types";

export function useConversationSeat(projectId: string): {
  conversations: ConversationRow[] | undefined;
  conversationId: string;
  isStored: boolean;
  seat: ChatSeat;
  seatsLeft: number | null;
  canMint: boolean;
  openConversation: (id: string | null) => void;
} {
  const trpc = useTRPC();
  const { data: conversations } = useQuery(trpc.chat.conversations.queryOptions({ projectId }));
  const { data: usage } = useQuery(trpc.account.usage.queryOptions({ projectId }));

  const mintedIds = useMintedConversations(projectId);
  const session = useMemo(() => new Set(mintedIds), [mintedIds]);

  const [ownFresh] = useState(() => crypto.randomUUID());
  const freshId = mintedIds[mintedIds.length - 1] ?? ownFresh;
  useEffect(() => {
    adoptMintedConversation(projectId, ownFresh);
  }, [projectId, ownFresh]);

  const chosenId = useOpenConversation(projectId);
  const conversationId = openConversationId(conversations, chosenId, session, freshId);

  const isStored =
    (conversations?.some((row) => row.id === conversationId) ?? false) &&
    !session.has(conversationId);

  const stored = usage?.used.conversations ?? null;
  const limit = usage?.limits.conversationsPerProject ?? null;
  const unspoken = isStored ? 0 : 1;
  const canMint =
    stored === null || limit === null ? true : roomFor(limit, stored, unspoken + 1);
  const seatsLeft = stored === null || limit === null ? null : Math.max(0, limit - stored);

  const openConversation = useCallback(
    (id: string | null) => {
      if (id) {
        chooseConversation(projectId, id);
        return;
      }
      if (!isStored && session.has(conversationId)) return;
      if (!canMint) return;
      chooseConversation(projectId, mintConversation(projectId));
    },
    [canMint, conversationId, isStored, projectId, session],
  );

  return {
    conversations,
    conversationId,
    isStored,
    seat: useMemo(() => ({ projectId, conversationId }), [projectId, conversationId]),
    seatsLeft,
    canMint,
    openConversation,
  };
}
