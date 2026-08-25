"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { emptyChat, forgetChat } from "../stores/use-chat-log-store";

/// One thread's messages, dropped from every place this browser keeps them.
///
/// There are three: the store's log, the store's once-per-session hydration
/// mark, and the `chat.list` query entry — and **any two of them left in
/// disagreement is a resurrection bug**. `chat.clear` without the
/// `removeQueries` leaves a `staleTime: Infinity` entry holding the exact rows
/// the server has just deleted, ready to be laid back under the column the next
/// time it mounts.
///
/// Three callers, and the third is the one this feature creates:
/// `vibes.designPage` writes an assistant row per page on the server and nothing
/// tells the browser — so the run's thread, which the switcher now invites the
/// user into mid-run, would show two rows of seven until a hard reload
/// (`compositor-v2.md` §IX.2 calls that thread the only account of the run the
/// user ever reads).
export function useChatCacheReset() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useCallback(
    (conversationId: string, { keepSeat = true } = {}) => {
      /// `keepSeat` is the difference between clearing and removing: a cleared
      /// thread keeps its draft, because the user asked to lose the record and
      /// not the sentence they were part-way through. A removed one has no seat
      /// to come back to.
      if (keepSeat) emptyChat(conversationId);
      else forgetChat(conversationId);
      queryClient.removeQueries({
        queryKey: trpc.chat.list.queryOptions({ conversationId }).queryKey,
      });
    },
    [queryClient, trpc],
  );
}
