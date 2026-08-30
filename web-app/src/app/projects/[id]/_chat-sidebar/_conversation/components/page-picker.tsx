"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { pageChoiceKey, pageChoiceNote, type PageChoice } from "@/lib/pages/page-attach";
import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import { listedPages, pickPage } from "../stores/use-chat-log-store";
import { useOpenBoardStore } from "../../../_workspace/stores/use-open-board-store";

export function PagePicker({
  conversationId,
  attached,
}: {
  conversationId: string;
  attached: PageChoice[];
}) {
  const trpc = useTRPC();
  const boardId = useOpenBoardStore((state) => state.openId);
  const { data } = useQuery(
    trpc.moodboard.pages.queryOptions(
      { id: boardId ?? "" },
      { enabled: !!boardId, staleTime: 0 },
    ),
  );

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