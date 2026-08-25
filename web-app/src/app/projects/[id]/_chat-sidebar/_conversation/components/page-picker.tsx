"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { pageChoiceKey, pageChoiceNote, type PageChoice } from "@/lib/pages/page-attach";
import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import { listedPages, pickPage } from "../stores/use-chat-log-store";
import { useOpenBoardStore } from "../../../_workspace/stores/use-open-board-store";

/// The pages of the board the tab is showing, to attach one to this message
/// (§V.5).
///
/// The whole of what a page attachment is on this side: what goes up is a pointer
/// — which board, which page, at which revision — and everything the model reads
/// about it is built on the server from the stored scene. So this lists what the
/// server holds rather than what the canvas is showing: a page drawn a second ago
/// and not yet saved is not a page the model could be handed, and offering it
/// would be a chip for something that goes up as nothing.
///
/// Nothing at all when the board has no pages: a board never composed and never
/// given one by hand has no rectangle to attach, and a picker saying so on every
/// project that has not got there yet is chrome above the box the user types
/// in.
export function PagePicker({
  conversationId,
  attached,
}: {
  conversationId: string;
  attached: PageChoice[];
}) {
  const trpc = useTRPC();
  const boardId = useOpenBoardStore((state) => state.openId);
  /// Behind `moodboard.pages` rather than the scene the editor is mounted on —
  /// that one is pinned and must not be refetched under the canvas. This is free
  /// to be refetched, and is: the user draws a page on the board and then
  /// turns to the chat to talk about it.
  const { data } = useQuery(
    trpc.moodboard.pages.queryOptions(
      { id: boardId ?? "" },
      /// A board's pages change under this — a compose, an `add_page`, the
      /// user drawing one — so the list is asked for again rather than
      /// served from a cache the last message filled.
      { enabled: !!boardId, staleTime: 0 },
    ),
  );

  /// A page picked and since deleted stops being a chip here rather than going up
  /// as an id the server drops in silence.
  useEffect(() => {
    if (data) listedPages(conversationId, data);
  }, [data, conversationId]);

  if (!boardId || !data?.pages.length) return null;

  const picked = new Set(attached.map(pageChoiceKey));
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[11px] opacity-50">
        Attach a page of “{data.title}” — up to {PAGES_PER_MESSAGE} per message
      </span>
      <ul className="flex flex-wrap gap-1">
        {data.pages.map((page) => {
          const on = picked.has(pageChoiceKey({ boardId: data.boardId, pageId: page.pageId }));
          return (
            <li key={page.pageId}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  pickPage(conversationId, {
                    boardId: data.boardId,
                    pageId: page.pageId,
                    revision: data.revision,
                    name: page.name,
                  })
                }
                className={`flex flex-col rounded-lg border px-2 py-1 text-left text-[11px] transition-opacity ${
                  on ? "border-current/50 bg-current/10" : "border-current/15 hover:opacity-70"
                }`}
              >
                <span className="max-w-40 truncate font-medium">
                  {page.name || `Page ${page.position}`}
                </span>
                <span className="opacity-60">{pageChoiceNote(page)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}