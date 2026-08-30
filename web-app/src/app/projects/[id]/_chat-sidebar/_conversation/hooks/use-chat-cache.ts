"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { emptyChat, forgetChat } from "../stores/use-chat-log-store";

export function useChatCacheReset() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useCallback(
    (conversationId: string, { keepSeat = true } = {}) => {
      if (keepSeat) emptyChat(conversationId);
      else forgetChat(conversationId);
      queryClient.removeQueries({
        queryKey: trpc.chat.list.queryOptions({ conversationId }).queryKey,
      });
    },
    [queryClient, trpc],
  );
}
