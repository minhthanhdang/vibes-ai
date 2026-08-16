"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";

type Message = { role: "user" | "model"; text: string };

/// The orchestrator's seat. The director types a sentence; the orchestrator
/// decides whether that means calling agent 1, and the gallery on the left is
/// where its results land.
export function ReferenceSidebar({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  const send = useMutation(
    trpc.orchestrator.send.mutationOptions({
      onSuccess: (result) => {
        setMessages((current) => [...current, { role: "model", text: result.reply }]);
        if (result.collected) {
          return queryClient.invalidateQueries({
            queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
          });
        }
      },
    }),
  );

  function submit() {
    const message = draft.trim();
    if (!message || send.isPending) return;
    // History is what the model already answered — the pending turn is passed
    // separately, so it must not be in both.
    send.mutate({ projectId, message, history: messages });
    setMessages((current) => [...current, { role: "user", text: message }]);
    setDraft("");
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length ? (
          messages.map((message, index) => (
            <p
              key={index}
              className={`rounded-lg px-3 py-2 text-sm ${
                message.role === "user"
                  ? "self-end bg-current/10 text-right"
                  : "border border-current/10"
              }`}
            >
              {message.text}
            </p>
          ))
        ) : (
          <p className="text-sm opacity-60">
            Describe the look you are after — “I need to find reference for a gloomy historical
            mansion”. Freely licensed images from Unsplash, Pexels and Google Custom Search land in
            the gallery with their credits.
          </p>
        )}

        {send.isPending ? <p className="text-sm opacity-50">Searching…</p> : null}
        {send.error ? <p className="text-sm text-red-500">{send.error.message}</p> : null}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-current/10 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="I need to find reference for a gloomy historical mansion"
          className="resize-none rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
        <button
          type="submit"
          disabled={send.isPending}
          className="rounded-lg border border-current/20 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
